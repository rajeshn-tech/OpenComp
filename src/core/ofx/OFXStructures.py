"""
OpenComp - OpenFX (OFX) 1.4 C-ABI ctypes Structures & Suites
Standard C-ABI type specifications matching official Open Effects Association (OFX) 1.4 headers.
Reference: https://openfx.org
"""

import ctypes
from ctypes import (
    c_void_p, c_char_p, c_int, c_uint, c_double, c_size_t,
    Structure, CFUNCTYPE, POINTER
)

# Handles
OfxPropertySetHandle = c_void_p
OfxParamSetHandle = c_void_p
OfxParamHandle = c_void_p
OfxImageEffectHandle = c_void_p
OfxClipHandle = c_void_p
OfxImageHandle = c_void_p
OfxStatus = c_int
OfxTime = c_double

# Status Constants
kOfxStatOK = 0
kOfxStatFailed = 1
kOfxStatErrFatal = 2
kOfxStatErrUnknown = 3
kOfxStatErrMissingHostFeature = 4
kOfxStatErrUnsupported = 5
kOfxStatErrExists = 6
kOfxStatErrFormat = 7
kOfxStatErrMemory = 8
kOfxStatErrBadHandle = 9
kOfxStatErrBadIndex = 10
kOfxStatErrValue = 11
kOfxStatReplyYes = 12
kOfxStatReplyNo = 13
kOfxStatReplyDefault = 14


# ---------------------------------------------------------------------------
# Geometric Structures
# ---------------------------------------------------------------------------
class OfxPointI(Structure):
    _fields_ = [("x", c_int), ("y", c_int)]

class OfxPointD(Structure):
    _fields_ = [("x", c_double), ("y", c_double)]

class OfxRangeI(Structure):
    _fields_ = [("min", c_int), ("max", c_int)]

class OfxRangeD(Structure):
    _fields_ = [("min", c_double), ("max", c_double)]

class OfxRectI(Structure):
    _fields_ = [("x1", c_int), ("y1", c_int), ("x2", c_int), ("y2", c_int)]

class OfxRectD(Structure):
    _fields_ = [("x1", c_double), ("y1", c_double), ("x2", c_double), ("y2", c_double)]

class OfxRGBAColourD(Structure):
    _fields_ = [("r", c_double), ("g", c_double), ("b", c_double), ("a", c_double)]

class OfxRGBAColourB(Structure):
    _fields_ = [("r", ctypes.c_uint8), ("g", ctypes.c_uint8), ("b", ctypes.c_uint8), ("a", ctypes.c_uint8)]


# ---------------------------------------------------------------------------
# Suite 1: OfxPropertySuiteV1
# ---------------------------------------------------------------------------
# Function prototypes
PropSetPointerFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, c_void_p)
PropSetStringFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, c_char_p)
PropSetDoubleFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, c_double)
PropSetIntFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, c_int)

PropSetPointerNFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, POINTER(c_void_p))
PropSetStringNFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, POINTER(c_char_p))
PropSetDoubleNFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, POINTER(c_double))
PropSetIntNFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, POINTER(c_int))

PropGetPointerFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, POINTER(c_void_p))
PropGetStringFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, POINTER(c_char_p))
PropGetDoubleFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, POINTER(c_double))
PropGetIntFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, POINTER(c_int))

PropGetPointerNFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, POINTER(c_void_p))
PropGetStringNFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, POINTER(c_char_p))
PropGetDoubleNFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, POINTER(c_double))
PropGetIntNFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, c_int, POINTER(c_int))

PropResetFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p)
PropGetDimensionFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle, c_char_p, POINTER(c_int))

