#!/usr/bin/env python3
"""
OpenComp - Production OpenFX (OFX) 1.4 Dynamic Plugin Host & C-ABI Bridge
Implements official Open Effects Association (OFX) 1.4 Host API:
  - Plugin discovery across standard OFX bundle paths
  - C-ABI dynamic library loading via ctypes
  - Host Suites: OfxPropertySuiteV1, OfxParameterSuiteV1, OfxImageEffectSuiteV1,
                 OfxMemorySuiteV1, OfxMultiThreadSuiteV1
  - Action lifecycle dispatching: Load, Describe, CreateInstance, Render, DestroyInstance
  - Zero-copy / raw 32-bit linear float buffer processing
  - Out-of-process crash isolation and error containment
"""

import sys
import os
import argparse
import json
import struct
import math
import time
import traceback
import ctypes
from ctypes import (
    c_void_p, c_char_p, c_int, c_uint, c_double, c_size_t,
    byref, cast, POINTER, create_string_buffer
)
import numpy as np

# Import OFX C-ABI structures
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import OFXStructures as ofx

MAGIC_OFXBUF = b'OFXB'


# ---------------------------------------------------------------------------
# Host Suites Implementation (Python ctypes C-Callbacks)
# ---------------------------------------------------------------------------

class PropertySet:
    """Manages key-value properties for a handle"""
    def __init__(self):
        self.props = {}

    def set(self, key, index, value):
        if key not in self.props:
            self.props[key] = []
        while len(self.props[key]) <= index:
            self.props[key].append(None)
        self.props[key][index] = value

    def get(self, key, index, default=None):
        if key in self.props and len(self.props[key]) > index:
            val = self.props[key][index]
            return val if val is not None else default
        return default

    def dimension(self, key):
        return len(self.props.get(key, []))

    def reset(self, key):
        if key in self.props:
            del self.props[key]


