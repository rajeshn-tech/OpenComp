/**
 * OpenComp - Milestone 2: Grade Node Optimization & Parity Test Suite
 * Validates mathematical precision, HDR fidelity, clamping behavior,
 * reverse grading, masked grading, tiled buffer execution, and performance.
 */

import fs from 'fs';
import path from 'path';
import { GradeNode } from '../src/nodes/GradeNode.js';
import { PixelBuffer, TiledPixelBuffer } from '../src/core/PixelBuffer.js';
import { ImageIO } from '../src/core/ImageIO.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAILED: ${message}`);
  }
}

console.log('🧪 Running Milestone 2: Grade Node Optimization & Parity Suite...\n');

// --------------------------------------------------------------------------
// 1. Exact Nuke Math & Linear Gamma Test
// --------------------------------------------------------------------------
{
  const node = new GradeNode('test_linear');
  node.setKnobValue('lift', 0.1);
  node.setKnobValue('gain', 1.5);
  node.setKnobValue('gamma', 1.0);
  node.setKnobValue('blackClamp', false);
  node.setKnobValue('whiteClamp', false);

  const buf = new PixelBuffer(2, 2);
  buf.setPixel(0, 0, 0.0, 0.5, 1.0, 1.0);
  buf.setPixel(1, 0, 0.2, 0.4, 0.8, 0.5);

  const out = node.compute({ in: buf });

  // A = 1.0 * (1.5 - 0.1) / 1.0 = 1.4
  // B = 0.0 + 0.1 - 1.4 * 0 = 0.1
  // y = 1.4 * x + 0.1
  const r0 = out.getPixel(0, 0);
  assert(Math.abs(r0[0] - (1.4 * 0.0 + 0.1)) < 1e-6, `Linear R0 math: expected 0.1, got ${r0[0]}`);
  assert(Math.abs(r0[1] - (1.4 * 0.5 + 0.1)) < 1e-6, `Linear G0 math: expected 0.8, got ${r0[1]}`);
  assert(Math.abs(r0[2] - (1.4 * 1.0 + 0.1)) < 1e-6, `Linear B0 math: expected 1.5, got ${r0[2]}`);
  assert(r0[3] === 1.0, `Linear alpha preserved: got ${r0[3]}`);
}

// --------------------------------------------------------------------------
// 2. Non-linear Gamma with High Precision LUT & HDR Values (> 1.0 and > 4.0)
// --------------------------------------------------------------------------
{
  const node = new GradeNode('test_gamma_hdr');
  node.setKnobValue('gamma', 2.2);
  node.setKnobValue('gain', 1.0);
  node.setKnobValue('blackClamp', true);
  node.setKnobValue('whiteClamp', false);

  const buf = new PixelBuffer(4, 1);
  // Test in LUT range (< 4.0) and specular HDR range (> 4.0)
  buf.setPixel(0, 0, 0.25, 0.5, 0.75, 1.0);
  buf.setPixel(1, 0, 1.5, 2.5, 3.8, 1.0);
  buf.setPixel(2, 0, 4.5, 8.0, 20.0, 1.0); // Specular HDR values
  buf.setPixel(3, 0, -0.5, 0.0, 0.001, 1.0);

  const out = node.compute({ in: buf });
  const invGamma = 1.0 / 2.2;

  // Pixel 0 (normal range)
  const p0 = out.getPixel(0, 0);
  assert(Math.abs(p0[0] - Math.pow(0.25, invGamma)) < 1e-5, `LUT range accuracy p0[0]: got ${p0[0]}`);
  assert(Math.abs(p0[1] - Math.pow(0.5, invGamma)) < 1e-5, `LUT range accuracy p0[1]: got ${p0[1]}`);

  // Pixel 2 (HDR specular values > 4.0)
  const p2 = out.getPixel(2, 0);
  assert(Math.abs(p2[0] - Math.pow(4.5, invGamma)) < 1e-5, `HDR specular bypass p2[0]: got ${p2[0]}`);
  assert(Math.abs(p2[1] - Math.pow(8.0, invGamma)) < 1e-5, `HDR specular bypass p2[1]: got ${p2[1]}`);
  assert(Math.abs(p2[2] - Math.pow(20.0, invGamma)) < 1e-5, `HDR specular bypass p2[2]: got ${p2[2]}`);
  assert(p2[2] > 1.0, `HDR values preserved (> 1.0) when whiteClamp is false: got ${p2[2]}`);

  // Pixel 3 (negative and zero)
  const p3 = out.getPixel(3, 0);
  assert(p3[0] === 0.0, `Negative clamped to 0 when blackClamp is true: got ${p3[0]}`);
  assert(p3[1] === 0.0, `Zero clamped to 0: got ${p3[1]}`);
}

