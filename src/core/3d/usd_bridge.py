#!/usr/bin/env python3
"""
OpenComp - Production OpenUSD (Universal Scene Description) Bridge
Bridges OpenComp's compositing engine to the official Pixar OpenUSD C++ library
(via pxr.Usd, pxr.UsdGeom, pxr.Gf, pxr.Sdf).

Capabilities:
  - Inspects USD stages (.usd, .usda, .usdc, .usdz) and enumerates prim hierarchy
  - Extracts meshes: vertices, triangulated face indices, normals, UVs, world transforms
  - Extracts cameras: focal length, aperture, clipping planes, world transforms
  - Handles coordinate and unit normalization (metersPerUnit, upAxis conversion)
  - Evaluates animated time samples with smooth sub-frame interpolation
  - Packs extracted data into high-performance binary OC3D containers for Node.js
"""

import sys
import os
import argparse
import json
import struct
import math
import numpy as np

# Verify Pixar OpenUSD is installed
try:
    from pxr import Usd, UsdGeom, Gf, Sdf
    USD_AVAILABLE = True
    USD_VERSION = ".".join(str(v) for v in Usd.GetVersion())
except ImportError as err:
    USD_AVAILABLE = False
    USD_VERSION = None
    USD_IMPORT_ERROR = str(err)

MAGIC_OC3D = b'OC3D'  # OpenComp 3D Binary Container Magic


def triangulate_mesh(face_vertex_counts, face_vertex_indices):
    """
    Triangulate polygon faces (quads, n-gons) into triangle index array using fan triangulation
    """
    tri_indices = []
    idx_offset = 0

    for count in face_vertex_counts:
        if count == 3:
            tri_indices.append(face_vertex_indices[idx_offset])
            tri_indices.append(face_vertex_indices[idx_offset + 1])
            tri_indices.append(face_vertex_indices[idx_offset + 2])
        elif count == 4:
            # Quad -> 2 triangles: (0, 1, 2) and (0, 2, 3)
            v0 = face_vertex_indices[idx_offset]
            v1 = face_vertex_indices[idx_offset + 1]
            v2 = face_vertex_indices[idx_offset + 2]
            v3 = face_vertex_indices[idx_offset + 3]
            tri_indices.extend([v0, v1, v2, v0, v2, v3])
        elif count > 4:
            # General n-gon fan triangulation
            v0 = face_vertex_indices[idx_offset]
            for i in range(1, count - 1):
                tri_indices.extend([v0, face_vertex_indices[idx_offset + i], face_vertex_indices[idx_offset + i + 1]])
        idx_offset += count

    return np.array(tri_indices, dtype=np.uint32)


def compute_z_up_to_y_up_matrix():
    """
    Matrix transforming right-handed Z-up coordinates to right-handed Y-up coordinates.
    Rotation of -90 degrees around X-axis:
      x' = x
      y' = z
      z' = -y
    Returns 4x4 column-major numpy float32 array
    """
    return np.array([
        1.0,  0.0,  0.0, 0.0,
        0.0,  0.0, -1.0, 0.0,
        0.0,  1.0,  0.0, 0.0,
        0.0,  0.0,  0.0, 1.0
    ], dtype=np.float32)


def get_column_major_matrix(gf_matrix4d):
    """Convert pxr.Gf.Matrix4d to 16-element column-major float32 array"""
    # Gf.Matrix4d is row-major internally in indexing: m[row][col]
    # Column-major array: m[0][0], m[1][0], m[2][0], m[3][0], m[0][1], ...
    mat = np.zeros(16, dtype=np.float32)
    idx = 0
    for col in range(4):
        for row in range(4):
            mat[idx] = float(gf_matrix4d[row][col])
            idx += 1
    return mat