class OfxPropertySuiteV1(Structure):
    _fields_ = [
        ("propSetPointer", PropSetPointerFunc),
        ("propSetString", PropSetStringFunc),
        ("propSetDouble", PropSetDoubleFunc),
        ("propSetInt", PropSetIntFunc),
        ("propSetPointerN", PropSetPointerNFunc),
        ("propSetStringN", PropSetStringNFunc),
        ("propSetDoubleN", PropSetDoubleNFunc),
        ("propSetIntN", PropSetIntNFunc),
        ("propGetPointer", PropGetPointerFunc),
        ("propGetString", PropGetStringFunc),
        ("propGetDouble", PropGetDoubleFunc),
        ("propGetInt", PropGetIntFunc),
        ("propGetPointerN", PropGetPointerNFunc),
        ("propGetStringN", PropGetStringNFunc),
        ("propGetDoubleN", PropGetDoubleNFunc),
        ("propGetIntN", PropGetIntNFunc),
        ("propReset", PropResetFunc),
        ("propGetDimension", PropGetDimensionFunc)
    ]


# ---------------------------------------------------------------------------
# Suite 2: OfxParameterSuiteV1
# ---------------------------------------------------------------------------
ParamDefineFunc = CFUNCTYPE(OfxStatus, OfxParamSetHandle, c_char_p, c_char_p, POINTER(OfxPropertySetHandle))
ParamGetHandleFunc = CFUNCTYPE(OfxStatus, OfxParamSetHandle, c_char_p, POINTER(OfxParamHandle), POINTER(OfxPropertySetHandle))
ParamSetGetPropertySetFunc = CFUNCTYPE(OfxStatus, OfxParamSetHandle, POINTER(OfxPropertySetHandle))
ParamGetPropertySetFunc = CFUNCTYPE(OfxStatus, OfxParamHandle, POINTER(OfxPropertySetHandle))

ParamGetValueFunc_Double = CFUNCTYPE(OfxStatus, OfxParamHandle, POINTER(c_double))
ParamGetValueFunc_Int = CFUNCTYPE(OfxStatus, OfxParamHandle, POINTER(c_int))
ParamGetValueFunc_String = CFUNCTYPE(OfxStatus, OfxParamHandle, POINTER(c_char_p))

ParamSetValueFunc_Double = CFUNCTYPE(OfxStatus, OfxParamHandle, c_double)
ParamSetValueFunc_Int = CFUNCTYPE(OfxStatus, OfxParamHandle, c_int)
ParamSetValueFunc_String = CFUNCTYPE(OfxStatus, OfxParamHandle, c_char_p)

ParamGetValueAtTimeFunc_Double = CFUNCTYPE(OfxStatus, OfxParamHandle, OfxTime, POINTER(c_double))
ParamGetValueAtTimeFunc_Int = CFUNCTYPE(OfxStatus, OfxParamHandle, OfxTime, POINTER(c_int))

class OfxParameterSuiteV1(Structure):
    _fields_ = [
        ("paramDefine", ParamDefineFunc),
        ("paramGetHandle", ParamGetHandleFunc),
        ("paramSetGetPropertySet", ParamSetGetPropertySetFunc),
        ("paramGetPropertySet", ParamGetPropertySetFunc),
        ("paramGetValue_double", ParamGetValueFunc_Double),
        ("paramGetValue_int", ParamGetValueFunc_Int),
        ("paramGetValue_string", ParamGetValueFunc_String),
        ("paramSetValue_double", ParamSetValueFunc_Double),
        ("paramSetValue_int", ParamSetValueFunc_Int),
        ("paramSetValue_string", ParamSetValueFunc_String),
        ("paramGetValueAtTime_double", ParamGetValueAtTimeFunc_Double),
        ("paramGetValueAtTime_int", ParamGetValueAtTimeFunc_Int)
    ]