// --------------------------------------------------------------------------
// 3. Black Clamp and White Clamp Bounds
// --------------------------------------------------------------------------
{
  const nodeNoClamp = new GradeNode('test_no_clamp');
  nodeNoClamp.setKnobValue('offset', -0.5);
  nodeNoClamp.setKnobValue('gain', 2.0);
  nodeNoClamp.setKnobValue('blackClamp', false);
  nodeNoClamp.setKnobValue('whiteClamp', false);

  const buf = new PixelBuffer(2, 1);
  buf.setPixel(0, 0, 0.1, 0.9, 0.5, 1.0);

  const outNoClamp = nodeNoClamp.compute({ in: buf });
  const pNoClamp = outNoClamp.getPixel(0, 0);
  assert(pNoClamp[0] < 0, `Negative values allowed when blackClamp=false: got ${pNoClamp[0]}`);
  assert(pNoClamp[1] > 1, `Values > 1.0 allowed when whiteClamp=false: got ${pNoClamp[1]}`);

  const nodeClamped = new GradeNode('test_clamped');
  nodeClamped.setKnobValue('offset', -0.5);
  nodeClamped.setKnobValue('gain', 2.0);
  nodeClamped.setKnobValue('blackClamp', true);
  nodeClamped.setKnobValue('whiteClamp', true);

  const outClamped = nodeClamped.compute({ in: buf });
  const pClamped = outClamped.getPixel(0, 0);
  assert(pClamped[0] === 0.0, `Clamped to 0 when blackClamp=true: got ${pClamped[0]}`);
  assert(pClamped[1] === 1.0, `Clamped to 1 when whiteClamp=true: got ${pClamped[1]}`);
}

// --------------------------------------------------------------------------
// 4. Reverse Grading Inversion
// --------------------------------------------------------------------------
{
  const fwdNode = new GradeNode('fwd');
  fwdNode.setKnobValue('lift', 0.05);
  fwdNode.setKnobValue('gain', 1.2);
  fwdNode.setKnobValue('gamma', 1.15);
  fwdNode.setKnobValue('blackClamp', false);
  fwdNode.setKnobValue('whiteClamp', false);

  const revNode = new GradeNode('rev');
  revNode.setKnobValue('lift', 0.05);
  revNode.setKnobValue('gain', 1.2);
  revNode.setKnobValue('gamma', 1.15);
  revNode.setKnobValue('blackClamp', false);
  revNode.setKnobValue('whiteClamp', false);
  revNode.setKnobValue('reverse', true);

  const buf = new PixelBuffer(2, 1);
  buf.setPixel(0, 0, 0.3, 0.6, 0.8, 1.0);

  const graded = fwdNode.compute({ in: buf });
  const restored = revNode.compute({ in: graded });

  const origP = buf.getPixel(0, 0);
  const restP = restored.getPixel(0, 0);
  assert(Math.abs(restP[0] - origP[0]) < 1e-4, `Reverse grade reconstructs R: ${origP[0]} vs ${restP[0]}`);
  assert(Math.abs(restP[1] - origP[1]) < 1e-4, `Reverse grade reconstructs G: ${origP[1]} vs ${restP[1]}`);
  assert(Math.abs(restP[2] - origP[2]) < 1e-4, `Reverse grade reconstructs B: ${origP[2]} vs ${restP[2]}`);
}

// --------------------------------------------------------------------------
// 5. Masked Grade Path (Fast Skip, Fast Apply, Blending & Precision)
// --------------------------------------------------------------------------
{
  const maskVals = [0.0, 0.0001, 0.5, 0.9999, 1.0];
  const inBuf = new PixelBuffer(maskVals.length, 1);
  const maskBuf = new PixelBuffer(maskVals.length, 1);

  for (let i = 0; i < maskVals.length; i++) {
    inBuf.setPixel(i, 0, 0.4, 0.4, 0.4, 1.0);
    maskBuf.setPixel(i, 0, 0, 0, 0, maskVals[i]);
  }

  const node = new GradeNode('test_mask_precision');
  node.setKnobValue('gain', 2.0);
  node.setKnobValue('gamma', 1.0);

  const out = node.compute({ in: inBuf, mask: maskBuf });

  for (let i = 0; i < maskVals.length; i++) {
    const m = maskVals[i];
    const expected = 0.4 * (1.0 - m) + (0.4 * 2.0) * m;
    const actual = out.getPixel(i, 0)[0];
    assert(Math.abs(actual - expected) < 1e-6, `Mask ${m} precision: expected ${expected}, got ${actual}`);
  }
}

