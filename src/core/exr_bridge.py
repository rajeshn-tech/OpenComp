#!/usr/bin/env python3
"""
OpenComp - High-Performance OpenEXR Bridge
Bridges the Node.js compositing engine to the official Academy Software Foundation
OpenEXR C++ library (via OpenEXR 3.5+ Python bindings).
Supports:
  - Multi-channel & multi-layer OpenEXRs (arbitrary CG AOVs, diffuse, specular, normal, cryptomatte)
  - DWAA and DWAB lossy DCT compression with configurable quality levels
  - Lossless ZIP and uncompressed scanlines
  - Fast binary channel serialization/deserialization between JS and Python
"""

import sys
import os
import argparse
import json
import struct
import numpy as np

try:
    import OpenEXR
except ImportError:
    print(json.dumps({"error": "OpenEXR Python module is not installed."}), file=sys.stderr)
    sys.exit(1)

MAGIC_OCEX = b'OCEX'  # OpenComp EXR Binary Packet Magic


def inspect_exr(exr_path):
    """Inspect OpenEXR file and return header metadata as JSON"""
    if not os.path.exists(exr_path):
        raise FileNotFoundError(f"EXR file not found: {exr_path}")

    f = OpenEXR.File(exr_path, header_only=True)
    header = f.header()

    # Determine width and height from dataWindow
    dw = header.get('dataWindow')
    if dw is not None:
        # dataWindow is ((xMin, yMin), (xMax, yMax))
        x_min, y_min = dw[0][0], dw[0][1]
        x_max, y_max = dw[1][0], dw[1][1]
        width = int(x_max - x_min + 1)
        height = int(y_max - y_min + 1)
    else:
        width = 1920
        height = 1080

    # Determine compression
    comp = header.get('compression')
    comp_name = str(comp) if comp is not None else 'UNKNOWN'

    # Channels
    f_full = OpenEXR.File(exr_path, separate_channels=True)
    channels_dict = f_full.channels()
    channels = sorted(list(channels_dict.keys()))

    layers = set(['rgba'])
    for ch in channels:
        if '.' in ch:
            layers.add(ch.split('.')[0])

    meta = {
        "width": width,
        "height": height,
        "compression": comp_name,
        "channels": channels,
        "layers": sorted(list(layers)),
        "fileSize": os.path.getsize(exr_path)
    }

    return meta


def read_exr_to_bin(exr_path, out_bin_path):
    """Read OpenEXR (any compression, any channels) and export to binary buffer packet"""
    if not os.path.exists(exr_path):
        raise FileNotFoundError(f"EXR file not found: {exr_path}")

    f = OpenEXR.File(exr_path, separate_channels=True)
    header = f.header()
    ch_dict = f.channels()

    dw = header.get('dataWindow')
    if dw is not None:
        width = int(dw[1][0] - dw[0][0] + 1)
        height = int(dw[1][1] - dw[0][1] + 1)
    else:
        sample_arr = next(iter(ch_dict.values())).pixels
        height, width = sample_arr.shape

    channel_names = sorted(list(ch_dict.keys()))
    num_channels = len(channel_names)

    # Write binary packet
    with open(out_bin_path, 'wb') as fb:
        # Header: MAGIC (4) + width (4) + height (4) + numChannels (4)
        fb.write(MAGIC_OCEX)
        fb.write(struct.pack('<III', width, height, num_channels))

        for name in channel_names:
            name_bytes = name.encode('utf-8')
            fb.write(struct.pack('<H', len(name_bytes)))
            fb.write(name_bytes)

            arr = ch_dict[name].pixels.astype(np.float32)
            fb.write(arr.tobytes())

    # Write companion metadata JSON
    meta_path = out_bin_path + '.meta.json'
    comp = header.get('compression')
    with open(meta_path, 'w', encoding='utf-8') as fm:
        json.dump({
            "width": width,
            "height": height,
            "channels": channel_names,
            "compression": str(comp)
        }, fm)

    return {"status": "ok", "channels": channel_names, "width": width, "height": height}


