#!/usr/bin/env python3
"""
OpenComp - OpenColorIO v2 Native Subprocess Bridge
Interfaces with official PyOpenColorIO (v2.6.0+) for high-fidelity studio color transforms.
Exchanges binary pixel buffers via stdin/stdout with 32-bit floating-point precision.
"""

import sys
import os
import struct
import json

try:
    import PyOpenColorIO as ocio
    import numpy as np
    OCIO_AVAILABLE = True
except Exception as e:
    OCIO_AVAILABLE = False
    OCIO_IMPORT_ERROR = str(e)

_active_config = None
_active_config_path = None
_cpu_processors = {}

def get_config(config_path=None):
    global _active_config, _active_config_path, _cpu_processors
    if not OCIO_AVAILABLE:
        raise RuntimeError(f"PyOpenColorIO is not available: {OCIO_IMPORT_ERROR}")

    target_path = config_path or os.environ.get('OCIO')
    if target_path and target_path == _active_config_path and _active_config is not None:
        return _active_config

    try:
        if target_path and os.path.exists(target_path):
            cfg = ocio.Config.CreateFromFile(target_path)
            _active_config_path = target_path
        elif os.environ.get('OCIO') and os.path.exists(os.environ['OCIO']):
            cfg = ocio.Config.CreateFromEnv()
            _active_config_path = os.environ['OCIO']
        else:
            # High-end default: Academy Color Encoding System CG Config (ACES v1.3 / OCIO v2.3)
            cfg = ocio.Config.CreateFromBuiltinConfig('cg-config-v2.1.0_aces-v1.3_ocio-v2.3')
            _active_config_path = 'builtin:cg-config-v2.1.0_aces-v1.3_ocio-v2.3'
        _active_config = cfg
        _cpu_processors.clear()
        return _active_config
    except Exception as err:
        try:
            cfg = ocio.Config.CreateFromBuiltinConfig('cg-config-v2.1.0_aces-v1.3_ocio-v2.3')
            _active_config_path = 'builtin:cg-config-v2.1.0_aces-v1.3_ocio-v2.3'
            _active_config = cfg
            _cpu_processors.clear()
            return _active_config
        except Exception:
            _active_config = ocio.GetCurrentConfig()
            _active_config_path = None
            _cpu_processors.clear()
            return _active_config

def resolve_space_alias(cfg, space_name):
    if not space_name:
        return 'ACEScg'
    raw = str(space_name).strip()
    # Check exact match
    existing = [cs.getName() for cs in cfg.getColorSpaces()]
    if raw in existing:
        return raw

    # Common aliases
    aliases = {
        'linear': 'Linear Rec.709 (sRGB)',
        'rec709': 'Linear Rec.709 (sRGB)',
        'srgb': 'sRGB - Texture',
        'srgb_texture': 'sRGB - Texture',
        'aces': 'ACEScg',
        'acescg': 'ACEScg',
        'aces2065': 'ACES2065-1',
        'aces2065-1': 'ACES2065-1',
        'p3': 'Linear P3-D65',
        'p3d65': 'Linear P3-D65',
        'raw': 'Raw'
    }
    target = aliases.get(raw.lower(), None)
    if target and target in existing:
        return target

    # Case-insensitive search
    for name in existing:
        if name.lower() == raw.lower():
            return name
        if raw.lower() in name.lower():
            return name

    return raw

def get_processor(src_space, dst_space, config_path=None):
    cfg = get_config(config_path)
    actual_src = resolve_space_alias(cfg, src_space)
    actual_dst = resolve_space_alias(cfg, dst_space)
    key = f"{actual_src}->{actual_dst}"
    if key not in _cpu_processors:
        proc = cfg.getProcessor(actual_src, actual_dst)
        _cpu_processors[key] = proc.getDefaultCPUProcessor()
    return _cpu_processors[key]