// --------------------------------------------------------------------------
// 5B. Comprehensive Gamma Sweep & Value Domain Parity (0.1 - 10.0, Near Zero, HDR)
// --------------------------------------------------------------------------
{
  const sweepGammas = [0.1, 0.25, 0.5, 0.8, 0.98, 1.0, 1.05, 1.5, 2.2, 4.0, 10.0];
  const domainVals = [
    -10.0, -1.0, 0.0, 1e-7, 1e-5, 1e-4, 0.001, 0.01, 0.1, 0.5, 1.0, 2.0, 3.9999, 4.0, 4.0001, 8.0, 16.0, 64.0, 100.0
  ];

  const inBuf = new PixelBuffer(domainVals.length, 1);
  for (let i = 0; i < domainVals.length; i++) {
    inBuf.setPixel(i, 0, domainVals[i], domainVals[i], domainVals[i], 1.0);
  }

  for (const gamma of sweepGammas) {
    const node = new GradeNode('sweep_' + gamma);
    node.setKnobValue('gamma', gamma);
    node.setKnobValue('blackClamp', true);
    node.setKnobValue('whiteClamp', false);

    const out = node.compute({ in: inBuf });
    const invGamma = 1.0 / gamma;

    for (let i = 0; i < domainVals.length; i++) {
      const v = domainVals[i];
      let expected = v > 0 ? Math.pow(v, invGamma) : 0;
      const actual = out.getPixel(i, 0)[0];
      const diff = Math.abs(actual - expected);
      const relDiff = Math.abs(expected) > 1.0 ? diff / Math.abs(expected) : diff;
      assert(relDiff < 1e-5, `Gamma ${gamma} at v=${v}: expected ${expected}, got ${actual}, relDiff=${relDiff.toExponential(4)}`);
    }
  }
}

// --------------------------------------------------------------------------
// 5C. NaN, -Infinity, +Infinity Handling Parity
// --------------------------------------------------------------------------
{
  const specialVals = [NaN, -Infinity, Infinity];
  const inBuf = new PixelBuffer(3, 1);
  for (let i = 0; i < 3; i++) {
    inBuf.setPixel(i, 0, specialVals[i], specialVals[i], specialVals[i], 1.0);
  }

  // Black clamp true
  const nodeClamped = new GradeNode('test_special_clamped');
  nodeClamped.setKnobValue('gamma', 2.2);
  nodeClamped.setKnobValue('blackClamp', true);
  const outClamped = nodeClamped.compute({ in: inBuf });

  assert(outClamped.getPixel(0, 0)[0] === 0, 'NaN clamped to 0 when blackClamp=true');
  assert(outClamped.getPixel(1, 0)[0] === 0, '-Infinity clamped to 0 when blackClamp=true');
  assert(outClamped.getPixel(2, 0)[0] === Infinity, '+Infinity preserved as Infinity');

  // Black clamp false
  const nodeUnclamped = new GradeNode('test_special_unclamped');
  nodeUnclamped.setKnobValue('gamma', 2.2);
  nodeUnclamped.setKnobValue('blackClamp', false);
  const outUnclamped = nodeUnclamped.compute({ in: inBuf });

  assert(Number.isNaN(outUnclamped.getPixel(0, 0)[0]), 'NaN preserved when blackClamp=false');
  assert(outUnclamped.getPixel(1, 0)[0] === -Infinity, '-Infinity preserved when blackClamp=false');
  assert(outUnclamped.getPixel(2, 0)[0] === Infinity, '+Infinity preserved when blackClamp=false');
}

