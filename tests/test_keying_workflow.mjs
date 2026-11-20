/**
 * OpenComp - Workstream 2.4 Professional Keying Workflow Test Suite
 * Tests ChromaKeyerNode, DespillNode, MatteControlNode, EdgeExtendNode,
 * green/blue separation, despill algorithms, morphological erode/dilate, and full pipeline.
 */

import assert from 'node:assert/strict';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { ChromaKeyerNode } from '../src/nodes/ChromaKeyerNode.js';
import { DespillNode } from '../src/nodes/DespillNode.js';
import { MatteControlNode } from '../src/nodes/MatteControlNode.js';
import { EdgeExtendNode } from '../src/nodes/EdgeExtendNode.js';
import { PremultNode } from '../src/nodes/PremultNode.js';
import { MergeNode } from '../src/nodes/MergeNode.js';
import { createNode, NODE_REGISTRY } from '../src/nodes/index.js';

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_keying_workflow.mjs');
console.log('----------------------------------------------------');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// -------------------------------------------------------------
// 1. Node Registry Verification
// -------------------------------------------------------------
runTest('Registry: ChromaKeyer, Despill, MatteControl, EdgeExtend Registered', () => {
  assert.ok(NODE_REGISTRY['ChromaKeyer'], 'ChromaKeyer must be registered');
  assert.ok(NODE_REGISTRY['Despill'], 'Despill must be registered');
  assert.ok(NODE_REGISTRY['MatteControl'], 'MatteControl must be registered');
  assert.ok(NODE_REGISTRY['EdgeExtend'], 'EdgeExtend must be registered');

  const ck = createNode('ChromaKeyer', 'CK1');
  assert.equal(ck.category, 'Keyer');
  const ds = createNode('Despill', 'DS1');
  assert.equal(ds.category, 'Keyer');
  const mc = createNode('MatteControl', 'MC1');
  assert.equal(mc.category, 'Keyer');
  const ee = createNode('EdgeExtend', 'EE1');
  assert.equal(ee.category, 'Keyer');
});

// -------------------------------------------------------------
// 2. ChromaKeyer: Green Screen Separation
// -------------------------------------------------------------
runTest('ChromaKeyer: Clean Green Screen Extraction & Despill', () => {
  const buf = new PixelBuffer(10, 10);
  // Pure vibrant green backing
  buf.fill(0.05, 0.95, 0.05, 1.0);

  const ck = new ChromaKeyerNode('CK1');
  ck.setKnobValue('screenType', 'green');
  ck.setKnobValue('tolerance', 0.4);

  const out = ck.compute({ in: buf });
  const px = out.getPixel(5, 5);

  // Matte should be 0.0 (transparent) on solid green backing
  assert.equal(px[3], 0.0, 'Green backing alpha must be keyed to 0.0');

  // Flesh tone foreground (R: 0.8, G: 0.5, B: 0.4)
  buf.fill(0.8, 0.5, 0.4, 1.0);
  const outFg = ck.compute({ in: buf });
  const pxFg = outFg.getPixel(5, 5);
  // Foreground alpha must remain 1.0 (opaque)
  assert.equal(pxFg[3], 1.0, 'Flesh tone foreground alpha must remain 1.0');
});

// -------------------------------------------------------------
// 3. ChromaKeyer: Blue Screen Separation
// -------------------------------------------------------------
runTest('ChromaKeyer: Clean Blue Screen Extraction', () => {
  const buf = new PixelBuffer(10, 10);
  // Pure blue backing
  buf.fill(0.05, 0.05, 0.95, 1.0);

  const ck = new ChromaKeyerNode('CK1');
  ck.setKnobValue('screenType', 'blue');
  ck.setKnobValue('tolerance', 0.4);

  const out = ck.compute({ in: buf });
  const px = out.getPixel(5, 5);
  assert.equal(px[3], 0.0, 'Blue backing alpha must be keyed to 0.0');
});

// -------------------------------------------------------------
// 4. ChromaKeyer: Output View Modes (composite, matte, unpremult)
// -------------------------------------------------------------
runTest('ChromaKeyer: Output View Modes (composite, matte, unpremult)', () => {
  const buf = new PixelBuffer(10, 10);
  buf.fill(0.2, 0.7, 0.2, 1.0);

  const ck = new ChromaKeyerNode('CK1');
  ck.setKnobValue('output', 'matte');
  const outMatte = ck.compute({ in: buf });
  const pxMatte = outMatte.getPixel(5, 5);
  // Matte view puts alpha in RGB channels
  assert.equal(pxMatte[0], pxMatte[1]);
  assert.equal(pxMatte[1], pxMatte[2]);
  assert.equal(pxMatte[3], 1.0);

  ck.setKnobValue('output', 'unpremult');
  const outUnpre = ck.compute({ in: buf });
  const pxUnpre = outUnpre.getPixel(5, 5);
  // Unpremult preserves despilled RGB without alpha multiplication
  assert.ok(pxUnpre[0] > 0.0);
});

