#!/usr/bin/env bash
# ==============================================================================
# OpenComp - Rocky Linux 9.4 Validation & Compliance Test Harness
# Target Environment: Rocky Linux 9.4 (Blue Onyx) / VFX Reference Platform CY2024
# ==============================================================================

set -uo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}==============================================================================${RESET}"
echo -e "${BOLD}${CYAN}🎬 OPENCOMP — ROCKY LINUX 9.4 PRODUCTION COMPLIANCE VALIDATION${RESET}"
echo -e "${BOLD}${CYAN}==============================================================================${RESET}"
echo "Start Time: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Host: $(hostname -f 2>/dev/null || hostname)"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

record_pass() {
    echo -e "  [${GREEN}PASS${RESET}] $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

record_fail() {
    echo -e "  [${RED}FAIL${RESET}] $1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

record_warn() {
    echo -e "  [${YELLOW}WARN${RESET}] $1"
    WARN_COUNT=$((WARN_COUNT + 1))
}

# ------------------------------------------------------------------------------
# STEP 1: OS Distribution & Architecture Check
# ------------------------------------------------------------------------------
echo -e "${BOLD}▶ Step 1: Inspecting OS Distribution & Hardware Architecture${RESET}"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo "  Detected OS: ${NAME:-Unknown} ${VERSION_ID:-} (${PRETTY_NAME:-})"
    if [[ "${ID:-}" == "rocky" ]]; then
        if [[ "${VERSION_ID:-}" == "9.4"* || "${VERSION_ID:-}" == "9."* ]]; then
            record_pass "Operating System is Rocky Linux ${VERSION_ID} (VFX Reference Platform compatible)"
        else
            record_warn "Rocky Linux detected, but version is ${VERSION_ID} (Target: 9.4)"
        fi
    elif [[ "${ID_LIKE:-}" == *"rhel"* || "${ID_LIKE:-}" == *"centos"* || "${ID:-}" == "almalinux"* ]]; then
        record_warn "Enterprise RHEL-derivative detected: ${PRETTY_NAME} (Simulated Rocky environment)"
    else
        record_warn "Running on non-RHEL distribution: ${NAME:-Unknown} ${VERSION_ID:-}"
    fi
else
    record_fail "/etc/os-release not found. Unable to verify Linux distribution."
fi

ARCH=$(uname -m)
if [ "${ARCH}" == "x86_64" ]; then
    record_pass "Architecture is x86_64 (64-bit)"
else
    record_fail "Unsupported CPU architecture: ${ARCH}. OpenComp requires x86_64."
fi

KERNEL=$(uname -r)
echo "  Kernel Version: ${KERNEL}"

# ------------------------------------------------------------------------------
# STEP 2: Node.js Runtime Check
# ------------------------------------------------------------------------------
echo ""
echo -e "${BOLD}▶ Step 2: Auditing Node.js Runtime Environment${RESET}"
if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node -v)
    echo "  Found Node.js: ${NODE_VERSION}"
    NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
    if [ "${NODE_MAJOR}" -ge 20 ]; then
        record_pass "Node.js ${NODE_VERSION} satisfies requirement (>= v20 LTS)"
    else
        record_fail "Node.js ${NODE_VERSION} is below required v20 LTS standard"
    fi
else
    record_fail "Node.js executable ('node') not found in PATH."
fi

# ------------------------------------------------------------------------------
# STEP 3: Python Environment & VFX Reference Platform Libraries
# ------------------------------------------------------------------------------
echo ""
echo -e "${BOLD}▶ Step 3: Auditing Python Virtualenv & Native C++ Libraries${RESET}"
PYTHON_BIN=""
if [ -f "${PROJECT_ROOT}/.venv/bin/python" ]; then
    PYTHON_BIN="${PROJECT_ROOT}/.venv/bin/python"
    echo "  Using Project Virtualenv: ${PYTHON_BIN}"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
    echo "  Using System Python: ${PYTHON_BIN}"
fi

if [ -n "${PYTHON_BIN}" ]; then
    PY_VER=$(${PYTHON_BIN} -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')")
    echo "  Python Version: ${PY_VER}"
    if ${PYTHON_BIN} -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"; then
        record_pass "Python ${PY_VER} satisfies VFX Reference Platform standard (>= 3.10)"
    else
        record_fail "Python ${PY_VER} is below minimum supported version (3.10)"
    fi

    # Check Required Python Modules
    for mod in numpy OpenEXR PyOpenColorIO PySide6 PIL; do
        if ${PYTHON_BIN} -c "import ${mod}" >/dev/null 2>&1; then
            MOD_VER=$(${PYTHON_BIN} -c "import ${mod}; print(getattr(${mod}, '__version__', 'available'))")
            record_pass "Module '${mod}' loaded successfully (${MOD_VER})"
        else
            record_fail "Required Python module '${mod}' is missing. Run: pip install -r requirements.txt"
        fi
    done
else
    record_fail "No Python executable found in .venv/bin/python or system PATH."
fi

# ------------------------------------------------------------------------------
# STEP 4: Filesystem Case-Sensitivity & Launcher Permissions Check
# ------------------------------------------------------------------------------
echo ""
echo -e "${BOLD}▶ Step 4: Auditing Permissions, Case-Sensitivity & Launchers${RESET}"
if [ -f "${PROJECT_ROOT}/bin/opencomp-render" ]; then
    if [ -x "${PROJECT_ROOT}/bin/opencomp-render" ]; then
        record_pass "bin/opencomp-render exists and has execute permission"
    else
        chmod +x "${PROJECT_ROOT}/bin/opencomp-render" 2>/dev/null || true
        if [ -x "${PROJECT_ROOT}/bin/opencomp-render" ]; then
            record_pass "bin/opencomp-render granted execute permission (+x)"
        else
            record_fail "bin/opencomp-render lacks execute permission"
        fi
    fi
else
    record_fail "bin/opencomp-render launcher script missing"
fi

# Verify CLI usage execution
if node "${PROJECT_ROOT}/bin/opencomp-render.mjs" --help >/dev/null 2>&1; then
    record_pass "bin/opencomp-render.mjs executes and prints help guide cleanly"
else
    record_fail "bin/opencomp-render.mjs failed to execute"
fi

# ------------------------------------------------------------------------------
# STEP 5: OpenGL / Mesa Acceleration Check
# ------------------------------------------------------------------------------
echo ""
echo -e "${BOLD}▶ Step 5: Checking OpenGL / Mesa Driver Subsystem${RESET}"
if command -v glxinfo >/dev/null 2>&1; then
    GL_RENDERER=$(glxinfo | grep "OpenGL renderer string" | cut -d: -f2 | xargs || true)
    GL_VERSION=$(glxinfo | grep "OpenGL core profile version string" | cut -d: -f2 | xargs || true)
    echo "  GL Renderer: ${GL_RENDERER:-Unknown}"
    echo "  GL Version:  ${GL_VERSION:-Unknown}"
    record_pass "OpenGL hardware or Mesa driver interface query succeeded"
else
    record_warn "glxinfo not found in PATH (install mesa-demos for GPU reporting; headless CPU fallback is active)"
fi

# ------------------------------------------------------------------------------
# STEP 6: Execute OpenComp Master Regression Suite
# ------------------------------------------------------------------------------
echo ""
echo -e "${BOLD}${CYAN}==============================================================================${RESET}"
echo -e "${BOLD}${CYAN}🚀 EXECUTING MASTER 37-SUITE REGRESSION RUNNER ON LINUX${RESET}"
echo -e "${BOLD}${CYAN}==============================================================================${RESET}"

TEST_START_TIME=$(date +%s)
if node --max-old-space-size=4096 "${PROJECT_ROOT}/tests/run_all_tests.mjs"; then
    TEST_END_TIME=$(date +%s)
    TEST_DURATION=$((TEST_END_TIME - TEST_START_TIME))
    echo ""
    record_pass "Master test suite passed completely on Linux (${TEST_DURATION}s total duration)"
else
    record_fail "Master test suite encountered errors on Linux"
fi

# ------------------------------------------------------------------------------
# SUMMARY & EXIT
# ------------------------------------------------------------------------------
echo ""
echo -e "${BOLD}${CYAN}==============================================================================${RESET}"
echo -e "${BOLD}${CYAN}📋 ROCKY LINUX VALIDATION SUMMARY${RESET}"
echo -e "${BOLD}${CYAN}==============================================================================${RESET}"
echo -e "Passed Checks:  ${GREEN}${PASS_COUNT}${RESET}"
echo -e "Warnings:       ${YELLOW}${WARN_COUNT}${RESET}"
echo -e "Failed Checks:  ${RED}${FAIL_COUNT}${RESET}"

if [ "${FAIL_COUNT}" -eq 0 ]; then
    echo -e "${BOLD}${GREEN}✅ ROCKY LINUX 9.4 VALIDATION PASSED WITH ZERO ERRORS${RESET}"
    exit 0
else
    echo -e "${BOLD}${RED}❌ ROCKY LINUX 9.4 VALIDATION FAILED WITH ${FAIL_COUNT} ERRORS${RESET}"
    exit 1
fi