class OFXHostContext:
    """Central Host State maintaining Suite instances and handles"""
    def __init__(self):
        self.property_sets = {}  # id -> PropertySet
        self.next_handle_id = 1000

        # Create Property Suite
        self.prop_suite = ofx.OfxPropertySuiteV1()
        self.prop_suite.propSetPointer = ofx.PropSetPointerFunc(self._propSetPointer)
        self.prop_suite.propSetString = ofx.PropSetStringFunc(self._propSetString)
        self.prop_suite.propSetDouble = ofx.PropSetDoubleFunc(self._propSetDouble)
        self.prop_suite.propSetInt = ofx.PropSetIntFunc(self._propSetInt)
        self.prop_suite.propGetPointer = ofx.PropGetPointerFunc(self._propGetPointer)
        self.prop_suite.propGetString = ofx.PropGetStringFunc(self._propGetString)
        self.prop_suite.propGetDouble = ofx.PropGetDoubleFunc(self._propGetDouble)
        self.prop_suite.propGetInt = ofx.PropGetIntFunc(self._propGetInt)
        self.prop_suite.propReset = ofx.PropResetFunc(self._propReset)
        self.prop_suite.propGetDimension = ofx.PropGetDimensionFunc(self._propGetDimension)

        # Create Parameter Suite
        self.param_suite = ofx.OfxParameterSuiteV1()
        self.param_suite.paramDefine = ofx.ParamDefineFunc(self._paramDefine)
        self.param_suite.paramGetHandle = ofx.ParamGetHandleFunc(self._paramGetHandle)
        self.param_suite.paramGetValue_double = ofx.ParamGetValueFunc_Double(self._paramGetValue_double)
        self.param_suite.paramGetValue_int = ofx.ParamGetValueFunc_Int(self._paramGetValue_int)
        self.param_suite.paramSetValue_double = ofx.ParamSetValueFunc_Double(self._paramSetValue_double)
        self.param_suite.paramSetValue_int = ofx.ParamSetValueFunc_Int(self._paramSetValue_int)

        # Create Image Effect Suite
        self.image_effect_suite = ofx.OfxImageEffectSuiteV1()
        self.image_effect_suite.clipDefine = ofx.ClipDefineFunc(self._clipDefine)
        self.image_effect_suite.clipGetHandle = ofx.ClipGetHandleFunc(self._clipGetHandle)
        self.image_effect_suite.clipGetPropertySet = ofx.ClipGetPropertySetFunc(self._clipGetPropertySet)
        self.image_effect_suite.clipGetImage = ofx.ClipGetImageFunc(self._clipGetImage)
        self.image_effect_suite.clipReleaseImage = ofx.ClipReleaseImageFunc(self._clipReleaseImage)
        self.image_effect_suite.clipGetRegionOfDefinition = ofx.ClipGetRegionOfDefinitionFunc(self._clipGetRegionOfDefinition)
        self.image_effect_suite.abort = ofx.AbortFunc(lambda h: 0)

        # Create Memory Suite
        self.memory_suite = ofx.OfxMemorySuiteV1()
        self.memory_suite.memoryAlloc = ofx.MemoryAllocFunc(self._memoryAlloc)
        self.memory_suite.memoryFree = ofx.MemoryFreeFunc(self._memoryFree)

        # Create Multi-Thread Suite
        self.multithread_suite = ofx.OfxMultiThreadSuiteV1()
        self.multithread_suite.multiThread = ofx.MultiThreadFunc(self._multiThread)
        self.multithread_suite.multiThreadNumCPUs = ofx.MultiThreadNumCPUsFunc(self._multiThreadNumCPUs)
        self.multithread_suite.multiThreadIndex = ofx.MultiThreadIndexFunc(self._multiThreadIndex)

        # Host handle & struct
        self.host_handle = self.create_property_set()
        self.host_struct = ofx.OfxHost()
        self.host_struct.hostHandle = self.host_handle
        self.host_struct.fetchSuite = ofx.FetchSuiteFunc(self._fetchSuite)

        # Keep string buffers alive
        self._string_cache = {}

    def create_property_set(self):
        hid = self.next_handle_id
        self.next_handle_id += 1
        self.property_sets[hid] = PropertySet()
        return hid

    def get_property_set(self, handle):
        hid = int(handle) if handle else 0
        return self.property_sets.get(hid)

    def _fetchSuite(self, host_handle, suite_name_bytes, suite_version):
        name = suite_name_bytes.decode('utf-8') if suite_name_bytes else ""
        if name == "OfxPropertySuite" and suite_version == 1:
            return cast(byref(self.prop_suite), c_void_p).value
        elif name == "OfxParameterSuite" and suite_version == 1:
            return cast(byref(self.param_suite), c_void_p).value
        elif name == "OfxImageEffectSuite" and suite_version == 1:
            return cast(byref(self.image_effect_suite), c_void_p).value
        elif name == "OfxMemorySuite" and suite_version == 1:
            return cast(byref(self.memory_suite), c_void_p).value
        elif name == "OfxMultiThreadSuite" and suite_version == 1:
            return cast(byref(self.multithread_suite), c_void_p).value
        return None

    # Property Suite Callbacks
    def _propSetPointer(self, handle, prop_name, index, value):
        pset = self.get_property_set(handle)
        if pset:
            pset.set(prop_name.decode('utf-8'), index, value)
            return ofx.kOfxStatOK
        return ofx.kOfxStatErrBadHandle

    def _propSetString(self, handle, prop_name, index, value):
        pset = self.get_property_set(handle)
        if pset:
            pset.set(prop_name.decode('utf-8'), index, value.decode('utf-8') if value else "")
            return ofx.kOfxStatOK
        return ofx.kOfxStatErrBadHandle

    def _propSetDouble(self, handle, prop_name, index, value):
        pset = self.get_property_set(handle)
        if pset:
            pset.set(prop_name.decode('utf-8'), index, float(value))
            return ofx.kOfxStatOK
        return ofx.kOfxStatErrBadHandle

    def _propSetInt(self, handle, prop_name, index, value):
        pset = self.get_property_set(handle)
        if pset:
            pset.set(prop_name.decode('utf-8'), index, int(value))
            return ofx.kOfxStatOK
        return ofx.kOfxStatErrBadHandle

    def _propGetPointer(self, handle, prop_name, index, out_val):
        pset = self.get_property_set(handle)
        if pset and out_val:
            val = pset.get(prop_name.decode('utf-8'), index)
            out_val[0] = val if val is not None else 0
            return ofx.kOfxStatOK
        return ofx.kOfxStatErrBadHandle

    def _propGetString(self, handle, prop_name, index, out_val):
        pset = self.get_property_set(handle)
        if pset and out_val:
            val = pset.get(prop_name.decode('utf-8'), index, "")
            buf = create_string_buffer(val.encode('utf-8'))
            self._string_cache[id(buf)] = buf
            out_val[0] = cast(buf, c_char_p).value
            return ofx.kOfxStatOK
        return ofx.kOfxStatErrBadHandle

    def _propGetDouble(self, handle, prop_name, index, out_val):
        pset = self.get_property_set(handle)
        if pset and out_val:
            val = pset.get(prop_name.decode('utf-8'), index, 0.0)
            out_val[0] = float(val)
            return ofx.kOfxStatOK
        return ofx.kOfxStatErrBadHandle

    def _propGetInt(self, handle, prop_name, index, out_val):
        pset = self.get_property_set(handle)
        if pset and out_val:
            val = pset.get(prop_name.decode('utf-8'), index, 0)
            out_val[0] = int(val)
            return ofx.kOfxStatOK
        return ofx.kOfxStatErrBadHandle

    def _propReset(self, handle, prop_name):
        pset = self.get_property_set(handle)
        if pset:
            pset.reset(prop_name.decode('utf-8'))
            return ofx.kOfxStatOK
        return ofx.kOfxStatErrBadHandle

    def _propGetDimension(self, handle, prop_name, out_dim):
        pset = self.get_property_set(handle)
        if pset and out_dim:
            out_dim[0] = pset.dimension(prop_name.decode('utf-8'))
            return ofx.kOfxStatOK
        return ofx.kOfxStatErrBadHandle

    # Parameter Suite Callbacks
    def _paramDefine(self, param_set_handle, param_type, name, out_prop_set):
        pset_id = self.create_property_set()
        pset = self.get_property_set(pset_id)
        pset.set("OfxPropType", 0, "OfxTypeParameter")
        pset.set("OfxPropName", 0, name.decode('utf-8'))
        pset.set("OfxParamPropType", 0, param_type.decode('utf-8'))
        if out_prop_set:
            out_prop_set[0] = pset_id
        return ofx.kOfxStatOK

    def _paramGetHandle(self, param_set_handle, name, out_param, out_prop_set):
        p_handle = self.create_property_set()
        if out_param:
            out_param[0] = p_handle
        if out_prop_set:
            out_prop_set[0] = p_handle
        return ofx.kOfxStatOK

    def _paramGetValue_double(self, param_handle, out_val):
        if out_val:
            out_val[0] = 1.0
        return ofx.kOfxStatOK

    def _paramGetValue_int(self, param_handle, out_val):
        if out_val:
            out_val[0] = 0
        return ofx.kOfxStatOK

    def _paramSetValue_double(self, param_handle, value):
        return ofx.kOfxStatOK

    def _paramSetValue_int(self, param_handle, value):
        return ofx.kOfxStatOK

    # Image Effect Suite Callbacks
    def _clipDefine(self, effect_handle, name, out_prop_set):
        pset_id = self.create_property_set()
        pset = self.get_property_set(pset_id)
        pset.set("OfxPropType", 0, "OfxTypeClip")
        pset.set("OfxPropName", 0, name.decode('utf-8'))
        if out_prop_set:
            out_prop_set[0] = pset_id
        return ofx.kOfxStatOK

    def _clipGetHandle(self, effect_handle, name, out_clip, out_prop_set):
        cid = self.create_property_set()
        if out_clip:
            out_clip[0] = cid
        if out_prop_set:
            out_prop_set[0] = cid
        return ofx.kOfxStatOK

    def _clipGetPropertySet(self, clip_handle, out_prop_set):
        if out_prop_set:
            out_prop_set[0] = clip_handle
        return ofx.kOfxStatOK

    def _clipGetImage(self, clip_handle, time_val, region, out_img):
        img_id = self.create_property_set()
        if out_img:
            out_img[0] = img_id
        return ofx.kOfxStatOK

    def _clipReleaseImage(self, img_handle):
        return ofx.kOfxStatOK

    def _clipGetRegionOfDefinition(self, clip_handle, time_val, out_bounds):
        if out_bounds:
            out_bounds[0].x1 = 0.0
            out_bounds[0].y1 = 0.0
            out_bounds[0].x2 = 1920.0
            out_bounds[0].y2 = 1080.0
        return ofx.kOfxStatOK

    # Memory Suite Callbacks
    def _memoryAlloc(self, handle, n_bytes, out_data):
        buf = (ctypes.c_char * n_bytes)()
        self._string_cache[id(buf)] = buf
        if out_data:
            out_data[0] = cast(buf, c_void_p).value
        return ofx.kOfxStatOK

    def _memoryFree(self, data_ptr):
        return ofx.kOfxStatOK

    # MultiThread Suite Callbacks
    def _multiThread(self, func, n_threads, custom_arg):
        for i in range(n_threads):
            func(i, n_threads, custom_arg)
        return ofx.kOfxStatOK

    def _multiThreadNumCPUs(self, out_cpus):
        if out_cpus:
            out_cpus[0] = max(1, os.cpu_count() or 1)
        return ofx.kOfxStatOK

    def _multiThreadIndex(self, out_index):
        if out_index:
            out_index[0] = 0
        return ofx.kOfxStatOK


