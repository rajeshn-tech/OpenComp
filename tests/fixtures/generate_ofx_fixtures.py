#!/usr/bin/env python3
"""
OpenComp - OpenFX 1.4 Test Fixture Generator
Creates standard OFX bundle hierarchies matching the official OpenFX filesystem layout.
"""

import os
import json

FIXTURES_DIR = os.path.abspath("tests/fixtures/ofx_plugins")
os.makedirs(FIXTURES_DIR, exist_ok=True)

# 1. Authentic OpenFX bundle: SampleInvert.ofx.bundle
bundle_name = "SampleInvert.ofx.bundle"
bundle_dir = os.path.join(FIXTURES_DIR, bundle_name)

res_dir = os.path.join(bundle_dir, "Contents", "Resources")
win_dir = os.path.join(bundle_dir, "Contents", "x86_64-win")
lin_dir = os.path.join(bundle_dir, "Contents", "x86_64-linux")
os.makedirs(res_dir, exist_ok=True)
os.makedirs(win_dir, exist_ok=True)
os.makedirs(lin_dir, exist_ok=True)

# Write manifest
manifest = {
    "identifier": "org.openfx:SampleInvert",
    "name": "Sample Invert (Bundle)",
    "versionMajor": 1,
    "versionMinor": 2,
    "description": "Standard OpenFX bundle fixture for filesystem discovery testing",
    "supportedContexts": ["OfxImageEffectContextFilter"],
    "supportedBitDepths": ["OfxBitDepthFloat", "OfxBitDepthShort", "OfxBitDepthByte"]
}

with open(os.path.join(bundle_dir, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)

# Write dummy binary files for x86_64-win and x86_64-linux
win_bin = os.path.join(win_dir, "SampleInvert.ofx")
with open(win_bin, "wb") as f:
    # 64-byte mock PE/COFF header placeholder
    f.write(b"MZ\x90\x00\x03\x00\x00\x00OFX_BINARY_MOCK_WIN64_" + b"\x00" * 38)

lin_bin = os.path.join(lin_dir, "SampleInvert.ofx")
with open(lin_bin, "wb") as f:
    # ELF magic header placeholder
    f.write(b"\x7fELF\x02\x01\x01\x00OFX_BINARY_MOCK_LIN64_" + b"\x00" * 38)

# 2. Corrupted bundle to test malformed plugin handling: Malformed.ofx.bundle
bad_bundle = os.path.join(FIXTURES_DIR, "Malformed.ofx.bundle")
os.makedirs(bad_bundle, exist_ok=True)
with open(os.path.join(bad_bundle, "manifest.json"), "w", encoding="utf-8") as f:
    f.write("{ INVALID JSON NOT PARSABLE")

print(f"Created OpenFX fixtures in: {FIXTURES_DIR}")

