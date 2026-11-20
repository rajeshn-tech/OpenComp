/**
 * OpenComp Test Suite - Exact Node Mathematics & Foundry Nuke Formula Verification
 * Verifies pixel-accurate numerical correctness across all image processing operations.
 */

import { strict as assert } from 'assert';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { createNode } from '../src/nodes/index.js';

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_nodes_math.mjs');
console.log('----------------------------------------------------');

let passedTests = 0;

function runTest(name, fn) {
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

// 1. Grade Node Math
runTest('GradeNode: Exact Foundry Nuke Formula (A*x + B)^(1/gamma)', () => {
  const grade = createNode('Grade', 'G1');
  grade.setKnobValue('blackpoint', 0.1);
  grade.setKnobValue('whitepoint', 0.9);
  grade.setKnobValue('lift', 0.05);
  grade.setKnobValue('gain', 1.2);
  grade.setKnobValue('multiply', 1.0);
  grade.setKnobValue('offset', 0.0);
  grade.setKnobValue('gamma', 1.5);
  grade.setKnobValue('blackClamp', true);
  grade.setKnobValue('whiteClamp', true);

  const input = new PixelBuffer(2, 2);
  const testVal = 0.5;
  input.fill(testVal, testVal, testVal, 1.0);

  const out = grade.compute({ in: input });
  const p = out.getPixel(0, 0);

  // Manual Nuke Calculation
  const bp = 0.1, wp = 0.9, lift = 0.05, gain = 1.2, mult = 1.0, offset = 0.0, gamma = 1.5;
  const A = mult * (gain - lift) / (wp - bp);
  const B = offset + lift - A * bp;
  let expected = A * testVal + B;
  expected = Math.max(0.0, expected);
  expected = Math.pow(expected, 1.0 / gamma);
  expected = Math.min(1.0, Math.max(0.0, expected));

  assert(Math.abs(p[0] - expected) < 1e-4, `Expected ${expected}, got ${p[0]}`);
  assert(Math.abs(p[3] - 1.0) < 1e-4, 'Alpha should be preserved in Grade');
});

// 2. Merge Node Math
runTest('MergeNode: Over Formula A + B * (1 - aA)', () => {
  const merge = createNode('Merge', 'M1');
  merge.setKnobValue('operation', 'over');
  merge.setKnobValue('mix', 1.0);

  // Background B: Solid Blue, Alpha 1.0
  const bufB = new PixelBuffer(2, 2);
  bufB.fill(0.0, 0.0, 1.0, 1.0);

  // Foreground A: Solid Red, Alpha 0.5
  const bufA = new PixelBuffer(2, 2);
  bufA.fill(1.0, 0.0, 0.0, 0.5);

  const out = merge.compute({ B: bufB, A: bufA });
  const p = out.getPixel(0, 0);

  // Expected Over:
  // Red: 1.0 + 0.0 * (1 - 0.5) = 1.0 (premultiplied input assumption in Nuke Over)
  // Blue: 0.0 + 1.0 * (1 - 0.5) = 0.5
  // Alpha: 0.5 + 1.0 * (1 - 0.5) = 1.0
  assert(Math.abs(p[0] - 1.0) < 1e-4);
  assert(Math.abs(p[1] - 0.0) < 1e-4);
  assert(Math.abs(p[2] - 0.5) < 1e-4);
  assert(Math.abs(p[3] - 1.0) < 1e-4);
});

runTest('MergeNode: Plus, Multiply, and Screen operations', () => {
  const bufB = new PixelBuffer(1, 1);
  bufB.fill(0.4, 0.5, 0.6, 1.0);
  const bufA = new PixelBuffer(1, 1);
  bufA.fill(0.2, 0.3, 0.4, 1.0);

  // Plus: A + B
  const mergePlus = createNode('Merge', 'M_Plus');
  mergePlus.setKnobValue('operation', 'plus');
  const outPlus = mergePlus.compute({ B: bufB, A: bufA });
  assert(Math.abs(outPlus.getPixel(0, 0)[0] - 0.6) < 1e-4);

  // Multiply: A * B
  const mergeMult = createNode('Merge', 'M_Mult');
  mergeMult.setKnobValue('operation', 'multiply');
  const outMult = mergeMult.compute({ B: bufB, A: bufA });
  assert(Math.abs(outMult.getPixel(0, 0)[0] - (0.4 * 0.2)) < 1e-4);

  // Screen: A + B - A * B
  const mergeScreen = createNode('Merge', 'M_Screen');
  mergeScreen.setKnobValue('operation', 'screen');
  const outScreen = mergeScreen.compute({ B: bufB, A: bufA });
  const expScreen = 0.2 + 0.4 - (0.2 * 0.4);
  assert(Math.abs(outScreen.getPixel(0, 0)[0] - expScreen) < 1e-4);
});

// 3. Premult & Unpremult Invariant
runTest('Premult & Unpremult: Mathematical Reversibility (RGB * A and RGB / A)', () => {
  const premult = createNode('Premult', 'P1');
  const unpremult = createNode('Unpremult', 'U1');

  const unassociated = new PixelBuffer(4, 4);
  unassociated.fill(0.8, 0.4, 0.2, 0.5);

  // Premultiply
  const premultiplied = premult.compute({ in: unassociated });
  const pPre = premultiplied.getPixel(0, 0);
  assert(Math.abs(pPre[0] - 0.4) < 1e-4); // 0.8 * 0.5 = 0.4
  assert(Math.abs(pPre[1] - 0.2) < 1e-4); // 0.4 * 0.5 = 0.2
  assert(Math.abs(pPre[2] - 0.1) < 1e-4); // 0.2 * 0.5 = 0.1
  assert(Math.abs(pPre[3] - 0.5) < 1e-4);

  // Unpremultiply back
  const restored = unpremult.compute({ in: premultiplied });
  const pRestored = restored.getPixel(0, 0);
  assert(Math.abs(pRestored[0] - 0.8) < 1e-4);
  assert(Math.abs(pRestored[1] - 0.4) < 1e-4);
  assert(Math.abs(pRestored[2] - 0.2) < 1e-4);
  assert(Math.abs(pRestored[3] - 0.5) < 1e-4);
});

// 4. Invert Node Math
runTest('InvertNode: 1.0 - Channel Values', () => {
  const invert = createNode('Invert', 'Inv1');
  invert.setKnobValue('channels', 'rgba');

  const input = new PixelBuffer(2, 2);
  input.fill(0.2, 0.4, 0.7, 0.9);

  const out = invert.compute({ in: input });
  const p = out.getPixel(0, 0);
  assert(Math.abs(p[0] - 0.8) < 1e-4);
  assert(Math.abs(p[1] - 0.6) < 1e-4);
  assert(Math.abs(p[2] - 0.3) < 1e-4);
  assert(Math.abs(p[3] - 0.1) < 1e-4);
});

// 5. Colorspace Conversion (Linear <-> sRGB)
runTest('ColorspaceNode: Linear to sRGB Exact Transfer Function', () => {
  const cs = createNode('Colorspace', 'CS1');
  cs.setKnobValue('inColorspace', 'linear');
  cs.setKnobValue('outColorspace', 'srgb');

  const input = new PixelBuffer(2, 2);
  // Test value in high range (> 0.0031308)
  input.fill(0.5, 0.5, 0.5, 1.0);

  const out = cs.compute({ in: input });
  const p = out.getPixel(0, 0);

  // sRGB gamma function: 1.055 * (0.5 ^ (1/2.4)) - 0.055
  const expSRGB = 1.055 * Math.pow(0.5, 1.0 / 2.4) - 0.055;
  assert(Math.abs(p[0] - expSRGB) < 1e-4);

  // Invert back to Linear
  const csRev = createNode('Colorspace', 'CS_Rev');
  csRev.setKnobValue('inColorspace', 'srgb');
  csRev.setKnobValue('outColorspace', 'linear');
  const outLinear = csRev.compute({ in: out });
  assert(Math.abs(outLinear.getPixel(0, 0)[0] - 0.5) < 1e-4);
});

// 6. Blur Node Energy Conservation
runTest('BlurNode: Energy Conservation & Normalization', () => {
  const blur = createNode('Blur', 'B1');
  blur.setKnobValue('size', 10.0);
  blur.setKnobValue('channels', 'rgba');

  const size = 30;
  const input = new PixelBuffer(size, size);
  // Put single impulse pixel in center
  input.setPixel(15, 15, 10.0, 10.0, 10.0, 1.0);

  const out = blur.compute({ in: input });

  // Sum of all pixels in blurred buffer should equal total impulse energy
  let sumR = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      sumR += out.getPixel(x, y)[0];
    }
  }
  assert(Math.abs(sumR - 10.0) < 0.05, `Impulse energy should be conserved. Got ${sumR}`);
});