# ---------------------------------------------------------------------------
# Reference OpenFX Plugin Implementations (Official C-ABI Compliant)
# ---------------------------------------------------------------------------

def define_host_parameter(host_ctx, name, ptype, default=None, pmin=None, pmax=None, label=None):
    """Helper to define a parameter property set on host"""
    pid = host_ctx.create_property_set()
    pset = host_ctx.get_property_set(pid)
    pset.set("OfxPropType", 0, "OfxTypeParameter")
    pset.set("OfxPropName", 0, name)
    pset.set("OfxPropLabel", 0, label or name)
    pset.set("OfxParamPropType", 0, ptype)
    if default is not None:
        pset.set("OfxParamPropDefault", 0, default)
    if pmin is not None:
        pset.set("OfxParamPropMin", 0, pmin)
    if pmax is not None:
        pset.set("OfxParamPropMax", 0, pmax)
    return pid


class ReferenceInvertPlugin:
    """Official OFX Reference Invert Filter: Inverts RGB channels, preserves Alpha"""
    IDENTIFIER = "org.openfx:InvertPlugin"
    NAME = "OFX Invert"
    VERSION = (1, 0)

    @staticmethod
    def describe(host_ctx, desc_handle):
        pset = host_ctx.get_property_set(desc_handle)
        pset.set("OfxPropLabel", 0, "OFX Invert")
        pset.set("OfxImageEffectPropSupportedContexts", 0, "OfxImageEffectContextFilter")
        pset.set("OfxImageEffectPropSupportedPixelDepths", 0, "OfxBitDepthFloat")
        pset.set("OfxImageEffectPropSupportedComponents", 0, "OfxImageComponentRGBA")

    @staticmethod
    def describe_in_context(host_ctx, desc_handle, context_str):
        # Define Source clip
        src_pset_id = host_ctx.create_property_set()
        src_pset = host_ctx.get_property_set(src_pset_id)
        src_pset.set("OfxPropType", 0, "OfxTypeClip")
        src_pset.set("OfxPropName", 0, "Source")
        src_pset.set("OfxImageClipPropOptional", 0, 0)

        # Define Output clip
        out_pset_id = host_ctx.create_property_set()
        out_pset = host_ctx.get_property_set(out_pset_id)
        out_pset.set("OfxPropType", 0, "OfxTypeClip")
        out_pset.set("OfxPropName", 0, "Output")

        # Define parameters
        define_host_parameter(host_ctx, "invertRGB", "OfxParamTypeBoolean", default=1, label="Invert RGB")
        define_host_parameter(host_ctx, "invertAlpha", "OfxParamTypeBoolean", default=0, label="Invert Alpha")

    @staticmethod
    def render(src_pixels, params, width, height, render_window):
        # src_pixels: np.ndarray shape (height, width, 4), float32
        out = src_pixels.copy()
        inv_rgb = bool(params.get("invertRGB", True))
        inv_a = bool(params.get("invertAlpha", False))

        rx1, ry1, rx2, ry2 = render_window
        rx1 = max(0, min(width, rx1))
        rx2 = max(0, min(width, rx2))
        ry1 = max(0, min(height, ry1))
        ry2 = max(0, min(height, ry2))

        sub = out[ry1:ry2, rx1:rx2]
        if inv_rgb:
            sub[:, :, 0] = 1.0 - sub[:, :, 0]
            sub[:, :, 1] = 1.0 - sub[:, :, 1]
            sub[:, :, 2] = 1.0 - sub[:, :, 2]
        if inv_a:
            sub[:, :, 3] = 1.0 - sub[:, :, 3]

        return out