def write_bin_to_exr(in_bin_path, out_exr_path, compression='none', quality=45.0, is_half=False):
    """Read binary channel packet and serialize to OpenEXR using specified compression"""
    if not os.path.exists(in_bin_path):
        raise FileNotFoundError(f"Input binary packet not found: {in_bin_path}")

    with open(in_bin_path, 'rb') as fb:
        magic = fb.read(4)
        if magic != MAGIC_OCEX:
            raise ValueError(f"Invalid OpenComp EXR packet magic: {magic}")

        width, height, num_channels = struct.unpack('<III', fb.read(12))
        channels_data = {}

        channel_bytes = width * height * 4

        for _ in range(num_channels):
            name_len = struct.unpack('<H', fb.read(2))[0]
            name = fb.read(name_len).decode('utf-8')
            raw = fb.read(channel_bytes)
            arr = np.frombuffer(raw, dtype=np.float32).reshape((height, width))
            if is_half:
                arr = arr.astype(np.float16)
            channels_data[name] = arr

    # Compression enum resolution
    comp_map = {
        'dwaa': OpenEXR.DWAA_COMPRESSION,
        'dwab': OpenEXR.DWAB_COMPRESSION,
        'zip': OpenEXR.ZIP_COMPRESSION,
        'zips': OpenEXR.ZIPS_COMPRESSION,
        'piz': OpenEXR.PIZ_COMPRESSION,
        'none': OpenEXR.NO_COMPRESSION
    }
    comp_str = str(compression).lower()
    if comp_str in ['0', 'uncompressed', 'raw']:
        comp_str = 'none'
    if comp_str not in comp_map:
        raise ValueError(f"Unsupported compression codec: '{compression}'. Supported codecs: {list(comp_map.keys())}")
    selected_comp = comp_map[comp_str]

    header = {
        "compression": selected_comp,
        "type": OpenEXR.scanlineimage
    }
    if str(compression).lower().startswith('dwa'):
        header['dwaCompressionLevel'] = float(quality)

    out_dir = os.path.dirname(os.path.abspath(out_exr_path))
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    f_out = OpenEXR.File(header, channels_data)
    f_out.write(out_exr_path)

    return {
        "status": "ok",
        "output": out_exr_path,
        "fileSize": os.path.getsize(out_exr_path),
        "channels": list(channels_data.keys()),
        "compression": str(compression).lower()
    }


def main():
    parser = argparse.ArgumentParser(description="OpenComp OpenEXR Bridge Tool")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Inspect
    inspect_parser = subparsers.add_parser("inspect")
    inspect_parser.add_argument("--input", required=True, help="Input EXR file")

    # Read
    read_parser = subparsers.add_parser("read")
    read_parser.add_argument("--input", required=True, help="Input EXR file")
    read_parser.add_argument("--output", required=True, help="Output binary packet file")

    # Write
    write_parser = subparsers.add_parser("write")
    write_parser.add_argument("--input", required=True, help="Input binary packet file")
    write_parser.add_argument("--output", required=True, help="Output EXR file")
    write_parser.add_argument("--compression", default="none", help="none, dwaa, dwab, zip, piz")
    write_parser.add_argument("--quality", type=float, default=45.0, help="DWA quality level")
    write_parser.add_argument("--half", action="store_true", help="Write 16-bit half-float")

    args = parser.parse_args()

    try:
        if args.command == "inspect":
            result = inspect_exr(args.input)
            print(json.dumps(result))
        elif args.command == "read":
            result = read_exr_to_bin(args.input, args.output)
            print(json.dumps(result))
        elif args.command == "write":
            result = write_bin_to_exr(
                args.input,
                args.output,
                compression=args.compression,
                quality=args.quality,
                is_half=args.half
            )
            print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
