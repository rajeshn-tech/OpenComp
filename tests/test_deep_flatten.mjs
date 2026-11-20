/**
 * OpenComp - Workstream 5.2 Test Suite
 * Validates Deep Flattening (DeepToImage) & Conversion (DeepFromImage):
 * 1. Analytical Beer-Lambert Transmittance Accumulation Parity (error < 1e-6)
 * 2. Primary Depth Synthesis (depth.Z AOV)
 * 3. Early Ray Termination when total opacity (T <= 1e-5) is reached
 * 4. Bidirectional Round-Trip: PixelBuffer -> DeepFromImage -> DeepToImage -> PixelBuffer
 */

import { DeepPixelBuffer } from '../src/core/deep/DeepPixelBuffer.js';
import { DeepToImageNode } from '../src/nodes/DeepToImageNode.js';
import { DeepFromImageNode } from '../src/nodes/DeepFromImageNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    passed++;
    console.log(`  ✔ PASS: ${message}`);
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🎯 RUNNING: tests/test_deep_flatten.mjs (Workstream 5.2)');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test 1: Analytical Transmittance Parity
  // -------------------------------------------------------------
  console.log('▶ Test 1: Analytical Beer-Lambert Transmittance Accumulation ...');
  {
    // 1x1 Deep Pixel with 3 premultiplied samples:
    // s0: z=2.0, (R=0.5, G=0, B=0), A=0.5 -> contribution (0.5 * 1.0, 0, 0), remaining T = 0.5
    // s1: z=5.0, (R=0, G=0.4, B=0), A=0.4 -> contribution (0, 0.4 * 0.5, 0), remaining T = 0.3
    // s2: z=8.0, (R=0, G=0, B=1.0), A=1.0 -> contribution (0, 0, 1.0 * 0.3), remaining T = 0.0
    // Expected flattened RGBA: (0.5, 0.2, 0.3, 1.0)
    // Expected depth.Z: 2.0
    const pixelLists = [[
      { zFront: 2.0, zBack: 2.0, r: 0.5, g: 0.0, b: 0.0, a: 0.5 },
      { zFront: 5.0, zBack: 5.0, r: 0.0, g: 0.4, b: 0.0, a: 0.4 },
      { zFront: 8.0, zBack: 8.0, r: 0.0, g: 0.0, b: 1.0, a: 1.0 }
    ]];

    const deepBuf = DeepPixelBuffer.fromSampleLists(1, 1, pixelLists);
    const dtiNode = new DeepToImageNode('dti1');
    const flat = dtiNode.compute([deepBuf]);

    assert(flat instanceof PixelBuffer, 'DeepToImage emits standard PixelBuffer');
    assert(flat.width === 1 && flat.height === 1, 'Output dimensions match (1x1)');

    const r = flat.data[0];
    const g = flat.data[1];
    const b = flat.data[2];
    const a = flat.data[3];

    assert(Math.abs(r - 0.5) < 1e-6, `Flattened Red (${r.toFixed(6)}) matches reference 0.500000`);
    assert(Math.abs(g - 0.2) < 1e-6, `Flattened Green (${g.toFixed(6)}) matches reference 0.200000`);
    assert(Math.abs(b - 0.3) < 1e-6, `Flattened Blue (${b.toFixed(6)}) matches reference 0.300000`);
    assert(Math.abs(a - 1.0) < 1e-6, `Flattened Alpha (${a.toFixed(6)}) matches reference 1.000000`);

    const depthAOV = flat.getChannel('depth.Z');
    assert(depthAOV !== null, 'depth.Z channel populated');
    assert(Math.abs(depthAOV[0] - 2.0) < 1e-6, `depth.Z value (${depthAOV[0].toFixed(2)}) equals foremost sample depth 2.0`);
  }

  // -------------------------------------------------------------
  // Test 2: Early Ray Termination & Occlusion Culling
  // -------------------------------------------------------------
  console.log('\n▶ Test 2: Early Ray Termination Behind Opaque Sample ...');
  {
    // Foremost sample is 100% opaque Red at z=3.0.
    // Behind it are Green (z=5.0) and Blue (z=10.0).
    // Green and Blue must be completely occluded (0 contribution).
    const pixelLists = [[
      { zFront: 3.0, zBack: 3.0, r: 1.0, g: 0.0, b: 0.0, a: 1.0 },
      { zFront: 5.0, zBack: 5.0, r: 0.0, g: 1.0, b: 0.0, a: 1.0 },
      { zFront: 10.0, zBack: 10.0, r: 0.0, g: 0.0, b: 1.0, a: 1.0 }
    ]];

    const deepBuf = DeepPixelBuffer.fromSampleLists(1, 1, pixelLists);
    const dtiNode = new DeepToImageNode('dti2');
    const flat = dtiNode.compute([deepBuf]);

    const r = flat.data[0];
    const g = flat.data[1];
    const b = flat.data[2];

    assert(r === 1.0, 'Red channel is 1.0');
    assert(g === 0.0, 'Green channel behind opaque sample is 0.0');
    assert(b === 0.0, 'Blue channel behind opaque sample is 0.0');
  }

  // -------------------------------------------------------------
  // Test 3: Bidirectional 2D/Deep Round-Trip Fidelity
  // -------------------------------------------------------------
  console.log('\n▶ Test 3: Bidirectional Round-Trip: 2D -> Deep -> 2D ...');
  {
    const W = 4, H = 4;
    const orig2D = new PixelBuffer(W, H);
    const origDepth = new Float32Array(W * H);

    for (let p = 0; p < W * H; p++) {
      orig2D.data[p * 4] = (p + 1) / (W * H);
      orig2D.data[p * 4 + 1] = 0.5;
      orig2D.data[p * 4 + 2] = 0.25;
      orig2D.data[p * 4 + 3] = 0.8;
      origDepth[p] = 10.0 + p * 2.0;
    }
    orig2D.setChannel('depth.Z', origDepth);

    // Convert 2D -> Deep
    const dfiNode = new DeepFromImageNode('dfi1');
    const deepBuf = dfiNode.compute([orig2D]);

    assert(deepBuf instanceof DeepPixelBuffer, 'DeepFromImage creates DeepPixelBuffer');
    assert(deepBuf.totalSamples === W * H, `Total samples matches pixel count (${W * H})`);

    // Flatten Deep -> 2D
    const dtiNode = new DeepToImageNode('dti3');
    const recon2D = dtiNode.compute([deepBuf]);

    const reconDepth = recon2D.getChannel('depth.Z');

    let maxDiffColor = 0;
    let maxDiffDepth = 0;

    for (let p = 0; p < W * H; p++) {
      const idx = p * 4;
      const diffR = Math.abs(recon2D.data[idx] - orig2D.data[idx]);
      const diffG = Math.abs(recon2D.data[idx + 1] - orig2D.data[idx + 1]);
      const diffB = Math.abs(recon2D.data[idx + 2] - orig2D.data[idx + 2]);
      const diffA = Math.abs(recon2D.data[idx + 3] - orig2D.data[idx + 3]);
      maxDiffColor = Math.max(maxDiffColor, diffR, diffG, diffB, diffA);

      const diffZ = Math.abs(reconDepth[p] - origDepth[p]);
      maxDiffDepth = Math.max(maxDiffDepth, diffZ);
    }

    assert(maxDiffColor < 1e-6, `Round-trip color max deviation (${maxDiffColor.toExponential(2)}) is < 1e-6`);
    assert(maxDiffDepth < 1e-6, `Round-trip depth max deviation (${maxDiffDepth.toExponential(2)}) is < 1e-6`);
  }

  console.log('\n================================================================');
  console.log(`✅ ALL DEEP FLATTEN TESTS PASSED (${passed}/${passed + failed})`);
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