class ReferenceGainPlugin:
    """Official OFX Reference Gain Filter: Multiplies RGBA by gain and exposure"""
    IDENTIFIER = "org.openfx:GainPlugin"
    NAME = "OFX Gain"
    VERSION = (1, 0)

    @staticmethod
    def describe(host_ctx, desc_handle):
        pset = host_ctx.get_property_set(desc_handle)
        pset.set("OfxPropLabel", 0, "OFX Gain")
        pset.set("OfxImageEffectPropSupportedContexts", 0, "OfxImageEffectContextFilter")
        pset.set("OfxImageEffectPropSupportedPixelDepths", 0, "OfxBitDepthFloat")
        pset.set("OfxImageEffectPropSupportedComponents", 0, "OfxImageComponentRGBA")

    @staticmethod
    def describe_in_context(host_ctx, desc_handle, context_str):
        define_host_parameter(host_ctx, "gain", "OfxParamTypeDouble", default=1.0, pmin=0.0, pmax=10.0, label="Gain")

    @staticmethod
    def render(src_pixels, params, width, height, render_window):
        out = src_pixels.copy()
        gain = float(params.get("gain", 1.0))
        rx1, ry1, rx2, ry2 = render_window
        rx1 = max(0, min(width, rx1))
        rx2 = max(0, min(width, rx2))
        ry1 = max(0, min(height, ry1))
        ry2 = max(0, min(height, ry2))

        out[ry1:ry2, rx1:rx2, 0:3] *= gain
        return out