def inspect_stage(usd_path):
    """
    Inspect USD file and return stage metadata and prim tree
    """
    if not USD_AVAILABLE:
        raise RuntimeError(f"OpenUSD library not available: {USD_IMPORT_ERROR}")

    if not os.path.exists(usd_path):
        raise FileNotFoundError(f"USD file not found: {usd_path}")

    stage = Usd.Stage.Open(usd_path)
    if not stage:
        raise ValueError(f"Failed to open USD stage: {usd_path}")

    up_axis = str(UsdGeom.GetStageUpAxis(stage))
    meters_per_unit = float(UsdGeom.GetStageMetersPerUnit(stage))
    has_auth_time = stage.HasAuthoredTimeCodeRange()
    start_time = float(stage.GetStartTimeCode()) if has_auth_time else 1.0
    end_time = float(stage.GetEndTimeCode()) if has_auth_time else 1.0
    tcps = float(stage.GetTimeCodesPerSecond())

    prims_list = []
    for prim in stage.Traverse():
        path_str = prim.GetPath().pathString
        type_name = prim.GetTypeName()
        is_active = prim.IsActive()

        prim_info = {
            "path": path_str,
            "name": prim.GetName(),
            "type": type_name,
            "active": is_active
        }

        if type_name == "Mesh":
            mesh = UsdGeom.Mesh(prim)
            pts = mesh.GetPointsAttr().Get(start_time)
            counts = mesh.GetFaceVertexCountsAttr().Get(start_time)
            prim_info["pointCount"] = len(pts) if pts else 0
            prim_info["faceCount"] = len(counts) if counts else 0
            prim_info["triangleCount"] = sum(max(0, c - 2) for c in counts) if counts else 0
            prim_info["hasNormals"] = bool(mesh.GetNormalsAttr().Get(start_time))
            pv_api = UsdGeom.PrimvarsAPI(prim)
            prim_info["hasUVs"] = bool(pv_api.GetPrimvar("st") or pv_api.GetPrimvar("uv"))
            prim_info["isAnimated"] = bool(mesh.GetPointsAttr().GetTimeSamples())
        elif type_name == "Camera":
            cam = UsdGeom.Camera(prim)
            prim_info["focalLength"] = float(cam.GetFocalLengthAttr().Get(start_time) or 50.0)
            prim_info["horizontalAperture"] = float(cam.GetHorizontalApertureAttr().Get(start_time) or 24.89)
            prim_info["verticalAperture"] = float(cam.GetVerticalApertureAttr().Get(start_time) or 18.67)
            prim_info["isAnimated"] = bool(cam.GetFocalLengthAttr().GetTimeSamples())

        prims_list.append(prim_info)

    return {
        "status": "ok",
        "format": "OpenUSD",
        "version": USD_VERSION,
        "file": usd_path,
        "upAxis": up_axis,
        "metersPerUnit": meters_per_unit,
        "startTimeCode": start_time,
        "endTimeCode": end_time,
        "timeCodesPerSecond": tcps,
        "primCount": len(prims_list),
        "prims": prims_list
    }


