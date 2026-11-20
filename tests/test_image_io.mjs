/**
 * OpenComp Test Suite - Professional VFX Image Pipeline & OpenEXR Verification
 * Tests OpenEXR (.exr) binary encoding/decoding, HDR floating point precision, 
 * half-float conversion, and image sequence pattern resolution.
 */

import { strict as assert } from 'assert';
import { ImageIO } from '../src/core/ImageIO.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_image_io.mjs');
console.log('----------------------------------------------------');

let passedTests = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err.stack || err);
    process.exit(1);
  }
}

// 1. OpenEXR Header & Magic Number Validation
await runTest('ImageIO: OpenEXR Binary Encoding & Magic Number', () => {
  const buf = new PixelBuffer(16, 16);
  buf.fill(0.18, 0.5, 1.25, 1.0); // HDR value 1.25

  const exrBytes = ImageIO.writeEXR(buf);
  assert(exrBytes.length > 100, 'EXR file must contain header and scanlines');

  const view = new DataView(exrBytes.buffer, exrBytes.byteOffset);
  const magic = view.getUint32(0, true);
  assert.equal(magic, 0x01312f76, 'Must match standard OpenEXR magic number 0x01312f76');

  const version = view.getUint32(4, true) & 0xff;
  assert.equal(version, 2, 'Must match OpenEXR version 2');
});

// 2. OpenEXR 32-bit Float Roundtrip Fidelity
await runTest('ImageIO: OpenEXR 32-Bit Float Roundtrip with Unclamped HDR Values', () => {
  const original = new PixelBuffer(8, 8);
  // Set extreme HDR super-white (5.5) and deep negative float (-0.25)
  original.setPixel(2, 2, 5.5, 0.75, -0.25, 0.95);
  original.setPixel(0, 0, 0.0, 0.0, 0.0, 0.0);
  original.setPixel(7, 7, 1.0, 1.0, 1.0, 1.0);

  const exrData = ImageIO.writeEXR(original);
  const decoded = ImageIO.readEXR(exrData);

  assert.equal(decoded.width, 8);
  assert.equal(decoded.height, 8);

  const p = decoded.getPixel(2, 2);
  assert(Math.abs(p[0] - 5.5) < 1e-6, `HDR red value 5.5 must be preserved. Got ${p[0]}`);
  assert(Math.abs(p[1] - 0.75) < 1e-6, `Green value 0.75 must be preserved. Got ${p[1]}`);
  assert(Math.abs(p[2] - (-0.25)) < 1e-6, `Negative blue -0.25 must be preserved. Got ${p[2]}`);
  assert(Math.abs(p[3] - 0.95) < 1e-6, `Alpha 0.95 must be preserved. Got ${p[3]}`);
});

// 3. Half-Float IEEE 754 Conversion
await runTest('ImageIO: 16-bit IEEE 754 Half-Float Precision Conversion', () => {
  // 1.0 in float16 = 0x3C00
  const f1 = ImageIO.halfToFloat(0x3c00);
  assert(Math.abs(f1 - 1.0) < 1e-5, `0x3C00 must equal 1.0. Got ${f1}`);

  // 0.5 in float16 = 0x3800
  const fHalf = ImageIO.halfToFloat(0x3800);
  assert(Math.abs(fHalf - 0.5) < 1e-5, `0x3800 must equal 0.5. Got ${fHalf}`);

  // 0.0 in float16 = 0x0000
  const fZero = ImageIO.halfToFloat(0x0000);
  assert.equal(fZero, 0.0);

  // -2.0 in float16 = 0xC000
  const fNeg2 = ImageIO.halfToFloat(0xc000);
  assert(Math.abs(fNeg2 - (-2.0)) < 1e-5, `0xC000 must equal -2.0. Got ${fNeg2}`);
});

// 4. Image Sequence Pattern Parsing (Nuke Sequence Syntax)
await runTest('ImageIO: Nuke Image Sequence Filename Pattern Resolution', () => {
  // #### syntax
  const p1 = ImageIO.resolveSequenceFrame('plate.####.exr', 101);
  assert.equal(p1, 'plate.0101.exr');

  const p2 = ImageIO.resolveSequenceFrame('vfx_shot.######.exr', 52);
  assert.equal(p2, 'vfx_shot.000052.exr');

  // %04d printf syntax
  const p3 = ImageIO.resolveSequenceFrame('/renders/shot_%04d.png', 7);
  assert.equal(p3, '/renders/shot_0007.png');

  // %03d syntax
  const p4 = ImageIO.resolveSequenceFrame('element_%03d.dpx', 42);
  assert.equal(p4, 'element_042.dpx');
});