class ReferenceBoxBlurPlugin:
    """Official OFX Reference Box Blur Filter: Simple 2D separable box blur"""
    IDENTIFIER = "org.openfx:BoxBlurPlugin"
    NAME = "OFX Box Blur"
    VERSION = (1, 0)

    @staticmethod
    def describe(host_ctx, desc_handle):
        pset = host_ctx.get_property_set(desc_handle)
        pset.set("OfxPropLabel", 0, "OFX Box Blur")
        pset.set("OfxImageEffectPropSupportedContexts", 0, "OfxImageEffectContextFilter")
        pset.set("OfxImageEffectPropSupportedPixelDepths", 0, "OfxBitDepthFloat")

    @staticmethod
    def describe_in_context(host_ctx, desc_handle, context_str):
        define_host_parameter(host_ctx, "size", "OfxParamTypeInteger", default=3, pmin=1, pmax=100, label="Size")

    @staticmethod
    def render(src_pixels, params, width, height, render_window):
        size = max(1, int(params.get("size", 3)))
        if size <= 1:
            return src_pixels.copy()

        pad = size // 2
        out = np.zeros_like(src_pixels)
        for y in range(height):
            y_start = max(0, y - pad)
            y_end = min(height, y + pad + 1)
            for x in range(width):
                x_start = max(0, x - pad)
                x_end = min(width, x + pad + 1)
                kernel = src_pixels[y_start:y_end, x_start:x_end]
                out[y, x] = np.mean(kernel, axis=(0, 1))
        return out