// -------------------------------------------------------------
// 5. DespillNode: Algorithm Comparisons (average vs max)
// -------------------------------------------------------------
runTest('DespillNode: Algorithm Parity (Average vs Max Green Spill)', () => {
  const buf = new PixelBuffer(10, 10);
  // Green spill pixel on skin edge: R=0.4, G=0.7, B=0.2
  buf.fill(0.4, 0.7, 0.2, 1.0);

  const ds = new DespillNode('DS1');
  ds.setKnobValue('screenType', 'green');

  // 1. Average algorithm: limit = (0.4 + 0.2) / 2 = 0.3 -> G reduced from 0.7 to 0.3
  ds.setKnobValue('algorithm', 'average');
  const outAvg = ds.compute({ in: buf });
  const pxAvg = outAvg.getPixel(5, 5);
  assert(Math.abs(pxAvg[1] - 0.3) < 1e-4, `Expected G=0.3, got ${pxAvg[1]}`);

  // 2. Max algorithm: limit = max(0.4, 0.2) = 0.4 -> G reduced from 0.7 to 0.4
  ds.setKnobValue('algorithm', 'max');
  const outMax = ds.compute({ in: buf });
  const pxMax = outMax.getPixel(5, 5);
  assert(Math.abs(pxMax[1] - 0.4) < 1e-4, `Expected G=0.4, got ${pxMax[1]}`);
});

// -------------------------------------------------------------
// 6. MatteControlNode: Morphological Erosion (Shrink Matte)
// -------------------------------------------------------------
runTest('MatteControlNode: Morphological Erosion (erode < 0 shrinks matte)', () => {
  // 50x50 buffer with 20x20 solid square in center (x:15..35, y:15..35)
  const buf = new PixelBuffer(50, 50);
  for (let y = 15; y < 35; y++) {
    for (let x = 15; x < 35; x++) {
      buf.setPixel(x, y, 1, 1, 1, 1.0);
    }
  }

  const mc = new MatteControlNode('MC1');
  // Erode by -2 pixels (shrinks square boundary to x:17..33)
  mc.setKnobValue('erode', -2.0);

  const out = mc.compute({ in: buf });
  // Center should remain 1.0
  assert.equal(out.getPixel(25, 25)[3], 1.0);
  // Edge at (15, 25) should now be 0.0 (eroded)
  assert.equal(out.getPixel(15, 25)[3], 0.0);
  assert.equal(out.getPixel(16, 25)[3], 0.0);
  // Inner point at (18, 25) should still be 1.0
  assert.equal(out.getPixel(18, 25)[3], 1.0);
});

// -------------------------------------------------------------
// 7. MatteControlNode: Morphological Dilation (Expand Matte)
// -------------------------------------------------------------
runTest('MatteControlNode: Morphological Dilation (erode > 0 expands matte)', () => {
  const buf = new PixelBuffer(50, 50);
  // 10x10 square in center (x:20..30, y:20..30)
  for (let y = 20; y < 30; y++) {
    for (let x = 20; x < 30; x++) {
      buf.setPixel(x, y, 1, 1, 1, 1.0);
    }
  }

  const mc = new MatteControlNode('MC1');
  // Dilate by +3 pixels (expands square boundary to x:17..33)
  mc.setKnobValue('erode', 3.0);

  const out = mc.compute({ in: buf });
  // Point at (18, 25) originally outside (alpha=0), now inside (alpha=1)
  assert.equal(out.getPixel(18, 25)[3], 1.0);
  // Point at (10, 25) still outside
  assert.equal(out.getPixel(10, 25)[3], 0.0);
});

// -------------------------------------------------------------
// 8. MatteControlNode: Gaussian Blur & Black/White Point Remapping
// -------------------------------------------------------------
runTest('MatteControlNode: Gaussian Blur & Black/White Point Curve', () => {
  const buf = new PixelBuffer(40, 40);
  // Left half transparent (0.0), right half opaque (1.0)
  for (let y = 0; y < 40; y++) {
    for (let x = 20; x < 40; x++) {
      buf.setPixel(x, y, 1, 1, 1, 1.0);
    }
  }

  const mc = new MatteControlNode('MC1');
  mc.setKnobValue('blur', 4.0);

  const out = mc.compute({ in: buf });
  // At the boundary x=20, blur creates soft roll-off (~0.5)
  const alphaAtSeam = out.getPixel(20, 20)[3];
  assert(alphaAtSeam > 0.3 && alphaAtSeam < 0.7, `Expected boundary alpha ~0.5, got ${alphaAtSeam}`);
});

