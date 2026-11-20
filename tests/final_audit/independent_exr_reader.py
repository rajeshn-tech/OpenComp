"""
OpenComp - Final Independent EXR Verification Script
Uses official Academy Software Foundation OpenEXR C++ library (via Python)
to inspect and validate OpenComp rendered EXR files.
"""

import sys
import os
import json
import OpenEXR
import Imath
import numpy as np

def inspect_exr_file(filepath):
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"File not found: {filepath}")
    
    file_size = os.path.getsize(filepath)
    exr_file = OpenEXR.InputFile(filepath)
    header = exr_file.header()
    
    # Extract dimensions
    dw = header['dataWindow']
    disp = header['displayWindow']
    width = dw.max.x - dw.min.x + 1
    height = dw.max.y - dw.min.y + 1
    
    # Extract channels
    channels = header['channels']
    channel_names = list(channels.keys())
    channel_types = {name: str(ch.type) for name, ch in channels.items()}
    
    # Extract compression
    compression = str(header.get('compression', 'UNKNOWN'))
    
    # Extract lineOrder
    line_order = str(header.get('lineOrder', 'UNKNOWN'))
    
    # Extract pixel values for primary channels
    pixel_stats = {}
    pt = Imath.PixelType(Imath.PixelType.FLOAT)
    for name in channel_names[:6]: # inspect up to 6 channels
        raw_bytes = exr_file.channel(name, pt)
        arr = np.frombuffer(raw_bytes, dtype=np.float32)
        pixel_stats[name] = {
            'min': float(np.min(arr)),
            'max': float(np.max(arr)),
            'mean': float(np.mean(arr)),
            'std': float(np.std(arr)),
            'num_pixels': int(len(arr))
        }
    
    # Extract metadata attributes
    metadata = {}
    for k, v in header.items():
        if k not in ['channels', 'dataWindow', 'displayWindow']:
            metadata[k] = str(v)
            
    return {
        'filepath': os.path.abspath(filepath),
        'file_size_bytes': file_size,
        'file_size_mb': round(file_size / (1024 * 1024), 4),
        'width': width,
        'height': height,
        'data_window': {'min_x': dw.min.x, 'min_y': dw.min.y, 'max_x': dw.max.x, 'max_y': dw.max.y},
        'display_window': {'min_x': disp.min.x, 'min_y': disp.min.y, 'max_x': disp.max.x, 'max_y': disp.max.y},
        'channels': channel_names,
        'channel_types': channel_types,
        'compression': compression,
        'line_order': line_order,
        'pixel_stats': pixel_stats,
        'metadata': metadata
    }

if __name__ == '__main__':
    targets = [
        'tests/final_audit/renders/real_shot.0001.exr',
        'tests/final_audit/renders/real_shot.0005.exr',
        'tests/final_audit/pipelines/pipe01_greenscreen_1080p.exr',
        'tests/final_audit/pipelines/pipe02_cg_multipass_4k_dwaa.exr',
        'tests/final_audit/pipelines/pipe03_day_for_night_4k.exr'
    ]
    
    results = {}
    for t in targets:
        if os.path.exists(t):
            print(f"Inspecting independent EXR: {t} ...")
            info = inspect_exr_file(t)
            results[t] = info
            print(f"  Dimensions: {info['width']}x{info['height']}")
            print(f"  Channels: {info['channels']}")
            print(f"  Compression: {info['compression']}")
            print(f"  Size: {info['file_size_mb']} MB")
            for ch, stats in info['pixel_stats'].items():
                print(f"    Channel '{ch}': min={stats['min']:.4f}, max={stats['max']:.4f}, mean={stats['mean']:.4f}")
        else:
            print(f"File not found: {t}")
            
    out_json = 'tests/final_audit/independent_exr_inspection.json'
    with open(out_json, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved independent inspection results to: {out_json}")