// --------------------------------------------------------------------------
// 6. Production 1080p EXR Plate Parity & Performance
// --------------------------------------------------------------------------
const bgPath = path.join(process.cwd(), 'demo/vfx_showcase/source/bg_plate.0001.exr');
if (fs.existsSync(bgPath)) {
  const plateBuf = ImageIO.readEXR(fs.readFileSync(bgPath));
  assert(plateBuf.width === 1920 && plateBuf.height === 1080, '1080p plate loaded successfully');

  const configs = [
    { name: 'Grade_Atmosphere', knobs: { lift: 0.04, gain: 1.02, gamma: 0.98, blackClamp: true, whiteClamp: false } },
    { name: 'Grade_FilmMaster', knobs: { lift: 0.015, gain: 1.05, gamma: 1.05, blackClamp: true, whiteClamp: false } },
    { name: 'Grade_Rim', knobs: { gain: 1.25, gamma: 1.06, blackClamp: true, whiteClamp: false } }
  ];

  for (const cfg of configs) {
    const node = new GradeNode(cfg.name);
    for (const [k, v] of Object.entries(cfg.knobs)) {
      node.setKnobValue(k, v);
    }

    // Warmup
    node.compute({ in: plateBuf });

    const t0 = performance.now();
    const out = node.compute({ in: plateBuf });
    const elapsed = performance.now() - t0;

    // Verify mathematical reference
    const bp = Number(cfg.knobs.blackpoint ?? 0.0);
    const wp = Number(cfg.knobs.whitepoint ?? 1.0);
    const lift = Number(cfg.knobs.lift ?? 0.0);
    const gain = Number(cfg.knobs.gain ?? 1.0);
    const mult = Number(cfg.knobs.multiply ?? 1.0);
    const offset = Number(cfg.knobs.offset ?? 0.0);
    const gamma = Number(cfg.knobs.gamma ?? 1.0);
    const blackClamp = !!cfg.knobs.blackClamp;
    const whiteClamp = !!cfg.knobs.whiteClamp;

    const denom = (wp - bp) === 0 ? 0.00001 : (wp - bp);
    const A = mult * (gain - lift) / denom;
    const B = offset + lift - A * bp;
    const invGamma = 1.0 / gamma;

    let maxErr = 0;
    let sumErr = 0;
    let count = 0;
    const len = out.data.length;

    // Sample across pixels aligned to 4 floats (RGBA)
    const stride = Math.floor(len / 10000 / 4) * 4 || 4;
    for (let i = 0; i < len; i += stride) {
      for (let c = 0; c < 3; c++) {
        const srcVal = plateBuf.data[i + c];
        let ref = A * srcVal + B;
        if (ref > 0) ref = Math.pow(ref, invGamma);
        else if (blackClamp) ref = 0;
        if (whiteClamp && ref > 1) ref = 1;

        const diff = Math.abs(out.data[i + c] - ref);
        if (diff > maxErr) maxErr = diff;
        sumErr += diff;
        count++;
      }
    }
    const mae = sumErr / count;

    assert(maxErr < 1e-5, `${cfg.name} Max Absolute Error < 1e-5: got ${maxErr.toExponential(4)}`);
    assert(mae < 1e-6, `${cfg.name} MAE < 1e-6: got ${mae.toExponential(4)}`);
    assert(elapsed < 200, `${cfg.name} evaluation under 200 ms: took ${elapsed.toFixed(2)} ms`);
    console.log(`  ✓ ${cfg.name}: ${elapsed.toFixed(2)} ms | MaxErr: ${maxErr.toExponential(4)} | MAE: ${mae.toExponential(4)}`);
  }
} else {
  console.log('  ⚠️ Skipping 1080p EXR plate test (file not found)');
}

// --------------------------------------------------------------------------
// 7. Tiled Buffer Execution Parity
// --------------------------------------------------------------------------
{
  const node = new GradeNode('test_tiled');
  node.setKnobValue('lift', 0.05);
  node.setKnobValue('gain', 1.2);
  node.setKnobValue('gamma', 1.1);

  const flatBuf = new PixelBuffer(64, 64);
  const tiledBuf = new TiledPixelBuffer(64, 64, 16);

  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const v = (x + y) / 128.0;
      flatBuf.setPixel(x, y, v, v * 0.8, v * 0.5, 1.0);
      tiledBuf.setPixel(x, y, v, v * 0.8, v * 0.5, 1.0);
    }
  }

  // Extra channel preservation
  const depthData = new Float32Array(64 * 64);
  for (let i = 0; i < depthData.length; i++) depthData[i] = 12.345 + i;
  flatBuf.setChannel('depth.Z', depthData);
  tiledBuf.extraChannels.set('depth.Z', depthData);

  const flatOut = node.compute({ in: flatBuf });
  const tiledOut = node.compute({ in: tiledBuf });

  assert(flatOut.getChannel('depth.Z') !== null, 'Flat buffer preserved extra channel depth.Z');
  assert(tiledOut.extraChannels.get('depth.Z') !== null, 'Tiled buffer preserved extra channel depth.Z');
  assert(flatOut.getChannel('depth.Z')[10] === depthData[10], 'Extra channel depth.Z values intact');

  let maxTileDiff = 0;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const f = flatOut.getPixel(x, y);
      const t = tiledOut.getPixel(x, y);
      for (let c = 0; c < 4; c++) {
        const d = Math.abs(f[c] - t[c]);
        if (d > maxTileDiff) maxTileDiff = d;
      }
    }
  }
  assert(maxTileDiff < 1e-6, `Tiled buffer matches Flat buffer: max diff = ${maxTileDiff.toExponential(4)}`);
}

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