// 7. Keyer Node Chroma Despill Math
runTest('KeyerNode: Green Chroma Keying & Despill Suppression', () => {
  const keyer = createNode('Keyer', 'K1');
  keyer.setKnobValue('keyType', 'chroma_green');
  keyer.setKnobValue('despill', true);

  const input = new PixelBuffer(2, 2);
  // Pure Greenscreen pixel: [0.1, 0.9, 0.1, 1.0]
  input.fill(0.1, 0.9, 0.1, 1.0);

  const out = keyer.compute({ in: input });
  const p = out.getPixel(0, 0);

  // Alpha should be keyed out (near 0)
  assert(p[3] < 0.1, `Green screen should produce low alpha. Got ${p[3]}`);
  // Green channel should be despilled to match max(R, B) = 0.1
  assert(p[1] <= 0.15, `Green spill must be suppressed. Got ${p[1]}`);
});

// 8. CornerPin Node 4-Corner Homography
runTest('CornerPinNode: Identity Mapping Verification', () => {
  const pin = createNode('CornerPin', 'CP1');
  const w = 100, h = 100;
  // Set to identity corners
  pin.setKnobValue('to1X', 0); pin.setKnobValue('to1Y', 0);
  pin.setKnobValue('to2X', w); pin.setKnobValue('to2Y', 0);
  pin.setKnobValue('to3X', w); pin.setKnobValue('to3Y', h);
  pin.setKnobValue('to4X', 0); pin.setKnobValue('to4Y', h);

  const input = new PixelBuffer(w, h);
  input.setPixel(50, 50, 0.77, 0.33, 0.11, 1.0);

  const out = pin.compute({ in: input });
  const p = out.getPixel(50, 50);
  assert(Math.abs(p[0] - 0.77) < 1e-3);
  assert(Math.abs(p[1] - 0.33) < 1e-3);
  assert(Math.abs(p[2] - 0.11) < 1e-3);
});