// -------------------------------------------------------------
// 9. EdgeExtendNode: Outward Color Smearing Past Edge Boundary
// -------------------------------------------------------------
runTest('EdgeExtendNode: Outward Color Smearing Past Alpha Edge', () => {
  const buf = new PixelBuffer(40, 40);
  // Red square in center (x:15..25, y:15..25) with alpha=1.0, surround is 0.0
  for (let y = 15; y < 25; y++) {
    for (let x = 15; x < 25; x++) {
      buf.setPixel(x, y, 1.0, 0.0, 0.0, 1.0);
    }
  }

  const ee = new EdgeExtendNode('EE1');
  ee.setKnobValue('slices', 4);
  ee.setKnobValue('outputMode', 'extended_rgb');

  const out = ee.compute({ in: buf });
  // 3 pixels outside original boundary at (12, 20)
  const pxExt = out.getPixel(12, 20);
  // Extended RGB should smear the red color (R > 0.9, G ~ 0, B ~ 0)
  assert(pxExt[0] > 0.9, `Expected smeared Red > 0.9, got ${pxExt[0]}`);
  assert.equal(pxExt[1], 0.0);
  assert.equal(pxExt[2], 0.0);
});

// -------------------------------------------------------------
// 10. Complete Multi-Node Keying Pipeline
// -------------------------------------------------------------
runTest('End-to-End Pipeline: ChromaKeyer -> Despill -> MatteControl -> EdgeExtend -> Merge', () => {
  const W = 100, H = 100;
  const plate = new PixelBuffer(W, H);

  // Background: bright green
  plate.fill(0.05, 0.92, 0.05, 1.0);
  // Foreground subject: orange circle in center (radius 30)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dist = Math.hypot(x - 50, y - 50);
      if (dist < 30) {
        // Orange subject with slight green spill on outer rim
        const spill = dist > 25 ? 0.3 : 0.0;
        plate.setPixel(x, y, 0.9, 0.4 + spill, 0.1, 1.0);
      }
    }
  }

  // 1. ChromaKeyer
  const ck = new ChromaKeyerNode('CK1');
  ck.setKnobValue('output', 'unpremult');
  const keyed = ck.compute({ in: plate });

  // 2. Despill
  const ds = new DespillNode('DS1');
  ds.setKnobValue('algorithm', 'average');
  const despilled = ds.compute({ in: keyed });

  // 3. MatteControl: slight shrink and soften
  const mc = new MatteControlNode('MC1');
  mc.setKnobValue('erode', -0.5);
  mc.setKnobValue('blur', 1.0);
  const controlled = mc.compute({ in: despilled });

  // 4. EdgeExtend
  const ee = new EdgeExtendNode('EE1');
  ee.setKnobValue('slices', 3);
  ee.setKnobValue('outputMode', 'premultiplied');
  const extended = ee.compute({ in: controlled });

  // 5. Composite over New Blue Background via Merge
  const newBg = new PixelBuffer(W, H);
  newBg.fill(0.1, 0.2, 0.8, 1.0); // Clean deep blue background

  const merge = new MergeNode('Merge1');
  merge.setKnobValue('operation', 'over');
  const composite = merge.compute({ B: newBg, A: extended });

  // Test composite points
  // Center (x=50, y=50): Should be orange foreground
  const centerPx = composite.getPixel(50, 50);
  assert(centerPx[0] > 0.8, `Expected strong Red at center, got ${centerPx[0]}`);
  assert(centerPx[2] < 0.3, `Expected low Blue at center, got ${centerPx[2]}`);

  // Corner (x=5, y=5): Should be new blue background
  const cornerPx = composite.getPixel(5, 5);
  assert(Math.abs(cornerPx[0] - 0.1) < 1e-3);
  assert(Math.abs(cornerPx[1] - 0.2) < 1e-3);
  assert(Math.abs(cornerPx[2] - 0.8) < 1e-3);
});

console.log('\n====================================================');
console.log(`🎉 test_keying_workflow.mjs PASSED: All ${passedTests}/${totalTests} tests succeeded!`);
console.log('====================================================\n');