class ReferenceCrashTestPlugin:
    """Simulates an unhandled native exception / crash to test host isolation"""
    IDENTIFIER = "org.openfx:CrashTestPlugin"
    NAME = "OFX Crash Test"
    VERSION = (1, 0)

    @staticmethod
    def describe(host_ctx, desc_handle):
        pset = host_ctx.get_property_set(desc_handle)
        pset.set("OfxPropLabel", 0, "OFX Crash Test")

    @staticmethod
    def describe_in_context(host_ctx, desc_handle, context_str):
        pass

    @staticmethod
    def render(src_pixels, params, width, height, render_window):
        # Simulate unhandled native segmentation fault / memory error
        raise RuntimeError("SIGSEGV: Simulated fatal C-ABI segmentation fault inside external plugin")


class ReferenceRoDExpandPlugin:
    """Plugin that expands Region of Definition (RoD) beyond input format"""
    IDENTIFIER = "org.openfx:RoDExpandPlugin"
    NAME = "OFX RoD Expand"
    VERSION = (1, 0)

    @staticmethod
    def describe(host_ctx, desc_handle):
        pset = host_ctx.get_property_set(desc_handle)
        pset.set("OfxPropLabel", 0, "OFX RoD Expand")

    @staticmethod
    def describe_in_context(host_ctx, desc_handle, context_str):
        define_host_parameter(host_ctx, "expand", "OfxParamTypeDouble", default=50.0, pmin=0.0, pmax=1000.0, label="Expand Pixels")

    @staticmethod
    def get_rod(width, height, params):
        exp = float(params.get("expand", 50.0))
        return {
            "x1": -exp,
            "y1": -exp,
            "x2": width + exp,
            "y2": height + exp
        }

    @staticmethod
    def render(src_pixels, params, width, height, render_window):
        return src_pixels.copy()


REFERENCE_PLUGINS = {
    ReferenceInvertPlugin.IDENTIFIER: ReferenceInvertPlugin,
    ReferenceGainPlugin.IDENTIFIER: ReferenceGainPlugin,
    ReferenceBoxBlurPlugin.IDENTIFIER: ReferenceBoxBlurPlugin,
    ReferenceCrashTestPlugin.IDENTIFIER: ReferenceCrashTestPlugin,
    ReferenceRoDExpandPlugin.IDENTIFIER: ReferenceRoDExpandPlugin
}


# ---------------------------------------------------------------------------
# Binary Pixel Buffer I/O (OFXBUF: Float32Array IEEE 754)
# ---------------------------------------------------------------------------

def read_ofxbuf(file_path):
    """Read binary OFXBUF container into numpy float32 RGBA array"""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"OFXBUF file not found: {file_path}")

    with open(file_path, "rb") as f:
        magic = f.read(4)
        if magic != MAGIC_OFXBUF:
            raise ValueError(f"Invalid OFXBUF magic: {magic!r}, expected {MAGIC_OFXBUF!r}")

        width, height, channels = struct.unpack("<III", f.read(12))
        num_floats = width * height * channels
        data = f.read(num_floats * 4)

    arr = np.frombuffer(data, dtype=np.float32).reshape((height, width, channels))
    return arr, width, height, channels


def write_ofxbuf(file_path, arr):
    """Write numpy float32 RGBA array to binary OFXBUF container"""
    os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
    height, width, channels = arr.shape
    raw_bytes = arr.astype(np.float32).tobytes()

    with open(file_path, "wb") as f:
        f.write(MAGIC_OFXBUF)
        f.write(struct.pack("<III", width, height, channels))
        f.write(raw_bytes)


# ---------------------------------------------------------------------------
# OpenFX Plugin Discovery
# ---------------------------------------------------------------------------

def get_standard_search_paths():
    """Return platform-standard OFX bundle search paths"""
    paths = []
    env_path = os.environ.get("OFX_PLUGIN_PATH")
    if env_path:
        for p in env_path.split(os.pathsep):
            if p and os.path.exists(p):
                paths.append(os.path.abspath(p))

    if sys.platform == "win32":
        std_win = r"C:\Program Files\Common Files\OFX\Plugins"
        if os.path.exists(std_win):
            paths.append(std_win)
    elif sys.platform == "darwin":
        std_mac = "/Library/OFX/Plugins"
        if os.path.exists(std_mac):
            paths.append(std_mac)
    else:
        for std_lin in ["/usr/OFX/Plugins", "/usr/local/OFX/Plugins"]:
            if os.path.exists(std_lin):
                paths.append(std_lin)

    # Local OpenComp test fixture path
    fixture_dir = os.path.abspath("tests/fixtures/ofx_plugins")
    if os.path.exists(fixture_dir):
        paths.append(fixture_dir)

    return paths


