/**
 * OpenComp - Department 3: DEPTH Verification & Test Suite
 * Validates 32-bit floating-point depth generation for 2D-to-3D stereoscopic conversion,
 * perspective ground-plane ramps, roto-mask object sculpting, and false-color heatmaps.
 */

import { strict as assert } from 'assert';
import { DepthMapEngine } from '../src/core/DepthMap.js';
import { DepthNode } from '../src/nodes/DepthNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_depth_department.mjs');
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

// 1. Perspective Ground-Plane Depth Ramp
runTest('Perspective Ground-Plane Depth Generation', () => {
  const depth = DepthMapEngine.generateDepthMap(100, 100, {
    gradientType: 'ground_plane',
    nearClip: 0.0,
    farClip: 1.0
  });

  // Bottom pixel (y = 99, near ground): Z should be close to foreground (near ~0.1 - 0.2)
  const bottomIdx = (99 * 100 + 50) * 4;
  const bottomZ = depth.data[bottomIdx];
  assert(bottomZ < 0.3, `Ground foreground should be near camera (got ${bottomZ})`);

  // Top pixel (y = 10, distant sky/horizon): Z should be deep background (far ~0.9 - 1.0)
  const topIdx = (10 * 100 + 50) * 4;
  const topZ = depth.data[topIdx];
  assert(topZ > 0.8, `Sky/Horizon should be far from camera (got ${topZ})`);
});

// 2. Near & Far Clip Calibration
runTest('Near/Far Depth Clip and Contrast Calibration', () => {
  const depth = DepthMapEngine.generateDepthMap(50, 50, {
    gradientType: 'linear',
    nearClip: 0.25,
    farClip: 0.75,
    contrast: 1.0
  });

  for (let i = 0; i < depth.data.length; i += 4) {
    const z = depth.data[i];
    assert(z >= 0.25 - 1e-5 && z <= 0.75 + 1e-5, `Z value ${z} out of bounds [0.25, 0.75]`);
  }
});

// 3. Roto-to-Depth Object Sculpting
runTest('Roto-Masked Object Depth Sculpting', () => {
  const depth = new PixelBuffer(100, 100);
  depth.data.fill(0.9); // Background at Z = 0.9

  // Roto mask for character in the center (40,40 to 60,60)
  const rotoMask = new PixelBuffer(100, 100);
  rotoMask.data.fill(0.0);
  for (let y = 40; y <= 60; y++) {
    for (let x = 40; x <= 60; x++) {
      rotoMask.data[(y * 100 + x) * 4 + 3] = 1.0;
    }
  }

  // Sculpt character closer to screen: Z = 0.3
  DepthMapEngine.applyRotoObjectDepth(depth, rotoMask, 0.3, 'replace');

  // Character inside mask (50, 50) should be Z = 0.3
  const charIdx = (50 * 100 + 50) * 4;
  assert.equal(Math.abs(depth.data[charIdx] - 0.3) < 1e-4, true);

  // Background outside mask (10, 10) should remain Z = 0.9
  const bgIdx = (10 * 100 + 10) * 4;
  assert.equal(Math.abs(depth.data[bgIdx] - 0.9) < 1e-4, true);
});

// 4. Edge-Preserving Bilateral Smoothing
runTest('Bilateral Edge-Preserving Depth Smoothing', () => {
  const depth = new PixelBuffer(50, 50);
  depth.data.fill(0.8);
  // Add step discontinuity
  for (let y = 20; y <= 30; y++) {
    for (let x = 20; x <= 30; x++) {
      depth.data[(y * 50 + x) * 4] = 0.2;
    }
  }

  const smoothed = DepthMapEngine.smoothDepth(depth, 1, 1.5, 0.1);
  assert(smoothed !== null);

  // Inside step should stay near 0.2
  const centerIdx = (25 * 50 + 25) * 4;
  assert(Math.abs(smoothed.data[centerIdx] - 0.2) < 0.05);
});

// 5. False-Color Heatmap Visualization
runTest('False-Color Turbo/Jet Heatmap Visualization', () => {
  const depth = new PixelBuffer(10, 10);
  depth.data.fill(0.0); // Near (Z = 0.0) -> should be blueish
  depth.data[0] = 0.0;
  depth.data[4] = 1.0;  // Far (Z = 1.0) -> should be reddish

  const heatmap = DepthMapEngine.colorizeHeatmap(depth);
  assert(heatmap !== null);

  // Pixel 0 (Near) has high Blue component
  assert(heatmap.data[2] > 0.8, 'Near depth should map to blue spectrum');

  // Pixel 1 (Far) has high Red component
  assert(heatmap.data[4] > 0.8, 'Far depth should map to red spectrum');
});

// 6. DepthNode DAG Integration
runTest('DepthNode DAG Evaluation and Parametric Controls', () => {
  const depthNode = new DepthNode('Depth_Stereo');
  depthNode.setKnobValue('gradientType', 'ground_plane');
  depthNode.setKnobValue('contrast', 1.2);

  const formatPlate = new PixelBuffer(80, 60);

  const out = depthNode.compute({ in: formatPlate }, { frame: 1 });
  assert(out !== null);
  assert.equal(out.width, 80);
  assert.equal(out.height, 60);

  // Test Heatmap mode
  depthNode.setKnobValue('displayMode', 'heatmap');
  const heatOut = depthNode.compute({ in: formatPlate }, { frame: 1 });
  assert(heatOut !== null);
  assert.equal(heatOut.width, 80);
});

console.log(`\n🎉 test_depth_department.mjs PASSED: All ${passedTests} tests succeeded!\n`);