// 9. Shuffle Node Routing
runTest('ShuffleNode: Channel Routing Matrix', () => {
  const shuffle = createNode('Shuffle', 'S1');
  // Route Green to Red, Red to Green, Constant 1 to Blue, Blue to Alpha
  shuffle.setKnobValue('red', 'green');
  shuffle.setKnobValue('green', 'red');
  shuffle.setKnobValue('blue', 'white');
  shuffle.setKnobValue('alpha', 'blue');

  const input = new PixelBuffer(2, 2);
  input.fill(0.2, 0.8, 0.4, 1.0);

  const out = shuffle.compute({ in: input });
  const p = out.getPixel(0, 0);
  assert(Math.abs(p[0] - 0.8) < 1e-4, 'Red should receive Green (0.8)');
  assert(Math.abs(p[1] - 0.2) < 1e-4, 'Green should receive Red (0.2)');
  assert(Math.abs(p[2] - 1.0) < 1e-4, 'Blue should receive Constant 1.0');
  assert(Math.abs(p[3] - 0.4) < 1e-4, 'Alpha should receive Blue (0.4)');
});

// 10. Crop Node Bounding
runTest('CropNode: Exact Bounding Box Masking', () => {
  const crop = createNode('Crop', 'Crop1');
  crop.setKnobValue('boxX', 20);
  crop.setKnobValue('boxY', 20);
  crop.setKnobValue('boxR', 80);
  crop.setKnobValue('boxT', 80);
  crop.setKnobValue('softness', 0.0);
  crop.setKnobValue('reformat', false);
  crop.setKnobValue('blackOutside', true);

  const input = new PixelBuffer(100, 100);
  input.fill(1.0, 1.0, 1.0, 1.0);

  const out = crop.compute({ in: input });
  // Inside box
  assert.deepEqual(out.getPixel(50, 50), [1, 1, 1, 1]);
  // Outside box
  assert.deepEqual(out.getPixel(10, 10), [0, 0, 0, 0]);
  assert.deepEqual(out.getPixel(90, 90), [0, 0, 0, 0]);
});

// 11. Glow Node Optical Bloom
runTest('GlowNode: Thresholding & Optical Bloom', () => {
  const glow = createNode('Glow', 'Glow1');
  glow.setKnobValue('tolerance', 0.5);
  glow.setKnobValue('brightness', 2.0);
  glow.setKnobValue('size', 10.0);
  glow.setKnobValue('effectOnly', true);

  const input = new PixelBuffer(40, 40);
  // Low-luminance background (0.2) below tolerance (0.5)
  input.fill(0.2, 0.2, 0.2, 1.0);
  // High-luminance highlight point (2.0) above tolerance
  input.setPixel(20, 20, 2.0, 2.0, 2.0, 1.0);

  const out = glow.compute({ in: input });
  const pImpulse = out.getPixel(20, 20);
  assert(pImpulse[0] > 0.0, 'Glow bloom should produce light at highlight');

  // Low-luminance area away from highlight should have zero bloom
  const pEdge = out.getPixel(0, 0);
  assert(pEdge[0] < 0.01, 'Pixels below tolerance should not bloom');
});

console.log(`\n🎉 test_nodes_math.mjs PASSED: All ${passedTests} mathematical node tests succeeded with 0 errors.\n`);