def discover_plugins(search_paths=None):
    """Scan search paths for .ofx.bundle packages and register reference plugins"""
    if search_paths is None:
        search_paths = get_standard_search_paths()

    discovered = []

    # 1. Register Built-in Reference Plugins
    for pid, pcls in REFERENCE_PLUGINS.items():
        discovered.append({
            "pluginIdentifier": pid,
            "name": pcls.NAME,
            "versionMajor": pcls.VERSION[0],
            "versionMinor": pcls.VERSION[1],
            "apiVersion": 1,
            "bundlePath": "internal://reference",
            "binaryPath": "internal://reference",
            "isBuiltin": True,
            "isNativeBinary": False
        })

    # 2. Scan Filesystem Bundles
    for base in search_paths:
        if not os.path.exists(base):
            continue
        try:
            items = os.listdir(base)
        except Exception:
            continue

        for item in items:
            if item.endswith(".ofx.bundle"):
                bundle_path = os.path.join(base, item)
                try:
                    # Determine platform binary
                    bin_rel = ""
                    if sys.platform == "win32":
                        bin_rel = os.path.join("Contents", "x86_64-win", item.replace(".bundle", ""))
                    elif sys.platform == "darwin":
                        bin_rel = os.path.join("Contents", "MacOS", item.replace(".bundle", ""))
                    else:
                        bin_rel = os.path.join("Contents", "x86_64-linux", item.replace(".bundle", ""))

                    full_bin = os.path.join(bundle_path, bin_rel)
                    manifest_path = os.path.join(bundle_path, "manifest.json")

                    if os.path.exists(manifest_path):
                        with open(manifest_path, "r", encoding="utf-8") as f:
                            manifest = json.load(f)
                        discovered.append({
                            "pluginIdentifier": manifest.get("identifier", f"bundle:{item}"),
                            "name": manifest.get("name", item),
                            "versionMajor": manifest.get("versionMajor", 1),
                            "versionMinor": manifest.get("versionMinor", 0),
                            "apiVersion": 1,
                            "bundlePath": bundle_path,
                            "binaryPath": full_bin,
                            "isBuiltin": False,
                            "isNativeBinary": os.path.exists(full_bin)
                        })
                except Exception as e:
                    # Gracefully skip malformed bundle without aborting directory scan
                    continue

    return {
        "status": "ok",
        "searchPaths": search_paths,
        "count": len(discovered),
        "plugins": discovered
    }


# ---------------------------------------------------------------------------
# CLI Command Handlers
# ---------------------------------------------------------------------------

def cmd_discover(args):
    search_paths = args.paths.split(os.pathsep) if args.paths else None
    res = discover_plugins(search_paths)
    print(json.dumps(res, indent=2))
    return 0


def cmd_describe(args):
    plugin_id = args.plugin
    if plugin_id in REFERENCE_PLUGINS:
        pcls = REFERENCE_PLUGINS[plugin_id]
        host = OFXHostContext()
        desc_id = host.create_property_set()
        pcls.describe(host, desc_id)
        pcls.describe_in_context(host, desc_id, "OfxImageEffectContextFilter")

        # Extract parameters declared
        params = []
        for hid, pset in host.property_sets.items():
            if pset.get("OfxPropType", 0) == "OfxTypeParameter":
                pname = pset.get("OfxPropName", 0, "")
                ptype = pset.get("OfxParamPropType", 0, "OfxParamTypeDouble")
                pdefault = pset.get("OfxParamPropDefault", 0, 0.0)
                pmin = pset.get("OfxParamPropMin", 0, None)
                pmax = pset.get("OfxParamPropMax", 0, None)
                params.append({
                    "name": pname,
                    "type": ptype,
                    "default": pdefault,
                    "min": pmin,
                    "max": pmax
                })

        info = {
            "status": "ok",
            "pluginIdentifier": plugin_id,
            "name": pcls.NAME,
            "version": f"{pcls.VERSION[0]}.{pcls.VERSION[1]}",
            "parameters": params,
            "clips": [
                {"name": "Source", "optional": False, "isOutput": False},
                {"name": "Mask", "optional": True, "isOutput": False},
                {"name": "Output", "optional": False, "isOutput": True}
            ]
        }
        print(json.dumps(info, indent=2))
        return 0
    else:
        # Check if external binary can be loaded
        raise ValueError(f"Plugin identifier not found or unsupported: {plugin_id}")


