/**
 * OpenComp - Department 4: STEREO COMP Verification & Test Suite
 * Validates 2D-to-3D Depth-Image-Based Rendering (DIBR), disocclusion hole-filling,
 * Red/Cyan anaglyph, side-by-side 3D packing, and disparity difference analysis.
 */

import { strict as assert } from 'assert';
import { StereoEngine } from '../src/core/StereoEngine.js';
import { StereoWarpNode } from '../src/nodes/StereoWarpNode.js';
import { StereoMergeNode } from '../src/nodes/StereoMergeNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_stereo_department.mjs');
console.log('====================================================\n');

let passedTests = 0;

function runTest(name, fn) {
  try {
    process.stdout.write(`▶ ${name}... `);
    fn();
    console.log(`✅ PASSED`);
    passedTests++;
  } catch (err) {
    console.log(`❌ FAILED`);
    console.error(err);
    process.exit(1);
  }
}

// 1. DIBR Disparity Parallax Mathematics
runTest('DIBR Disparity Separation & Convergence Mathematics', () => {
  const w = 100, h = 50;
  const mono = new PixelBuffer(w, h);
  mono.data.fill(0.5);

  const depth = new PixelBuffer(w, h);
  depth.data.fill(0.5); // Convergence plane: Z = 0.5

  // Put a foreground object at center (x = 50, y = 25) with near depth Z = 0.1
  depth.data[(25 * w + 50) * 4] = 0.1;
  mono.data[(25 * w + 50) * 4] = 1.0; // White impulse

  const convergence = 0.5;
  const separation = 20.0; // 20 px disparity

  const { left, right } = StereoEngine.warpStereoViews(mono, depth, convergence, separation, false);

  // Near object should have positive parallax:
  // disp = 20 * (1 - 0.1/0.5) = 20 * 0.8 = 16 px
  // Left eye shifts +8 px (to x = 58)
  // Right eye shifts -8 px (to x = 42)
  const lIdx = (25 * w + 58) * 4;
  const rIdx = (25 * w + 42) * 4;

  assert.equal(left.data[lIdx], 1.0, 'Left eye should shift foreground rightward (+disp/2)');
  assert.equal(right.data[rIdx], 1.0, 'Right eye should shift foreground leftward (-disp/2)');
});

// 2. Disocclusion Hole-Filling & Inpainting
runTest('Disocclusion Hole-Filling & Background Edge Inpainting', () => {
  const w = 80, h = 40;
  const mono = new PixelBuffer(w, h);
  mono.data.fill(0.3); // Background gray

  // Foreground patch at (35 to 45) with Z = 0.1 (pops forward, creating occlusion tear)
  const depth = new PixelBuffer(w, h);
  depth.data.fill(0.8);
  for (let y = 15; y <= 25; y++) {
    for (let x = 35; x <= 45; x++) {
      depth.data[(y * w + x) * 4] = 0.1;
      mono.data[(y * w + x) * 4] = 0.9;
    }
  }

  // Warp with inpainting enabled
  const { left } = StereoEngine.warpStereoViews(mono, depth, 0.5, 16.0, true);

  // No pixel along the scanline should have 0 alpha or uninitialized hole
  for (let x = 0; x < w; x++) {
    const idx = (20 * w + x) * 4;
    assert(left.data[idx + 3] > 0.0, `Pixel at x=${x} should be filled (got alpha 0)`);
    assert(left.data[idx] >= 0.3, `Disocclusion hole at x=${x} must be filled with background`);
  }
});

// 3. 3D Anaglyph Red/Cyan Composite
runTest('3D Anaglyph Red/Cyan Multiplexing', () => {
  const left = new PixelBuffer(50, 50);
  left.data.fill(0.0);
  left.data[0] = 0.8; // Left eye red

  const right = new PixelBuffer(50, 50);
  right.data.fill(0.0);
  right.data[1] = 0.6; // Right eye green
  right.data[2] = 0.9; // Right eye blue

  const anaglyph = StereoEngine.compositeAnaglyph(left, right);
  assert(anaglyph !== null);

  // Red channel from Left eye luma
  assert(anaglyph.data[0] > 0.0);
  // Green & Blue from Right eye
  assert(Math.abs(anaglyph.data[1] - 0.6) < 1e-4);
  assert(Math.abs(anaglyph.data[2] - 0.9) < 1e-4);
});

// 4. Side-by-Side 3D Layout
runTest('Side-by-Side 3D Frame Packing', () => {
  const left = new PixelBuffer(40, 30);
  left.data.fill(0.2);

  const right = new PixelBuffer(40, 30);
  right.data.fill(0.7);

  const sbs = StereoEngine.compositeSideBySide(left, right);
  assert.equal(sbs.width, 80);
  assert.equal(sbs.height, 30);

  // Left half pixel (x = 10): 0.2
  assert.equal(Math.abs(sbs.data[(15 * 80 + 10) * 4] - 0.2) < 1e-4, true);

  // Right half pixel (x = 50): 0.7
  assert.equal(Math.abs(sbs.data[(15 * 80 + 50) * 4] - 0.7) < 1e-4, true);
});

// 5. Interactive Wipe Split-Screen
runTest('Interactive Stereo Wipe Split-Screen', () => {
  const left = new PixelBuffer(100, 50);
  left.data.fill(0.1);

  const right = new PixelBuffer(100, 50);
  right.data.fill(0.9);

  // Split at 50%
  const wipe = StereoEngine.compositeWipe(left, right, 0.5);

  // Left side (x = 20) is Left image (0.1)
  assert.equal(Math.abs(wipe.data[(25 * 100 + 20) * 4] - 0.1) < 1e-4, true);

  // Right side (x = 80) is Right image (0.9)
  assert.equal(Math.abs(wipe.data[(25 * 100 + 80) * 4] - 0.9) < 1e-4, true);

  // Divider line at x = 50 is white (1.0)
  assert.equal(wipe.data[(25 * 100 + 50) * 4], 1.0);
});

// 6. StereoWarpNode and StereoMergeNode DAG Integration
runTest('StereoWarpNode and StereoMergeNode DAG Integration', () => {
  const warp = new StereoWarpNode('StereoWarp_1');
  warp.setKnobValue('convergence', 0.5);
  warp.setKnobValue('separation', 10.0);
  warp.setKnobValue('outputEye', 'left');

  const monoPlate = new PixelBuffer(60, 40);
  monoPlate.data.fill(0.4);

  const depthPlate = new PixelBuffer(60, 40);
  depthPlate.data.fill(0.6);

  const leftOut = warp.compute({ in: monoPlate, depth: depthPlate });
  assert(leftOut !== null);
  assert.equal(leftOut.width, 60);

  // StereoMerge test
  const merge = new StereoMergeNode('StereoMerge_1');
  merge.setKnobValue('mode', 'anaglyph');

  const anaglyphOut = merge.compute({ left: leftOut, right: monoPlate });
  assert(anaglyphOut !== null);
  assert.equal(anaglyphOut.width, 60);
});

console.log(`\n🎉 test_stereo_department.mjs PASSED: All ${passedTests} tests succeeded!\n`);