def read_stage_data(usd_path, out_bin_path, target_prim_path="/", frame=1.0, scale=None, up_axis_override="auto", stride=1, read_cameras=True, read_meshes=True):
    """
    Read USD stage at specified frame, extract geometry and cameras, and export to binary OC3D container
    """
    if not USD_AVAILABLE:
        raise RuntimeError(f"OpenUSD library not available: {USD_IMPORT_ERROR}")

    if not os.path.exists(usd_path):
        raise FileNotFoundError(f"USD file not found: {usd_path}")

    stage = Usd.Stage.Open(usd_path)
    if not stage:
        raise ValueError(f"Failed to open USD stage: {usd_path}")

    # Stage metadata
    stage_up_axis = str(UsdGeom.GetStageUpAxis(stage))
    stage_mpu = float(UsdGeom.GetStageMetersPerUnit(stage))

    # Determine effective unit scale factor
    if scale is not None and scale > 0:
        scale_factor = float(scale)
    else:
        # Standardize scene units to meters (OpenComp default)
        scale_factor = stage_mpu

    # Determine up-axis conversion
    needs_z_to_y = False
    if up_axis_override == "Z" or (up_axis_override == "auto" and stage_up_axis.upper() == "Z"):
        needs_z_to_y = True

    time_code = Usd.TimeCode(frame)

    geometries = []
    cameras = []

    # Traverse target subtree
    if target_prim_path and target_prim_path != "/":
        root_prim = stage.GetPrimAtPath(Sdf.Path(target_prim_path))
        if not root_prim or not root_prim.IsValid():
            raise ValueError(f"Prim not found at path: {target_prim_path}")
        prim_iter = [root_prim] + list(Usd.PrimRange(root_prim))[1:]
    else:
        prim_iter = stage.Traverse()

    z_to_y_mat = compute_z_up_to_y_up_matrix() if needs_z_to_y else None

    for prim in prim_iter:
        if not prim.IsActive():
            continue

        prim_path_str = prim.GetPath().pathString
        type_name = prim.GetTypeName()

        # -----------------------------------------------------------------
        # 1. UsdGeomMesh Ingestion
        # -----------------------------------------------------------------
        if type_name == "Mesh" and read_meshes:
            mesh = UsdGeomMesh = UsdGeom.Mesh(prim)
            points_val = mesh.GetPointsAttr().Get(time_code)
            counts_val = mesh.GetFaceVertexCountsAttr().Get(time_code)
            indices_val = mesh.GetFaceVertexIndicesAttr().Get(time_code)

            if not points_val or not counts_val or not indices_val:
                continue

            # Points extraction
            raw_pts = np.array(points_val, dtype=np.float32).reshape(-1, 3)

            # Apply unit scale
            if abs(scale_factor - 1.0) > 1e-6:
                raw_pts *= scale_factor

            # Apply up-axis conversion to vertex coordinates if requested
            if needs_z_to_y:
                # x' = x, y' = z, z' = -y
                x = raw_pts[:, 0].copy()
                y = raw_pts[:, 1].copy()
                z = raw_pts[:, 2].copy()
                raw_pts[:, 0] = x
                raw_pts[:, 1] = z
                raw_pts[:, 2] = -y

            # Point decimation stride for fast viewport preview
            effective_stride = max(1, int(stride))
            if effective_stride > 1:
                raw_pts = raw_pts[::effective_stride]

            # Triangulate polygons
            raw_counts = np.array(counts_val, dtype=np.int32)
            raw_indices = np.array(indices_val, dtype=np.uint32)
            tri_indices = triangulate_mesh(raw_counts, raw_indices)

            # Normals
            normals_attr = mesh.GetNormalsAttr().Get(time_code)
            if normals_attr and len(normals_attr) > 0:
                raw_normals = np.array(normals_attr, dtype=np.float32).reshape(-1, 3)
                if needs_z_to_y:
                    nx = raw_normals[:, 0].copy()
                    ny = raw_normals[:, 1].copy()
                    nz = raw_normals[:, 2].copy()
                    raw_normals[:, 0] = nx
                    raw_normals[:, 1] = nz
                    raw_normals[:, 2] = -ny
                # If face-varying normals match face indices count, remap to vertex array size
                if len(raw_normals) < len(raw_pts):
                    # Zero pad or duplicate
                    pad = np.zeros((len(raw_pts) - len(raw_normals), 3), dtype=np.float32)
                    raw_normals = np.vstack([raw_normals, pad])
                elif len(raw_normals) > len(raw_pts):
                    raw_normals = raw_normals[:len(raw_pts)]
            else:
                raw_normals = np.zeros_like(raw_pts, dtype=np.float32)

            # Texture Coordinates (UVs)
            pv_api = UsdGeom.PrimvarsAPI(prim)
            uv_primvar = pv_api.GetPrimvar("st")
            if not uv_primvar or not uv_primvar.IsDefined():
                uv_primvar = pv_api.GetPrimvar("uv")

            if uv_primvar and uv_primvar.IsDefined():
                uvs_val = uv_primvar.Get(time_code)
                if uvs_val and len(uvs_val) > 0:
                    raw_uvs = np.array(uvs_val, dtype=np.float32).reshape(-1, 2)
                    if len(raw_uvs) < len(raw_pts):
                        pad_uv = np.zeros((len(raw_pts) - len(raw_uvs), 2), dtype=np.float32)
                        raw_uvs = np.vstack([raw_uvs, pad_uv])
                    elif len(raw_uvs) > len(raw_pts):
                        raw_uvs = raw_uvs[:len(raw_pts)]
                else:
                    raw_uvs = np.zeros((len(raw_pts), 2), dtype=np.float32)
            else:
                raw_uvs = np.zeros((len(raw_pts), 2), dtype=np.float32)

            # World transformation matrix
            xformable = UsdGeom.Xformable(prim)
            world_xform = xformable.ComputeLocalToWorldTransform(time_code)
            world_mat = get_column_major_matrix(world_xform)

            # Bounding box
            bmin = [float(raw_pts[:, 0].min()), float(raw_pts[:, 1].min()), float(raw_pts[:, 2].min())]
            bmax = [float(raw_pts[:, 0].max()), float(raw_pts[:, 1].max()), float(raw_pts[:, 2].max())]

            geometries.append({
                "path": prim_path_str,
                "name": prim.GetName(),
                "vertices": raw_pts.flatten(),
                "indices": tri_indices,
                "normals": raw_normals.flatten(),
                "uvs": raw_uvs.flatten(),
                "worldMatrix": world_mat,
                "bbox": {"min": bmin, "max": bmax}
            })

        # -----------------------------------------------------------------
        # 2. UsdGeomCamera Ingestion
        # -----------------------------------------------------------------
        elif type_name == "Camera" and read_cameras:
            cam = UsdGeom.Camera(prim)
            focal = float(cam.GetFocalLengthAttr().Get(time_code) or 50.0)
            hap = float(cam.GetHorizontalApertureAttr().Get(time_code) or 24.89)
            vap = float(cam.GetVerticalApertureAttr().Get(time_code) or 18.67)
            clip_range = cam.GetClippingRangeAttr().Get(time_code)
            near_clip = float(clip_range[0]) if clip_range else 0.1
            far_clip = float(clip_range[1]) if clip_range else 10000.0

            proj_attr = cam.GetProjectionAttr().Get(time_code)
            proj_mode = "orthographic" if str(proj_attr) == "orthographic" else "perspective"

            # World transformation matrix
            xformable = UsdGeom.Xformable(prim)
            world_xform = xformable.ComputeLocalToWorldTransform(time_code)
            world_mat = get_column_major_matrix(world_xform)

            cameras.append({
                "path": prim_path_str,
                "name": prim.GetName(),
                "focal": focal,
                "haperture": hap,
                "vaperture": vap,
                "near": near_clip,
                "far": far_clip,
                "projectionMode": proj_mode,
                "worldMatrix": world_mat
            })

    # Pack into binary OC3D container
    meta_json = json.dumps({
        "status": "ok",
        "file": usd_path,
        "frame": frame,
        "geometryCount": len(geometries),
        "cameraCount": len(cameras),
        "upAxis": stage_up_axis,
        "scaleFactor": scale_factor
    }).encode("utf-8")

    with open(out_bin_path, "wb") as fb:
        # Magic (4 bytes) + Meta JSON length (4 bytes) + Meta JSON bytes
        fb.write(MAGIC_OC3D)
        fb.write(struct.pack("<I", len(meta_json)))
        fb.write(meta_json)

        # Write Geometries
        fb.write(struct.pack("<I", len(geometries)))
        for geo in geometries:
            name_bytes = geo["name"].encode("utf-8")
            path_bytes = geo["path"].encode("utf-8")
            fb.write(struct.pack("<H", len(name_bytes)))
            fb.write(name_bytes)
            fb.write(struct.pack("<H", len(path_bytes)))
            fb.write(path_bytes)

            # World matrix (16 float32 = 64 bytes)
            fb.write(geo["worldMatrix"].astype(np.float32).tobytes())

            # BBox (6 float32 = 24 bytes)
            fb.write(struct.pack("<ffffff", *geo["bbox"]["min"], *geo["bbox"]["max"]))

            # Vertices
            v_arr = geo["vertices"].astype(np.float32)
            fb.write(struct.pack("<I", len(v_arr)))
            fb.write(v_arr.tobytes())

            # Indices
            i_arr = geo["indices"].astype(np.uint32)
            fb.write(struct.pack("<I", len(i_arr)))
            fb.write(i_arr.tobytes())

            # Normals
            n_arr = geo["normals"].astype(np.float32)
            fb.write(struct.pack("<I", len(n_arr)))
            fb.write(n_arr.tobytes())

            # UVs
            uv_arr = geo["uvs"].astype(np.float32)
            fb.write(struct.pack("<I", len(uv_arr)))
            fb.write(uv_arr.tobytes())

        # Write Cameras
        fb.write(struct.pack("<I", len(cameras)))
        for cam in cameras:
            name_bytes = cam["name"].encode("utf-8")
            path_bytes = cam["path"].encode("utf-8")
            fb.write(struct.pack("<H", len(name_bytes)))
            fb.write(name_bytes)
            fb.write(struct.pack("<H", len(path_bytes)))
            fb.write(path_bytes)

            # World matrix (16 float32)
            fb.write(cam["worldMatrix"].astype(np.float32).tobytes())

            # Camera optics (5 float32) + projMode string
            fb.write(struct.pack("<fffff", cam["focal"], cam["haperture"], cam["vaperture"], cam["near"], cam["far"]))
            pm_bytes = cam["projectionMode"].encode("utf-8")
            fb.write(struct.pack("<H", len(pm_bytes)))
            fb.write(pm_bytes)

    return {"status": "ok", "geometries": len(geometries), "cameras": len(cameras)}