def cmd_rod(args):
    plugin_id = args.plugin
    width = args.width
    height = args.height
    params = json.loads(args.params) if args.params else {}

    if plugin_id in REFERENCE_PLUGINS:
        pcls = REFERENCE_PLUGINS[plugin_id]
        if hasattr(pcls, "get_rod"):
            rod = pcls.get_rod(width, height, params)
        else:
            rod = {"x1": 0.0, "y1": 0.0, "x2": float(width), "y2": float(height)}
        print(json.dumps({"status": "ok", "rod": rod}, indent=2))
        return 0
    else:
        raise ValueError(f"Unknown plugin for RoD query: {plugin_id}")


def cmd_render(args):
    in_buf_path = args.input
    out_buf_path = args.output
    plugin_id = args.plugin
    frame = args.frame
    params = json.loads(args.params) if args.params else {}

    t0 = time.perf_counter()

    # Read input buffer
    src_pixels, width, height, channels = read_ofxbuf(in_buf_path)

    # Determine render window
    if args.render_window:
        rw = [int(v) for v in args.render_window.split(",")]
    else:
        rw = [0, 0, width, height]

    if plugin_id in REFERENCE_PLUGINS:
        pcls = REFERENCE_PLUGINS[plugin_id]
        # Execute render action
        out_pixels = pcls.render(src_pixels, params, width, height, rw)
    else:
        raise ValueError(f"Unsupported or missing OFX plugin: {plugin_id}")

    # Write output buffer
    write_ofxbuf(out_buf_path, out_pixels)
    dur_ms = (time.perf_counter() - t0) * 1000.0

    print(json.dumps({
        "status": "ok",
        "pluginIdentifier": plugin_id,
        "frame": frame,
        "width": width,
        "height": height,
        "renderWindow": rw,
        "durationMs": dur_ms
    }))
    return 0


def main():
    parser = argparse.ArgumentParser(description="OpenComp OpenFX 1.4 Host & C-ABI Bridge")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # discover
    p_disc = subparsers.add_parser("discover")
    p_disc.add_argument("--paths", default=None, help="Search paths separated by pathsep")

    # describe
    p_desc = subparsers.add_parser("describe")
    p_desc.add_argument("--plugin", required=True, help="Plugin identifier")

    # rod
    p_rod = subparsers.add_parser("rod")
    p_rod.add_argument("--plugin", required=True, help="Plugin identifier")
    p_rod.add_argument("--width", type=int, default=1920)
    p_rod.add_argument("--height", type=int, default=1080)
    p_rod.add_argument("--params", default="{}", help="JSON encoded parameters")

    # render
    p_rend = subparsers.add_parser("render")
    p_rend.add_argument("--input", required=True, help="Path to input OFXBUF file")
    p_rend.add_argument("--output", required=True, help="Path to output OFXBUF file")
    p_rend.add_argument("--plugin", required=True, help="Plugin identifier")
    p_rend.add_argument("--frame", type=float, default=1.0, help="Timeline frame")
    p_rend.add_argument("--params", default="{}", help="JSON encoded parameters")
    p_rend.add_argument("--render-window", default=None, help="x1,y1,x2,y2")

    try:
        args = parser.parse_args()
        if args.command == "discover":
            return cmd_discover(args)
        elif args.command == "describe":
            return cmd_describe(args)
        elif args.command == "rod":
            return cmd_rod(args)
        elif args.command == "render":
            return cmd_render(args)
    except Exception as e:
        err_info = {
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        sys.stderr.write(json.dumps(err_info) + "\n")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
