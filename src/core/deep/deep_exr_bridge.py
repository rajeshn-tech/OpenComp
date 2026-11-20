#!/usr/bin/env python3
"""
OpenComp - Deep OpenEXR Python Subprocess Bridge
Utilizes official OpenEXR 3.5+ C++ bindings to read and write genuine
multi-sample DeepScanLine OpenEXR files with ZIPS compression.
Communicates with OpenComp via binary buffer streaming.
"""

import sys
import os
import json
import struct
import numpy as np

try:
    import OpenEXR
    import Imath
except ImportError as e:
    sys.stderr.write(f"Failed to import OpenEXR: {e}\n")
    sys.exit(1)


def inspect_deep_exr(file_path):
    if not os.path.exists(file_path):
        return {"status": "error", "error": f"File not found: {file_path}"}

    try:
        f = OpenEXR.File(file_path, separate_channels=True)
        if not f.parts:
            return {"status": "error", "error": "No parts found in EXR file"}

        part = f.parts[0]
        w = part.width()
        h = part.height()
        part_type = str(part.type())

        is_deep = "deep" in part_type.lower()
        channels = list(part.channels.keys())
        compression = str(part.compression())

        total_samples = 0
        max_samples = 0

        if is_deep:
            # Count samples from first available channel
            chan_name = "Z" if "Z" in part.channels else channels[0]
            c_data = part.channels[chan_name].pixels
            for y in range(h):
                for x in range(w):
                    s = c_data[y, x]
                    cnt = len(s) if (s is not None and hasattr(s, '__len__')) else 0
                    total_samples += cnt
                    if cnt > max_samples:
                        max_samples = cnt

        return {
            "status": "ok",
            "width": w,
            "height": h,
            "isDeep": is_deep,
            "type": part_type,
            "channels": channels,
            "compression": compression,
            "totalSamples": total_samples,
            "maxSamplesPerPixel": max_samples
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


def read_deep_exr(file_path, out_bin_path):
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    f = OpenEXR.File(file_path, separate_channels=True)
    part = f.parts[0]
    w = part.width()
    h = part.height()
    total_pixels = w * h

    channels = part.channels
    z_chan = channels.get("Z")
    zb_chan = channels.get("ZBack")
    r_chan = channels.get("R")
    g_chan = channels.get("G")
    b_chan = channels.get("B")
    a_chan = channels.get("A")

    z_pixels = z_chan.pixels if z_chan else None
    zb_pixels = zb_chan.pixels if zb_chan else None
    r_pixels = r_chan.pixels if r_chan else None
    g_pixels = g_chan.pixels if g_chan else None
    b_pixels = b_chan.pixels if b_chan else None
    a_pixels = a_chan.pixels if a_chan else None

    # Calculate prefix-sum offsets
    sample_offsets = np.zeros(total_pixels + 1, dtype=np.uint32)
    running = 0

    for y in range(h):
        for x in range(w):
            p = y * w + x
            cnt = 0
            if z_pixels is not None:
                s = z_pixels[y, x]
                if s is not None and hasattr(s, '__len__'):
                    cnt = len(s)
            elif a_pixels is not None:
                s = a_pixels[y, x]
                if s is not None and hasattr(s, '__len__'):
                    cnt = len(s)
            running += cnt
            sample_offsets[p + 1] = running

    total_samples = running
    sample_data = np.zeros(total_samples * 6, dtype=np.float32)

    write_idx = 0
    for y in range(h):
        for x in range(w):
            p = y * w + x
            start = sample_offsets[p]
            count = sample_offsets[p + 1] - start
            if count == 0:
                continue

            z_s = z_pixels[y, x] if z_pixels is not None else None
            zb_s = zb_pixels[y, x] if zb_pixels is not None else None
            r_s = r_pixels[y, x] if r_pixels is not None else None
            g_s = g_pixels[y, x] if g_pixels is not None else None
            b_s = b_pixels[y, x] if b_pixels is not None else None
            a_s = a_pixels[y, x] if a_pixels is not None else None

            for i in range(count):
                zf = float(z_s[i]) if z_s is not None and i < len(z_s) else 1.0
                zb = float(zb_s[i]) if zb_s is not None and i < len(zb_s) else zf
                r = float(r_s[i]) if r_s is not None and i < len(r_s) else 1.0
                g = float(g_s[i]) if g_s is not None and i < len(g_s) else 1.0
                b = float(b_s[i]) if b_s is not None and i < len(b_s) else 1.0
                a = float(a_s[i]) if a_s is not None and i < len(a_s) else 1.0

                sample_data[write_idx] = zf
                sample_data[write_idx + 1] = zb
                sample_data[write_idx + 2] = r
                sample_data[write_idx + 3] = g
                sample_data[write_idx + 4] = b
                sample_data[write_idx + 5] = a
                write_idx += 6

    # Write flat binary: [width: uint32, height: uint32, totalSamples: uint32] + sampleOffsets + sampleData
    with open(out_bin_path, "wb") as f_out:
        f_out.write(struct.pack("<III", w, h, total_samples))
        f_out.write(sample_offsets.tobytes())
        f_out.write(sample_data.tobytes())

    return {"status": "ok", "width": w, "height": h, "totalSamples": total_samples}


def write_deep_exr(in_bin_path, out_exr_path, compression_name="ZIPS"):
    if not os.path.exists(in_bin_path):
        raise FileNotFoundError(f"Input binary not found: {in_bin_path}")

    with open(in_bin_path, "rb") as f_in:
        header_bytes = f_in.read(12)
        w, h, total_samples = struct.unpack("<III", header_bytes)

        offsets_bytes = f_in.read((w * h + 1) * 4)
        sample_offsets = np.frombuffer(offsets_bytes, dtype=np.uint32)

        data_bytes = f_in.read(total_samples * 6 * 4)
        sample_data = np.frombuffer(data_bytes, dtype=np.float32)

    # Reconstruct per-pixel 2D object arrays for OpenEXR
    z_obj = np.empty((h, w), dtype=object)
    zb_obj = np.empty((h, w), dtype=object)
    r_obj = np.empty((h, w), dtype=object)
    g_obj = np.empty((h, w), dtype=object)
    b_obj = np.empty((h, w), dtype=object)
    a_obj = np.empty((h, w), dtype=object)

    for y in range(h):
        for x in range(w):
            p = y * w + x
            start = sample_offsets[p]
            count = sample_offsets[p + 1] - start
            if count == 0:
                continue

            base = start * 6
            pix_samples = sample_data[base : base + count * 6].reshape(count, 6)

            z_obj[y, x] = np.ascontiguousarray(pix_samples[:, 0], dtype=np.float32)
            zb_obj[y, x] = np.ascontiguousarray(pix_samples[:, 1], dtype=np.float32)
            r_obj[y, x] = np.ascontiguousarray(pix_samples[:, 2], dtype=np.float32)
            g_obj[y, x] = np.ascontiguousarray(pix_samples[:, 3], dtype=np.float32)
            b_obj[y, x] = np.ascontiguousarray(pix_samples[:, 4], dtype=np.float32)
            a_obj[y, x] = np.ascontiguousarray(pix_samples[:, 5], dtype=np.float32)

    comp = OpenEXR.ZIPS_COMPRESSION
    if compression_name.upper() == "NONE":
        comp = OpenEXR.NO_COMPRESSION

    header = {
        "type": OpenEXR.deepscanline,
        "compression": comp
    }

    channels = {
        "Z": OpenEXR.Channel(z_obj),
        "ZBack": OpenEXR.Channel(zb_obj),
        "R": OpenEXR.Channel(r_obj),
        "G": OpenEXR.Channel(g_obj),
        "B": OpenEXR.Channel(b_obj),
        "A": OpenEXR.Channel(a_obj)
    }

    part = OpenEXR.Part(header, channels)
    exr_file = OpenEXR.File([part])
    exr_file.write(out_exr_path)

    return {"status": "ok", "width": w, "height": h, "totalSamples": total_samples, "file": out_exr_path}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "error": "Insufficient arguments"}))
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "--inspect":
        if len(sys.argv) < 3:
            print(json.dumps({"status": "error", "error": "Missing EXR path"}))
            sys.exit(1)
        res = inspect_deep_exr(sys.argv[2])
        print(json.dumps(res))

    elif cmd == "--read":
        if len(sys.argv) < 4:
            print(json.dumps({"status": "error", "error": "Missing args for --read: <exr> <out_bin>"}))
            sys.exit(1)
        try:
            res = read_deep_exr(sys.argv[2], sys.argv[3])
            print(json.dumps(res))
        except Exception as e:
            print(json.dumps({"status": "error", "error": str(e)}))
            sys.exit(1)

    elif cmd == "--write":
        if len(sys.argv) < 4:
            print(json.dumps({"status": "error", "error": "Missing args for --write: <in_bin> <out_exr> [comp]"}))
            sys.exit(1)
        comp = sys.argv[4] if len(sys.argv) > 4 else "ZIPS"
        try:
            res = write_deep_exr(sys.argv[2], sys.argv[3], comp)
            print(json.dumps(res))
        except Exception as e:
            print(json.dumps({"status": "error", "error": str(e)}))
            sys.exit(1)

    else:
        print(json.dumps({"status": "error", "error": f"Unknown command {cmd}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