# ---------------------------------------------------------------------------
# Suite 3: OfxImageEffectSuiteV1
# ---------------------------------------------------------------------------
ClipDefineFunc = CFUNCTYPE(OfxStatus, OfxImageEffectHandle, c_char_p, POINTER(OfxPropertySetHandle))
ClipGetHandleFunc = CFUNCTYPE(OfxStatus, OfxImageEffectHandle, c_char_p, POINTER(OfxClipHandle), POINTER(OfxPropertySetHandle))
ClipGetPropertySetFunc = CFUNCTYPE(OfxStatus, OfxClipHandle, POINTER(OfxPropertySetHandle))
ClipGetImageFunc = CFUNCTYPE(OfxStatus, OfxClipHandle, OfxTime, POINTER(OfxRectD), POINTER(OfxPropertySetHandle))
ClipReleaseImageFunc = CFUNCTYPE(OfxStatus, OfxPropertySetHandle)
ClipGetRegionOfDefinitionFunc = CFUNCTYPE(OfxStatus, OfxClipHandle, OfxTime, POINTER(OfxRectD))
AbortFunc = CFUNCTYPE(c_int, OfxImageEffectHandle)

class OfxImageEffectSuiteV1(Structure):
    _fields_ = [
        ("clipDefine", ClipDefineFunc),
        ("clipGetHandle", ClipGetHandleFunc),
        ("clipGetPropertySet", ClipGetPropertySetFunc),
        ("clipGetImage", ClipGetImageFunc),
        ("clipReleaseImage", ClipReleaseImageFunc),
        ("clipGetRegionOfDefinition", ClipGetRegionOfDefinitionFunc),
        ("abort", AbortFunc)
    ]


# ---------------------------------------------------------------------------
# Suite 4: OfxMemorySuiteV1
# ---------------------------------------------------------------------------
MemoryAllocFunc = CFUNCTYPE(OfxStatus, c_void_p, c_size_t, POINTER(c_void_p))
MemoryFreeFunc = CFUNCTYPE(OfxStatus, c_void_p)

class OfxMemorySuiteV1(Structure):
    _fields_ = [
        ("memoryAlloc", MemoryAllocFunc),
        ("memoryFree", MemoryFreeFunc)
    ]


# ---------------------------------------------------------------------------
# Suite 5: OfxMultiThreadSuiteV1
# ---------------------------------------------------------------------------
OfxThreadFunctionV1 = CFUNCTYPE(None, c_uint, c_uint, c_void_p)
MultiThreadFunc = CFUNCTYPE(OfxStatus, OfxThreadFunctionV1, c_uint, c_void_p)
MultiThreadNumCPUsFunc = CFUNCTYPE(OfxStatus, POINTER(c_uint))
MultiThreadIndexFunc = CFUNCTYPE(OfxStatus, POINTER(c_uint))

class OfxMultiThreadSuiteV1(Structure):
    _fields_ = [
        ("multiThread", MultiThreadFunc),
        ("multiThreadNumCPUs", MultiThreadNumCPUsFunc),
        ("multiThreadIndex", MultiThreadIndexFunc)
    ]


# ---------------------------------------------------------------------------
# Host & Plugin Structures
# ---------------------------------------------------------------------------
FetchSuiteFunc = CFUNCTYPE(c_void_p, OfxPropertySetHandle, c_char_p, c_int)

class OfxHost(Structure):
    _fields_ = [
        ("hostHandle", OfxPropertySetHandle),
        ("fetchSuite", FetchSuiteFunc)
    ]

# Plugin Entry function signature:
# OfxStatus mainEntry(const char *action, const void *handle, OfxPropertySetHandle inArgs, OfxPropertySetHandle outArgs);
PluginEntryFunc = CFUNCTYPE(OfxStatus, c_char_p, c_void_p, OfxPropertySetHandle, OfxPropertySetHandle)
SetHostFunc = CFUNCTYPE(None, POINTER(OfxHost))

class OfxPlugin(Structure):
    _fields_ = [
        ("pluginApi", c_char_p),
        ("apiVersion", c_int),
        ("pluginIdentifier", c_char_p),
        ("pluginVersionMajor", c_uint),
        ("pluginVersionMinor", c_uint),
        ("setHost", SetHostFunc),
        ("mainEntry", PluginEntryFunc)
    ]

