#!/usr/bin/env bash
# ==============================================================================
# OpenComp - Rocky Linux 9.4 (VFX Reference Platform CY2024) Environment Audit
# Run this script on a Rocky Linux 9.4 workstation to verify dependencies,
# native libraries, GPU drivers, and execute the automated test runner.
# ==============================================================================

set -e

echo "=============================================================================="
echo "🎬 OPENCOMP — ROCKY LINUX 9.4 ENVIRONMENT & DEPENDENCY VALIDATION"
echo "=============================================================================="

# 1. Verify OS Distribution
echo -n "▶ Inspecting Linux Distribution ... "
if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo "Detected: ${NAME} ${VERSION_ID} (${PRETTY_NAME})"
    if [[ "${ID}" != "rocky" && "${ID_LIKE}" != *"rhel"* ]]; then
        echo "⚠️ WARNING: Running on non-RHEL/Rocky distribution (${ID}). VFX Reference Platform targets Rocky Linux 9.4."
    fi
else
    echo "❌ Unknown Linux distribution (/etc/os-release missing)"
fi

# 2. Kernel & Architecture
echo -n "▶ Inspecting Kernel & Architecture ... "
ARCH=$(uname -m)
KERNEL=$(uname -r)
echo "Arch: ${ARCH}, Kernel: ${KERNEL}"
if [ "${ARCH}" != "x86_64" ]; then
    echo "❌ ERROR: OpenComp requires x86_64 architecture."
    exit 1
fi

# 3. Node.js Runtime Check
echo -n "▶ Checking Node.js runtime ... "
if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v)
    echo "Found: ${NODE_VER}"
    MAJOR_VER=$(node -e "console.log(process.versions.node.split('.')[0])")
    if [ "$MAJOR_VER" -lt 20 ]; then
        echo "⚠️ WARNING: Node.js version is older than v20 LTS."
    fi
else
    echo "❌ ERROR: node is not installed in PATH."
    exit 1
fi

# 4. Python 3.10+ / PySide6 / NumPy Check (VFX Reference Platform CY2024)
echo -n "▶ Checking Python & VFX Reference Platform Libraries ... "
PYTHON_BIN=""
if [ -f ".venv/bin/python" ]; then
    PYTHON_BIN=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
fi

if [ -n "$PYTHON_BIN" ]; then
    PY_VER=$($PYTHON_BIN -c "import sys; print(sys.version.split()[0])")
    echo "Python ${PY_VER}"
    $PYTHON_BIN -c "import numpy; import PySide6; import OpenEXR; import PyOpenColorIO; print(f'   [INFO] NumPy {numpy.__version__}, PySide6 {PySide6.__version__}, OpenEXR {getattr(OpenEXR, \"__version__\", \"installed\")}, OCIO {PyOpenColorIO.__version__}')" || {
        echo "⚠️ WARNING: PySide6, NumPy, OpenEXR, or PyOpenColorIO missing in Python environment. Run: pip install -r requirements.txt"
    }
else
    echo "❌ ERROR: python3 not found."
fi

# 5. OpenGL / Mesa Check
echo -n "▶ Checking GPU / Mesa OpenGL Acceleration ... "
if command -v glxinfo >/dev/null 2>&1; then
    GL_VER=$(glxinfo | grep "OpenGL core profile version string" | head -n1 || true)
    if [ -n "$GL_VER" ]; then
        echo "${GL_VER}"
    else
        echo "Found Mesa/GLX"
    fi
else
    echo "glxinfo not found (install mesa-demos for GPU diagnostics)"
fi

# 6. Execute Master Test Runner
echo ""
echo "=============================================================================="
echo "🚀 EXECUTING OPENCOMP MASTER TEST RUNNER ON LINUX"
echo "=============================================================================="
node --max-old-space-size=4096 tests/run_all_tests.mjs

echo ""
echo "=============================================================================="
echo "🎉 ROCKY LINUX VALIDATION COMPLETE"
echo "=============================================================================="