def get_display_processor(src_space, display, view, config_path=None):
    cfg = get_config(config_path)
    actual_src = resolve_space_alias(cfg, src_space)
    
    # Resolve display and view
    displays = list(cfg.getDisplays())
    actual_display = display if display in displays else (cfg.getDefaultDisplay() or displays[0])
    views = list(cfg.getViews(actual_display))
    actual_view = view if view in views else (cfg.getDefaultView(actual_display) or views[0])

    key = f"{actual_src}->{actual_display}:{actual_view}"
    if key not in _cpu_processors:
        transform = ocio.DisplayViewTransform()
        transform.setSrc(actual_src)
        transform.setDisplay(actual_display)
        transform.setView(actual_view)
        proc = cfg.getProcessor(transform)
        _cpu_processors[key] = proc.getDefaultCPUProcessor()
    return _cpu_processors[key]

def handle_inspect_config(config_path=None):
    try:
        cfg = get_config(config_path)
        color_spaces = [cs.getName() for cs in cfg.getColorSpaces()]
        displays = list(cfg.getDisplays())
        views_by_display = {}
        for d in displays:
            views_by_display[d] = list(cfg.getViews(d))
        
        default_display = cfg.getDefaultDisplay()
        default_view = cfg.getDefaultView(default_display) if default_display else None

        return {
            'status': 'ok',
            'ocio_version': getattr(ocio, '__version__', '2.x'),
            'config_path': _active_config_path,
            'color_spaces': color_spaces,
            'displays': displays,
            'views_by_display': views_by_display,
            'default_display': default_display,
            'default_view': default_view
        }
    except Exception as e:
        return {'status': 'error', 'error': str(e)}

def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--inspect':
        cfg_path = sys.argv[2] if len(sys.argv) > 2 else None
        res = handle_inspect_config(cfg_path)
        print(json.dumps(res, indent=2))
        return

    # Binary protocol over stdin/stdout
    # Packet Header: Magic 'OCTF' (4 bytes) + JSON Length (uint32)
    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer

    while True:
        magic = stdin.read(4)
        if not magic or len(magic) < 4:
            break
        if magic != b'OCTF':
            # Invalid magic header, abort loop
            break

        header_len_bytes = stdin.read(4)
        if len(header_len_bytes) < 4:
            break
        header_len = struct.unpack('<I', header_len_bytes)[0]
        header_json = stdin.read(header_len).decode('utf-8')
        cmd = json.loads(header_json)

        action = cmd.get('action', 'transform')
        num_pixels = cmd.get('num_pixels', 0)
        src_space = cmd.get('src_space', 'ACEScg')
        dst_space = cmd.get('dst_space', 'sRGB')
        display = cmd.get('display', None)
        view = cmd.get('view', None)
        config_path = cmd.get('config_path', None)

        # Read RGB pixel bytes (num_pixels * 3 * float32)
        expected_bytes = num_pixels * 3 * 4
        pixel_bytes = bytearray()
        while len(pixel_bytes) < expected_bytes:
            chunk = stdin.read(expected_bytes - len(pixel_bytes))
            if not chunk:
                break
            pixel_bytes.extend(chunk)

        try:
            if display and view:
                processor = get_display_processor(src_space, display, view, config_path)
            else:
                processor = get_processor(src_space, dst_space, config_path)

            arr = np.frombuffer(pixel_bytes, dtype=np.float32)
            # Reshape to (num_pixels, 3)
            rgb_arr = arr.reshape((num_pixels, 3))

            # Apply CPU processor in-place or return transformed array
            processor.applyRGB(rgb_arr)
            out_bytes = rgb_arr.tobytes()

            resp_header = json.dumps({'status': 'ok', 'bytes_length': len(out_bytes)}).encode('utf-8')
            stdout.write(b'OCTF')
            stdout.write(struct.pack('<I', len(resp_header)))
            stdout.write(resp_header)
            stdout.write(out_bytes)
            stdout.flush()
        except Exception as err:
            err_header = json.dumps({'status': 'error', 'error': str(err), 'bytes_length': 0}).encode('utf-8')
            stdout.write(b'OCTF')
            stdout.write(struct.pack('<I', len(err_header)))
            stdout.write(err_header)
            stdout.flush()

if __name__ == '__main__':
    main()