// 5. OpenEXR Custom Metadata Preservation & Roundtrip
await runTest('ImageIO: OpenEXR Custom Metadata Header Preservation', () => {
  const buf = new PixelBuffer(8, 8);
  buf.fill(0.18, 0.18, 0.18, 1.0);
  buf.metadata = {
    software: 'OpenComp VFX v1.0',
    shotName: 'SH_042_COMP'
  };

  const exrData = ImageIO.writeEXR(buf, false, { artist: 'Lead Comp TD', frameRate: 24.0 });
  const decoded = ImageIO.readEXR(exrData);

  assert(decoded.metadata, 'Decoded buffer must contain metadata object');
  assert.equal(decoded.metadata.software, 'OpenComp VFX v1.0', 'Custom software metadata preserved');
  assert.equal(decoded.metadata.shotName, 'SH_042_COMP', 'Custom shotName metadata preserved');
  assert.equal(decoded.metadata.artist, 'Lead Comp TD', 'Write-time custom metadata preserved');
  assert.equal(decoded.metadata.frameRate, 24.0, 'Float metadata preserved');
});

// 6. ReadNode Sequence & Missing Frame on_error Policies
await runTest('ReadNode: Missing Frame on_error Policies (error, black, checkerboard, nearest)', async () => {
  const { ReadNode } = await import('../src/nodes/ReadNode.js');
  const read = new ReadNode('read_seq_test');
  read.setKnobValue('format', '1280x720');

  // Setup sparse sequence: frame 10 and frame 20 present
  const frame10Buf = new PixelBuffer(1280, 720);
  frame10Buf.fill(0.1, 0.2, 0.3, 1.0);
  const frame20Buf = new PixelBuffer(1280, 720);
  frame20Buf.fill(0.4, 0.5, 0.6, 1.0);

  read.setSequenceFrame(10, frame10Buf);
  read.setSequenceFrame(20, frame20Buf);

  // Frame 10 request => returns frame 10
  const out10 = read.compute({}, { frame: 10 });
  assert(Math.abs(out10.getPixel(100, 100)[0] - 0.1) < 1e-6);

  // Missing frame 15 with on_error = 'error' (default) => returns null
  read.setKnobValue('on_error', 'error');
  const outErr = read.compute({}, { frame: 15 });
  assert.equal(outErr, null, 'Missing frame with on_error=error must return null');

  // Missing frame 15 with on_error = 'black' => returns black frame RGBA(0,0,0,0)
  read.setKnobValue('on_error', 'black');
  const outBlack = read.compute({}, { frame: 15 });
  assert(outBlack instanceof PixelBuffer);
  assert.equal(outBlack.width, 1280);
  assert.equal(outBlack.height, 720);
  const pxB = outBlack.getPixel(640, 360);
  assert.equal(pxB[0], 0);
  assert.equal(pxB[1], 0);
  assert.equal(pxB[2], 0);
  assert.equal(pxB[3], 0);

  // Missing frame 15 with on_error = 'checkerboard' => returns pink/purple checkerboard
  read.setKnobValue('on_error', 'checkerboard');
  const outChk = read.compute({}, { frame: 15 });
  assert(outChk instanceof PixelBuffer);
  const pxChk = outChk.getPixel(10, 10);
  assert(pxChk[3] === 1.0, 'Checkerboard alpha must be 1.0');
  assert(Math.abs(pxChk[1] - 0.1) < 1e-6, 'Checkerboard missing-frame pink tint');

  // Missing frame 11 with on_error = 'nearest' => nearest is frame 10
  read.setKnobValue('on_error', 'nearest');
  const outNear10 = read.compute({}, { frame: 11 });
  assert(Math.abs(outNear10.getPixel(100, 100)[0] - 0.1) < 1e-6, 'Frame 11 nearest must be frame 10');

  // Missing frame 19 with on_error = 'nearest' => nearest is frame 20
  const outNear20 = read.compute({}, { frame: 19 });
  assert(Math.abs(outNear20.getPixel(100, 100)[0] - 0.4) < 1e-6, 'Frame 19 nearest must be frame 20');
});

console.log(`\n🎉 test_image_io.mjs PASSED: All ${passedTests} Image I/O tests succeeded with 0 errors.\n`);

