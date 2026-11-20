#!/usr/bin/env python3
"""
OpenComp - 3D Test Fixture Generator
Generates valid real-format OpenUSD (.usda, .usdc) and Alembic Ogawa (.abc) test assets.
"""

import os
import sys
import math
from pxr import Usd, UsdGeom, Gf, Sdf

# Add src to path for alembic bridge fixture writer
sys.path.insert(0, os.path.abspath("src/core/3d"))
from alembic_bridge import create_alembic_fixture

FIXTURES_DIR = os.path.abspath("tests/fixtures")
os.makedirs(FIXTURES_DIR, exist_ok=True)

print(f"Creating 3D test fixtures in: {FIXTURES_DIR}")

# ---------------------------------------------------------------------------
# 1. Static Cube (USDA & USDC)
# ---------------------------------------------------------------------------
stage_cube = Usd.Stage.CreateInMemory()
UsdGeom.SetStageUpAxis(stage_cube, UsdGeom.Tokens.y)
UsdGeom.SetStageMetersPerUnit(stage_cube, 1.0)

xform_cube = UsdGeom.Xform.Define(stage_cube, "/World")
mesh_cube = UsdGeom.Mesh.Define(stage_cube, "/World/CubeMesh")

# 8 vertices for a 2x2x2 cube centered at origin
cube_pts = [
    (-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
    (-1, -1,  1), (1, -1,  1), (1, 1,  1), (-1, 1,  1)
]
# 6 quad faces
cube_counts = [4, 4, 4, 4, 4, 4]
cube_indices = [
    0, 1, 2, 3,  # Back (-Z)
    4, 7, 6, 5,  # Front (+Z)
    0, 4, 5, 1,  # Bottom (-Y)
    3, 2, 6, 7,  # Top (+Y)
    0, 3, 7, 4,  # Left (-X)
    1, 5, 6, 2   # Right (+X)
]

mesh_cube.CreatePointsAttr(cube_pts)
mesh_cube.CreateFaceVertexCountsAttr(cube_counts)
mesh_cube.CreateFaceVertexIndicesAttr(cube_indices)

# Normals
mesh_cube.CreateNormalsAttr([
    (0, 0, -1), (0, 0, 1), (0, -1, 0),
    (0, 1, 0), (-1, 0, 0), (1, 0, 0)
])

# UVs
pv_api = UsdGeom.PrimvarsAPI(mesh_cube)
st_primvar = pv_api.CreatePrimvar("st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.vertex)
st_primvar.Set([
    (0, 0), (1, 0), (1, 1), (0, 1),
    (0, 0), (1, 0), (1, 1), (0, 1)
])

cube_usda_path = os.path.join(FIXTURES_DIR, "cube_static.usda")
cube_usdc_path = os.path.join(FIXTURES_DIR, "cube_static.usdc")
stage_cube.Export(cube_usda_path)
stage_cube.Export(cube_usdc_path)
print("  Created cube_static.usda and cube_static.usdc")

# ---------------------------------------------------------------------------
# 2. Animated Camera (USDA)
# ---------------------------------------------------------------------------
stage_cam = Usd.Stage.CreateInMemory()
UsdGeom.SetStageUpAxis(stage_cam, UsdGeom.Tokens.y)
UsdGeom.SetStageMetersPerUnit(stage_cam, 1.0)
stage_cam.SetStartTimeCode(1.0)
stage_cam.SetEndTimeCode(10.0)

cam_prim = UsdGeom.Camera.Define(stage_cam, "/Cameras/ShotCam")
focal_attr = cam_prim.CreateFocalLengthAttr()
hap_attr = cam_prim.CreateHorizontalApertureAttr(24.89)
vap_attr = cam_prim.CreateVerticalApertureAttr(18.67)
cam_prim.CreateClippingRangeAttr(Gf.Vec2f(0.1, 5000.0))

cam_xf = UsdGeom.Xformable(cam_prim)
trans_op = cam_xf.AddTranslateOp()

for f in range(1, 11):
    t_code = Usd.TimeCode(f)
    focal_attr.Set(35.0 + (f - 1) * 3.0, t_code) # Zooms from 35mm to 62mm
    trans_op.Set(Gf.Vec3d(0.0, 1.5, 10.0 - f * 0.5), t_code) # Dolly-in

cam_usda_path = os.path.join(FIXTURES_DIR, "camera_animated.usda")
stage_cam.Export(cam_usda_path)
print("  Created camera_animated.usda")

# ---------------------------------------------------------------------------
# 3. Hierarchy Set with Z-Up and Centimeter Units (USDA)
# ---------------------------------------------------------------------------
stage_set = Usd.Stage.CreateInMemory()
UsdGeom.SetStageUpAxis(stage_set, UsdGeom.Tokens.z) # Z-Up
UsdGeom.SetStageMetersPerUnit(stage_set, 0.01)     # Centimeters (1 unit = 0.01 m)

world_xform = UsdGeom.Xform.Define(stage_set, "/World")
buildings = UsdGeom.Xform.Define(stage_set, "/World/Buildings")
bldg_a = UsdGeom.Mesh.Define(stage_set, "/World/Buildings/BuildingA")

# 100cm x 100cm x 200cm tall building (Z is up)
bldg_pts = [
    (0, 0, 0), (100, 0, 0), (100, 100, 0), (0, 100, 0),
    (0, 0, 200), (100, 0, 200), (100, 100, 200), (0, 100, 200)
]
bldg_a.CreatePointsAttr(bldg_pts)
bldg_a.CreateFaceVertexCountsAttr([4, 4, 4, 4, 4, 4])
bldg_a.CreateFaceVertexIndicesAttr(cube_indices)

set_cam = UsdGeom.Camera.Define(stage_set, "/World/Cameras/MainCam")
set_cam.CreateFocalLengthAttr(50.0)

hierarchy_usda_path = os.path.join(FIXTURES_DIR, "hierarchy_set.usda")
stage_set.Export(hierarchy_usda_path)
print("  Created hierarchy_set.usda")

# ---------------------------------------------------------------------------
# 4. Animated Deforming Mesh (USDA)
# ---------------------------------------------------------------------------
stage_deform = Usd.Stage.CreateInMemory()
UsdGeom.SetStageUpAxis(stage_deform, UsdGeom.Tokens.y)
stage_deform.SetStartTimeCode(1.0)
stage_deform.SetEndTimeCode(10.0)

deform_mesh = UsdGeom.Mesh.Define(stage_deform, "/DeformMesh")
pts_attr = deform_mesh.CreatePointsAttr()
deform_mesh.CreateFaceVertexCountsAttr([4])
deform_mesh.CreateFaceVertexIndicesAttr([0, 1, 2, 3])

for f in range(1, 11):
    t_code = Usd.TimeCode(f)
    # Surface wave elevation
    y_wave = math.sin(f * 0.5) * 2.0
    pts_attr.Set([
        (-2, 0, -2), (2, y_wave, -2), (2, y_wave * 0.5, 2), (-2, 0, 2)
    ], t_code)

deform_usda_path = os.path.join(FIXTURES_DIR, "animated_deform.usda")
stage_deform.Export(deform_usda_path)
print("  Created animated_deform.usda")

# ---------------------------------------------------------------------------
# 5. Malformed USDA File
# ---------------------------------------------------------------------------
malformed_usda_path = os.path.join(FIXTURES_DIR, "malformed.usda")
with open(malformed_usda_path, "w", encoding="utf-8") as f:
    f.write("#usda 1.0\ndef Mesh \"Broken\" {\n    int[] faceVertexCounts = [4\n    // Unclosed bracket syntax error\n")
print("  Created malformed.usda")

# ---------------------------------------------------------------------------
# 6. Real-Format Animated Alembic Ogawa Archive (.abc)
# ---------------------------------------------------------------------------
alembic_objects = {
    "/world": {"type": "Xform", "name": "world"},
    "/world/animated_torus": {
        "type": "PolyMesh",
        "name": "animated_torus",
        "samples": {
            "1": {
                "points": [-1.0, 0.0, -1.0, 1.0, 0.0, -1.0, 1.0, 0.0, 1.0, -1.0, 0.0, 1.0],
                "counts": [4],
                "indices": [0, 1, 2, 3],
                "normals": [0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0],
                "uvs": [0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0]
            },
            "5": {
                "points": [-1.0, 1.5, -1.0, 1.0, 1.5, -1.0, 1.0, 1.5, 1.0, -1.0, 1.5, 1.0],
                "counts": [4],
                "indices": [0, 1, 2, 3]
            },
            "10": {
                "points": [-1.0, 4.0, -1.0, 1.0, 4.0, -1.0, 1.0, 4.0, 1.0, -1.0, 4.0, 1.0],
                "counts": [4],
                "indices": [0, 1, 2, 3]
            }
        },
        "transforms": {
            "1": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
            "10": [1,0,0,0, 0,1,0,0, 0,0,1,0, 5,0,0,1] # Translates +5 in X
        }
    },
    "/world/camera_tracking": {
        "type": "Camera",
        "name": "camera_tracking",
        "camera": {
            "focalLength": 50.0,
            "horizontalAperture": 24.89,
            "verticalAperture": 18.67,
            "near": 0.1,
            "far": 10000.0,
            "projectionMode": "perspective"
        },
        "transforms": {
            "1": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,2,10,1],
            "10": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,2,2,1] # Moves forward along Z
        }
    }
}

alembic_abc_path = os.path.join(FIXTURES_DIR, "animated_mesh.abc")
create_alembic_fixture(alembic_abc_path, alembic_objects)
print("  Created animated_mesh.abc (Ogawa)")

# ---------------------------------------------------------------------------
# 7. Malformed Alembic File
# ---------------------------------------------------------------------------
malformed_abc_path = os.path.join(FIXTURES_DIR, "malformed.abc")
with open(malformed_abc_path, "wb") as f:
    f.write(b"CORRUPTED_NON_OGAWA_BINARY_HEADER_DATA")
print("  Created malformed.abc")

print("\n🎉 All 3D USD and Alembic fixtures created successfully!")

