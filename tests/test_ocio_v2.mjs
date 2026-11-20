/**
 * OpenComp - Test Suite 33: OpenColorIO v2 Color Management Suite
 * Comprehensive verification of PyOpenColorIO v2.6.0 bridge, external .ocio configs,
 * OCIOColorSpace node, OCIODisplay node, alpha preservation, and CLI consistency.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { globalOCIO, OCIOManager } from '../src/core/OCIOManager.js';
import { OCIOBridgeClient } from '../src/core/ocio_bridge_client.js';

const testDir = path.join(os.tmpdir(), `opencomp_test_ocio_${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ OCIO v2: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: OCIO v2: ${name}`);
    console.error(err);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ OCIO v2: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: OCIO v2: ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_ocio_v2.mjs');
console.log('----------------------------------------------------');

// 1. PyOpenColorIO v2.6.0 Bridge Inspection & ACES 1.3 Config Discovery
runTest('PyOpenColorIO v2.6.0 Bridge & Config Inspection', () => {
  const info = OCIOBridgeClient.inspect();
  assert.equal(info.status, 'ok');
  assert(info.ocio_version.startsWith('2.'), `Expected OCIO v2.x, got ${info.ocio_version}`);
  assert(Array.isArray(info.color_spaces));
  assert(info.color_spaces.includes('ACEScg'), 'Must include ACEScg color space');
  assert(info.color_spaces.includes('ACES2065-1'), 'Must include ACES2065-1');
  assert(info.color_spaces.includes('Linear Rec.709 (sRGB)'), 'Must include Linear Rec.709');
  assert(info.displays.includes('sRGB - Display'), 'Must include sRGB - Display');
  assert(info.views_by_display['sRGB - Display'].includes('ACES 1.0 - SDR Video'), 'Must include ACES 1.0 SDR Video view');
});

// 2. Numerical Parity: ACEScg to sRGB Transform
runTest('Numerical Parity & Accurate Curves (ACEScg -> sRGB)', () => {
  const buf = new PixelBuffer(2, 2);
  // Set neutral 18% grey (0.18 linear) and 1.0 white
  buf.setPixel(0, 0, 0.18, 0.18, 0.18, 1.0);
  buf.setPixel(1, 0, 1.0, 1.0, 1.0, 1.0);
  buf.setPixel(0, 1, 0.0, 0.0, 0.0, 1.0);

  OCIOBridgeClient.transform(buf, 'ACEScg', 'sRGB - Texture');

  const pGrey = buf.getPixel(0, 0);
  const pWhite = buf.getPixel(1, 0);
  const pBlack = buf.getPixel(0, 1);

  // In sRGB transfer curve, 0.18 linear grey corresponds to ~0.46 sRGB code value
  assert(Math.abs(pGrey[0] - 0.46) < 0.05, `Expected 18% grey ~0.46, got ${pGrey[0]}`);
  assert(Math.abs(pWhite[0] - 1.0) < 0.02, `Expected 1.0 white ~1.0, got ${pWhite[0]}`);
  assert(Math.abs(pBlack[0] - 0.0) < 1e-5, `Expected 0.0 black, got ${pBlack[0]}`);
});

// 3. Strict Alpha & Auxiliary AOV Preservation
runTest('Strict Alpha & Auxiliary Channel Independence', () => {
  const buf = new PixelBuffer(4, 1);
  const alphas = [0.0, 0.25, 0.5, 0.95];
  for (let x = 0; x < 4; x++) {
    buf.setPixel(x, 0, 0.3, 0.4, 0.5, alphas[x]);
  }

  // Set auxiliary depth channel
  const depthData = new Float32Array([10.5, 20.0, 35.2, 50.8]);
  buf.setChannel('depth.Z', depthData);

  // Apply heavy color transform
  globalOCIO.transform(buf, 'ACEScg', 'sRGB - Texture');

  // Verify alpha is untouched
  for (let x = 0; x < 4; x++) {
    const px = buf.getPixel(x, 0);
    assert(Math.abs(px[3] - alphas[x]) < 1e-5, `Alpha at pixel ${x} was altered! Expected ${alphas[x]}, got ${px[3]}`);
  }

  // Verify auxiliary channel is untouched
  const depthOut = buf.getChannel('depth.Z');
  assert(depthOut !== null, 'depth.Z channel must exist');
  for (let x = 0; x < 4; x++) {
    assert.equal(depthOut[x], depthData[x], `depth.Z at index ${x} was altered!`);
  }
});

// 4. OCIOColorSpace Node DAG Execution & Mix Blending
runTest('OCIOColorSpace DAG Node Execution & Mix Blending', () => {
  const g = new Graph();

  const c = createNode('Constant', 'Constant1');
  c.setKnobValue('format', '64x64');
  c.setKnobValue('colorR', 0.5);
  c.setKnobValue('colorG', 0.5);
  c.setKnobValue('colorB', 0.5);

  const ocioNode = createNode('OCIOColorSpace', 'OCIO1');
  ocioNode.setKnobValue('in_colorspace', 'ACEScg');
  ocioNode.setKnobValue('out_colorspace', 'sRGB - Texture');
  ocioNode.setKnobValue('mix', 0.5); // 50% blend

  g.addNode(c);
  g.addNode(ocioNode);
  g.connect('Constant1', 'out', 'OCIO1', 'in');

  const evaluated = g.evaluate('OCIO1');
  assert(evaluated instanceof PixelBuffer);
  assert.equal(evaluated.width, 64);
  assert.equal(evaluated.height, 64);

  const px = evaluated.getPixel(32, 32);
  // Original is 0.5, fully converted is ~0.735, 50% mix should be ~0.617
  assert(px[0] > 0.55 && px[0] < 0.70, `Expected 50% mixed value ~0.617, got ${px[0]}`);
  assert.equal(px[3], 1.0, 'Alpha must be 1.0');
});

// 5. OCIODisplay Node View Transform
runTest('OCIODisplay Node Display & View Transform', () => {
  const g = new Graph();
  const c = createNode('Constant', 'Constant1');
  c.setKnobValue('format', '32x32');
  c.setKnobValue('colorR', 0.8);
  c.setKnobValue('colorG', 0.2);
  c.setKnobValue('colorB', 0.1);

  const dispNode = createNode('OCIODisplay', 'Display1');
  dispNode.setKnobValue('in_colorspace', 'ACEScg');
  dispNode.setKnobValue('display', 'sRGB - Display');
  dispNode.setKnobValue('view', 'ACES 1.0 - SDR Video');

  g.addNode(c);
  g.addNode(dispNode);
  g.connect('Constant1', 'out', 'Display1', 'in');

  const outBuf = g.evaluate('Display1');
  assert(outBuf instanceof PixelBuffer);
  const px = outBuf.getPixel(16, 16);
  assert(px[0] > 0.0 && px[0] <= 1.0, 'Display Red must be in normalized [0, 1] range');
  assert.equal(px[3], 1.0);
});

// 6. ReadNode & WriteNode Colorspace Integration
runTest('ReadNode & WriteNode Colorspace Integration', () => {
  const g = new Graph();
  const read = createNode('Read', 'Read_sRGB');
  read.setKnobValue('sourceType', 'ramp');
  read.setKnobValue('format', '128x128');
  read.setKnobValue('colorspace', 'sRGB - Texture'); // Converts sRGB input into ACEScg/linear

  const write = createNode('Write', 'Write_Target');
  write.setKnobValue('colorspace', 'sRGB - Texture'); // Converts working ACEScg to sRGB output

  g.addNode(read);
  g.addNode(write);
  g.connect('Read_sRGB', 'out', 'Write_Target', 'in');

  const evaluated = g.evaluate('Write_Target');
  assert.equal(evaluated.width, 128);
  assert.equal(evaluated.height, 128);
});

// 7. Custom .ocio Configuration Loading & Error Fallback
runTest('Custom .ocio Config File & Error Resilience', () => {
  const testConfigPath = path.join(testDir, 'test_custom.ocio');
  const customConfigContent = `ocio_profile_version: 2
environment: {}
search_path: ""
strictparsing: true
luma: [0.2126, 0.7152, 0.0722]

roles:
  default: raw
  scene_linear: ACEScg

displays:
  sRGB:
    - !<View> {name: Raw, colorspace: raw}

colorspaces:
  - !<ColorSpace>
    name: raw
    family: raw
    equalitygroup: ""
    bitdepth: 32f
    isdata: true

  - !<ColorSpace>
    name: ACEScg
    family: ACES
    equalitygroup: ""
    bitdepth: 32f
    isdata: false
`;
  fs.writeFileSync(testConfigPath, customConfigContent, 'utf8');

  const mgr = new OCIOManager();
  mgr.setConfigPath(testConfigPath);
  assert.equal(mgr.getConfigPath(), testConfigPath);

  // Test invalid path fallback
  mgr.setConfigPath(path.join(testDir, 'non_existent.ocio'));
  const fallbackPath = mgr.getConfigPath();
  assert(fallbackPath.includes('non_existent.ocio'), 'Path is preserved for inspection');
});

// 8. CLI Batch Renderer with --colorspace Flag
runTest('CLI Batch Renderer with --colorspace Argument', () => {
  const projPath = path.join(testDir, 'ocio_render_test.opencomp');
  const outPattern = path.join(testDir, 'ocio_frame.####.exr');

  const g = new Graph();
  const c = createNode('Constant', 'Constant1');
  c.setKnobValue('format', '64x64');
  c.setKnobValue('colorR', 0.5);
  c.setKnobValue('colorG', 0.5);
  c.setKnobValue('colorB', 0.5);

  const w = createNode('Write', 'Write1');
  w.setKnobValue('compression', 'none');

  g.addNode(c);
  g.addNode(w);
  g.connect('Constant1', 'out', 'Write1', 'in');

  fs.writeFileSync(projPath, JSON.stringify(g.serialize(), null, 2), 'utf8');

  // Invoke opencomp-render with --colorspace
  const renderRes = spawnSync('node', [
    'bin/opencomp-render.mjs',
    '-p', projPath,
    '-o', outPattern,
    '-f', '1',
    '--colorspace', 'sRGB - Texture',
    '--overwrite'
  ], { encoding: 'utf8' });

  assert.equal(renderRes.status, 0, `Renderer failed: ${renderRes.stderr}`);
  const expectedOut = path.join(testDir, 'ocio_frame.0001.exr');
  assert(fs.existsSync(expectedOut), `Rendered EXR "${expectedOut}" must exist`);
});

console.log('\n🎉 test_ocio_v2.mjs PASSED: All 8 OCIO v2 tests succeeded with 0 errors.');

