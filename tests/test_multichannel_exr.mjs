/**
 * OpenComp - Test Suite 29: Multi-Channel & Multi-Layer OpenEXR Architecture
 * Validates arbitrary channel names, CG AOVs (diffuse, specular, depth, normal, cryptomatte),
 * pure JS multi-channel scanline read/write, Python bridge inspect/read/write,
 * channel routing via Shuffle, and channel preservation across the DAG.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { ImageIO } from '../src/core/ImageIO.js';
import { ShuffleNode } from '../src/nodes/ShuffleNode.js';
import { WriteNode } from '../src/nodes/WriteNode.js';
import { ReadNode } from '../src/nodes/ReadNode.js';

const testDir = path.join(os.tmpdir(), `opencomp_test_multichannel_${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ Multi-Channel EXR: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: Multi-Channel EXR: ${name}`);
    console.error(err);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ Multi-Channel EXR: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: Multi-Channel EXR: ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_multichannel_exr.mjs');
console.log('----------------------------------------------------');

const W = 64;
const H = 48;
const numPx = W * H;

// 1. PixelBuffer Multi-Channel API
runTest('PixelBuffer Multi-Channel & AOV Storage', () => {
  const buf = new PixelBuffer(W, H);
  buf.fill(0.2, 0.4, 0.6, 1.0);

  // Set AOVs
  const diffR = new Float32Array(numPx).fill(0.75);
  const diffG = new Float32Array(numPx).fill(0.5);
  const diffB = new Float32Array(numPx).fill(0.25);
  const depthZ = new Float32Array(numPx).map((_, i) => 10.0 + i * 0.1);
  const crypto = new Float32Array(numPx).fill(12345.0);

  buf.setChannel('diffuse.R', diffR);
  buf.setChannel('diffuse.G', diffG);
  buf.setChannel('diffuse.B', diffB);
  buf.setChannel('depth.Z', depthZ);
  buf.setChannel('crypto_object.01', crypto);

  assert.equal(buf.hasChannel('diffuse.R'), true);
  assert.equal(buf.hasChannel('depth.Z'), true);
  assert.equal(buf.hasChannel('nonexistent'), false);

  const channels = buf.getChannelNames();
  assert(channels.includes('R'));
  assert(channels.includes('G'));
  assert(channels.includes('B'));
  assert(channels.includes('A'));
  assert(channels.includes('diffuse.R'));
  assert(channels.includes('diffuse.G'));
  assert(channels.includes('diffuse.B'));
  assert(channels.includes('depth.Z'));
  assert(channels.includes('crypto_object.01'));

  const layers = buf.getLayerNames();
  assert(layers.includes('rgba'));
  assert(layers.includes('diffuse'));
  assert(layers.includes('depth'));
  assert(layers.includes('crypto_object'));

  // Test clone copies extra channels
  const cloned = buf.clone();
  assert.equal(cloned.hasChannel('depth.Z'), true);
  assert.equal(cloned.getChannel('depth.Z')[0], 10.0);
  assert.equal(cloned.getChannel('crypto_object.01')[0], 12345.0);
});

// 2. Pure JS Multi-Channel EXR Writing and Reading (Bit-exact float/half preservation)
runTest('Pure JS Scanline Multi-Channel EXR Round-Trip', () => {
  const buf = new PixelBuffer(W, H);
  buf.fill(0.1, 0.2, 0.3, 1.0);

  const specR = new Float32Array(numPx);
  const specG = new Float32Array(numPx);
  const specB = new Float32Array(numPx);
  const normX = new Float32Array(numPx);
  const normY = new Float32Array(numPx);
  const normZ = new Float32Array(numPx);

  for (let i = 0; i < numPx; i++) {
    specR[i] = (i % 100) / 100;
    specG[i] = 0.85;
    specB[i] = 0.45;
    normX[i] = 0.0;
    normY[i] = 1.0;
    normZ[i] = 0.0;
  }

  buf.setChannel('specular.R', specR);
  buf.setChannel('specular.G', specG);
  buf.setChannel('specular.B', specB);
  buf.setChannel('normal.X', normX);
  buf.setChannel('normal.Y', normY);
  buf.setChannel('normal.Z', normZ);

  // Write with 32-bit float
  const exrFloatBytes = ImageIO.writeEXR(buf, false);
  assert(exrFloatBytes instanceof Uint8Array);
  assert(exrFloatBytes.length > 1000);

  // Read back
  const readBuf = ImageIO.readEXR(exrFloatBytes.buffer);
  assert.equal(readBuf.width, W);
  assert.equal(readBuf.height, H);

  // Verify channels
  assert.equal(readBuf.hasChannel('specular.R'), true);
  assert.equal(readBuf.hasChannel('specular.G'), true);
  assert.equal(readBuf.hasChannel('specular.B'), true);
  assert.equal(readBuf.hasChannel('normal.X'), true);
  assert.equal(readBuf.hasChannel('normal.Y'), true);
  assert.equal(readBuf.hasChannel('normal.Z'), true);

  const readSpecR = readBuf.getChannel('specular.R');
  for (let i = 0; i < 20; i++) {
    assert.ok(Math.abs(readSpecR[i] - specR[i]) < 1e-6, `Pixel ${i} must match float exactness`);
  }
});

// 3. Official OpenEXR Subprocess Bridge Inspection & Channel Validation
await runAsyncTest('Subprocess Bridge EXR Inspection & Metadata', async () => {
  const buf = new PixelBuffer(W, H);
  buf.fill(0.5, 0.6, 0.7, 1.0);
  buf.setChannel('depth.Z', new Float32Array(numPx).fill(42.5));
  buf.setChannel('diffuse.R', new Float32Array(numPx).fill(0.9));

  const outExr = path.join(testDir, 'inspect_test.exr');
  ImageIO.writeEXRViaBridgeSync(buf, true, 'none', 45, outExr);
  assert(fs.existsSync(outExr));

  const inspection = await ImageIO.inspectEXR(outExr);
  assert.equal(inspection.width, W);
  assert.equal(inspection.height, H);
  assert(Array.isArray(inspection.channels));
  assert(inspection.channels.includes('R'));
  assert(inspection.channels.includes('G'));
  assert(inspection.channels.includes('B'));
  assert(inspection.channels.includes('A'));
  assert(inspection.channels.includes('depth.Z'));
  assert(inspection.channels.includes('diffuse.R'));
});

// 4. Subprocess Bridge Multi-Channel Write & Read Round-Trip
runTest('Subprocess Bridge Multi-Channel Read & Write Sync', () => {
  const buf = new PixelBuffer(W, H);
  buf.fill(0.12, 0.34, 0.56, 1.0);
  const zData = new Float32Array(numPx);
  for (let i = 0; i < numPx; i++) zData[i] = 100.0 + i;
  buf.setChannel('depth.Z', zData);

  const outExr = path.join(testDir, 'bridge_roundtrip.exr');
  ImageIO.writeEXRViaBridgeSync(buf, false, 'none', 45, outExr);

  const readBuf = ImageIO.readEXRViaBridgeSync(outExr);
  assert.equal(readBuf.width, W);
  assert.equal(readBuf.height, H);
  assert.equal(readBuf.hasChannel('depth.Z'), true);

  const readZ = readBuf.getChannel('depth.Z');
  assert.equal(readZ[0], 100.0);
  assert.equal(readZ[10], 110.0);
});

// 5. Shuffle Node Channel Re-routing & Extra Channel Preservation
runTest('Shuffle Node AOV Routing (e.g. depth.Z -> Alpha) & Channel Preservation', () => {
  const buf = new PixelBuffer(W, H);
  buf.fill(0.2, 0.4, 0.6, 1.0);

  const zData = new Float32Array(numPx).fill(0.88);
  buf.setChannel('depth.Z', zData);
  buf.setChannel('diffuse.R', new Float32Array(numPx).fill(0.95));

  const shuffle = new ShuffleNode('Shuffle1');
  shuffle.setKnobValue('red', 'diffuse.R');
  shuffle.setKnobValue('green', 'g');
  shuffle.setKnobValue('blue', 'b');
  shuffle.setKnobValue('alpha', 'depth.Z');

  const shuffled = shuffle.compute({ in: buf });
  assert(shuffled instanceof PixelBuffer);

  // Red should now contain diffuse.R (0.95)
  assert.ok(Math.abs(shuffled.data[0] - 0.95) < 1e-4);
  // Green and Blue are preserved
  assert.ok(Math.abs(shuffled.data[1] - 0.4) < 1e-4);
  assert.ok(Math.abs(shuffled.data[2] - 0.6) < 1e-4);
  // Alpha should now contain depth.Z (0.88)
  assert.ok(Math.abs(shuffled.data[3] - 0.88) < 1e-4);

  // Untouched extra channels should be preserved
  assert.equal(shuffled.hasChannel('depth.Z'), true);
  assert.equal(shuffled.hasChannel('diffuse.R'), true);
});

// 6. WriteNode Channel Selection (all vs rgba)
runTest('WriteNode Channel Mode Filtering (All vs RGBA Only)', () => {
  const buf = new PixelBuffer(W, H);
  buf.fill(0.5, 0.5, 0.5, 1.0);
  buf.setChannel('diffuse.R', new Float32Array(numPx).fill(0.3));

  // Write all channels
  const writeAll = new WriteNode('WriteAll');
  writeAll.setKnobValue('fileType', 'image/exr');
  writeAll.setKnobValue('channels', 'all');
  const allBytes = writeAll.exportFrame(buf);
  const readAll = ImageIO.readEXR(allBytes.buffer);
  assert.equal(readAll.hasChannel('diffuse.R'), true);
  assert.equal(readAll.getChannelNames().length, 5);

  // Write RGBA only
  const writeRgba = new WriteNode('WriteRGBA');
  writeRgba.setKnobValue('fileType', 'image/exr');
  writeRgba.setKnobValue('channels', 'rgba');
  const rgbaBytes = writeRgba.exportFrame(buf);
  const readRgba = ImageIO.readEXR(rgbaBytes.buffer);
  assert.equal(readRgba.hasChannel('diffuse.R'), false);
  assert.equal(readRgba.getChannelNames().length, 4);
});

// 7. ReadNode Layer Discovery
runTest('ReadNode Layer Discovery API', () => {
  const buf = new PixelBuffer(W, H);
  buf.setChannel('crypto_material.01', new Float32Array(numPx).fill(99.0));
  buf.setChannel('specular.R', new Float32Array(numPx).fill(0.5));

  const read = new ReadNode('Read1');
  read.setUploadedImage(buf);

  const channels = read.getChannels();
  assert(channels.includes('crypto_material.01'));
  assert(channels.includes('specular.R'));

  const layers = read.getLayers();
  assert(layers.includes('rgba'));
  assert(layers.includes('crypto_material'));
  assert(layers.includes('specular'));
});

// Cleanup
try {
  fs.rmSync(testDir, { recursive: true, force: true });
} catch (e) {}

console.log('\n🎉 test_multichannel_exr.mjs PASSED: All 7 multi-channel EXR tests succeeded with 0 errors.');