def main():
    parser = argparse.ArgumentParser(description="OpenComp OpenUSD Bridge")
    subparsers = parser.add_subparsers(dest="action", required=True)

    # Inspect
    inspect_parser = subparsers.add_parser("inspect")
    inspect_parser.add_argument("--input", required=True, help="Input USD file")

    # Read
    read_parser = subparsers.add_parser("read")
    read_parser.add_argument("--input", required=True, help="Input USD file")
    read_parser.add_argument("--output", required=True, help="Output binary OC3D file")
    read_parser.add_argument("--prim", default="/", help="Target prim hierarchy path")
    read_parser.add_argument("--frame", type=float, default=1.0, help="Frame time-code")
    read_parser.add_argument("--scale", type=float, default=None, help="Unit scale multiplier")
    read_parser.add_argument("--upAxis", default="auto", choices=["auto", "Y", "Z"], help="Up-axis conversion")
    read_parser.add_argument("--stride", type=int, default=1, help="Point decimation stride")
    read_parser.add_argument("--noCameras", action="store_true", help="Skip camera extraction")
    read_parser.add_argument("--noMeshes", action="store_true", help="Skip mesh extraction")

    args = parser.parse_args()

    try:
        if args.action == "inspect":
            res = inspect_stage(args.input)
            print(json.dumps(res, indent=2))
        elif args.action == "read":
            res = read_stage_data(
                usd_path=args.input,
                out_bin_path=args.output,
                target_prim_path=args.prim,
                frame=args.frame,
                scale=args.scale,
                up_axis_override=args.upAxis,
                stride=args.stride,
                read_cameras=not args.noCameras,
                read_meshes=not args.noMeshes
            )
            print(json.dumps(res))
    except Exception as e:
        print(json.dumps({"error": str(e), "type": type(e).__name__}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
