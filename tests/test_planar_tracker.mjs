/**
 * OpenComp - Unit & Acceptance Test Suite: Planar Tracker (Workstream 3.2)
 * Validates 4-corner planar homography estimation, perspective deformation,
 * occlusion resistance with outlier rejection, CornerPin export, and serialization.
 */

import assert from 'node:assert/strict';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { PlanarTrackerEngine } from '../src/core/PlanarTrackerEngine.js';
import { PlanarTrackerNode } from '../src/nodes/PlanarTrackerNode.js';
import { CornerPinNode } from '../src/nodes/CornerPinNode.js';

console.log('================================================================');
console.log('🎯 RUNNING: tests/test_planar_tracker.mjs');
console.log('================================================================\n');

// --- Helper: Generate Textured Planar Plate ---
function createPlanarPlate(width = 300, height = 300, H = null) {
  const buf = new PixelBuffer(width, height);
  const data = buf.data;

  // Render a distinct multi-scale feature texture
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let srcX = x, srcY = y;
      if (H) {
        const Z = H[6] * x + H[7] * y + H[8];
        if (Math.abs(Z) > 1e-6) {
          srcX = (H[0] * x + H[1] * y + H[2]) / Z;
          srcY = (H[3] * x + H[4] * y + H[5]) / Z;
        }
      }

      const idx = (y * width + x) * 4;
      const dx = srcX - 150;
      const dy = srcY - 150;
      const r2 = dx * dx + dy * dy;
      // High contrast multi-frequency texture anchored to center
      const envelope = Math.exp(-r2 / (2 * 75 * 75));
      const f1 = Math.sin(srcX * 0.25) * Math.cos(srcY * 0.25);
      const f2 = Math.sin(srcX * 0.5 + srcY * 0.3);
      const pattern = 0.5 + envelope * (0.3 * f1 + 0.15 * f2);

      data[idx] = pattern;
      data[idx + 1] = pattern;
      data[idx + 2] = pattern;
      data[idx + 3] = 1.0;
    }
  }

  return buf;
}

// -------------------------------------------------------------
// Test 1: Planar Homography DLT & Reprojection Precision
// -------------------------------------------------------------
console.log('▶ Test 1: Planar Homography Estimation Precision...');
{
  const srcCorners = [
    { x: 50, y: 50 },
    { x: 250, y: 50 },
    { x: 250, y: 250 },
    { x: 50, y: 250 }
  ];

  // Ground truth perspective destination corners
  const dstCorners = [
    { x: 70, y: 60 },
    { x: 240, y: 40 },
    { x: 220, y: 270 },
    { x: 60, y: 230 }
  ];

  const H = PlanarTrackerEngine.solveHomographyDLT(srcCorners, dstCorners);
  assert.ok(H, 'Homography matrix should be computed');

  // Verify reprojection error for each corner
  let maxError = 0;
  for (let i = 0; i < 4; i++) {
    const sc = srcCorners[i];
    const dc = dstCorners[i];
    const Z = H[6] * sc.x + H[7] * sc.y + H[8];
    const px = (H[0] * sc.x + H[1] * sc.y + H[2]) / Z;
    const py = (H[3] * sc.x + H[4] * sc.y + H[5]) / Z;
    const err = Math.hypot(px - dc.x, py - dc.y);
    if (err > maxError) maxError = err;
  }

  console.log(`  Max Corner Reprojection Error: ${maxError.toFixed(6)} px`);
  assert.ok(maxError < 0.05, `Reprojection error should be < 0.05 px, got ${maxError}`);
  console.log('  ✔ Exact DLT homography precision verified');
}

// -------------------------------------------------------------
// Test 2: Robust Outlier Rejection & Partial Occlusion
// -------------------------------------------------------------
console.log('\n▶ Test 2: Outlier Rejection Under 20% Occlusion...');
{
  const H_true = [
    1.1, 0.05, 12,
    -0.02, 1.05, 8,
    0.0001, 0.0002, 1.0
  ];

  // 4x4 grid of distributed points
  const trueSrc = [];
  const trueDst = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const sx = 50 + c * 50;
      const sy = 50 + r * 50;
      const Z = H_true[6] * sx + H_true[7] * sy + H_true[8];
      const dx = (H_true[0] * sx + H_true[1] * sy + H_true[2]) / Z;
      const dy = (H_true[3] * sx + H_true[4] * sy + H_true[5]) / Z;
      trueSrc.push({ x: sx, y: sy });
      trueDst.push({ x: dx, y: dy });
    }
  }

  // Corrupt 3 points out of 16 (~20% outliers)
  trueDst[3] = { x: trueDst[3].x + 50, y: trueDst[3].y - 40 };
  trueDst[7] = { x: trueDst[7].x - 45, y: trueDst[7].y + 55 };
  trueDst[11] = { x: trueDst[11].x + 60, y: trueDst[11].y + 30 };

  const H_robust = PlanarTrackerEngine.solveRobustHomography(trueSrc, trueDst, 3.5, 40);
  assert.ok(H_robust, 'Robust homography should be solved');

  // Verify that inliers reproject accurately despite the 3 severe outliers
  let inlierErrorSum = 0;
  let inlierCount = 0;
  for (let i = 0; i < 16; i++) {
    if (i === 3 || i === 7 || i === 11) continue;
    const sc = trueSrc[i];
    const dc = trueDst[i];
    const Z = H_robust[6] * sc.x + H_robust[7] * sc.y + H_robust[8];
    const px = (H_robust[0] * sc.x + H_robust[1] * sc.y + H_robust[2]) / Z;
    const py = (H_robust[3] * sc.x + H_robust[4] * sc.y + H_robust[5]) / Z;
    inlierErrorSum += Math.hypot(px - dc.x, py - dc.y);
    inlierCount++;
  }
  const avgError = inlierErrorSum / inlierCount;
  console.log(`  Average Inlier Reprojection Error with Outliers: ${avgError.toFixed(6)} px`);
  assert.ok(avgError < 0.05, `Inliers should maintain < 0.05 px error, got ${avgError}`);
  console.log('  ✔ Robust outlier rejection successfully handled occlusion');
}

// -------------------------------------------------------------
// Test 3: Planar Tracking Step on Synthetic Sequence
// -------------------------------------------------------------
console.log('\n▶ Test 3: Planar Tracking Sequence Step...');
{
  const node = new PlanarTrackerNode('PlanarTracker1');
  node.setCorners({ x: 60, y: 60 }, { x: 240, y: 60 }, { x: 240, y: 240 }, { x: 60, y: 240 }, 1);

  const frame1 = createPlanarPlate(300, 300);
  node.engine.initPlanarFeatures(frame1, 1);

  // Frame 2: Shifted plate (+5 px in X, +3 px in Y)
  const H_shift = [1, 0, -5, 0, 1, -3, 0, 0, 1];
  const frame2 = createPlanarPlate(300, 300, H_shift);

  const result = node.trackStep(frame2, 1, 2);
  console.log(`  Confidence Score: ${result.confidence.toFixed(3)} | Track Lost: ${result.trackLost}`);

  const cornersF2 = node.getCornersAtFrame(2);
  const dx = cornersF2[0].x - 60;
  const dy = cornersF2[0].y - 60;
  console.log(`  Corner 1 Shift: dX = ${dx.toFixed(3)} (Expected ~5.0), dY = ${dy.toFixed(3)} (Expected ~3.0)`);

  assert.equal(result.trackLost, false, 'Track should not be lost');
  assert.ok(result.confidence > 0.6, 'Confidence should be high');
  assert.ok(Math.abs(dx - 5.0) < 0.35, 'Corner X should shift ~5 px');
  assert.ok(Math.abs(dy - 3.0) < 0.35, 'Corner Y should shift ~3 px');
  console.log('  ✔ Planar tracking step successfully tracked surface shift');
}

// -------------------------------------------------------------
// Test 4: Export to CornerPin Compatibility
// -------------------------------------------------------------
console.log('\n▶ Test 4: CornerPin Export Compatibility...');
{
  const node = new PlanarTrackerNode('PlanarTracker_Export');
  node.setCorners(
    { x: 192, y: 108 },
    { x: 1728, y: 108 },
    { x: 1728, y: 972 },
    { x: 192, y: 972 },
    1
  );

  const cpKnobs = node.exportCornerPinKnobs(1, 1920, 1080);
  console.log(`  Exported Normalized Corner 1: (${cpKnobs.to1_x.toFixed(2)}, ${cpKnobs.to1_y.toFixed(2)})`);
  console.log(`  Exported Normalized Corner 3: (${cpKnobs.to3_x.toFixed(2)}, ${cpKnobs.to3_y.toFixed(2)})`);

  assert.ok(Math.abs(cpKnobs.to1_x - 0.1) < 1e-4, 'to1_x should be 0.10');
  assert.ok(Math.abs(cpKnobs.to1_y - 0.1) < 1e-4, 'to1_y should be 0.10');
  assert.ok(Math.abs(cpKnobs.to3_x - 0.9) < 1e-4, 'to3_x should be 0.90');
  assert.ok(Math.abs(cpKnobs.to3_y - 0.9) < 1e-4, 'to3_y should be 0.90');
  console.log('  ✔ Direct CornerPin parameter export verified');
}

// -------------------------------------------------------------
// Test 5: Serialization & Deserialization Fidelity
// -------------------------------------------------------------
console.log('\n▶ Test 5: Serialization & Keyframe Restoration...');
{
  const node = new PlanarTrackerNode('Planar_Save');
  node.setKnobValue('transformMode', 'stabilize');
  node.setCorners({ x: 20, y: 20 }, { x: 120, y: 20 }, { x: 120, y: 120 }, { x: 20, y: 120 }, 1);
  node.setCorners({ x: 25, y: 22 }, { x: 128, y: 24 }, { x: 126, y: 125 }, { x: 24, y: 123 }, 2);

  const serialized = node.serialize();
  const jsonStr = JSON.stringify(serialized);

  const restored = new PlanarTrackerNode('Planar_Load');
  restored.deserialize(JSON.parse(jsonStr));

  assert.equal(restored.getKnobValue('transformMode'), 'stabilize');
  const c2 = restored.getCornersAtFrame(2);
  assert.ok(Math.abs(c2[0].x - 25) < 1e-4, 'Corner 1 X at frame 2 should match');
  assert.ok(Math.abs(c2[1].x - 128) < 1e-4, 'Corner 2 X at frame 2 should match');
  console.log('  ✔ PlanarTrackerNode serialized and restored with 100% fidelity');
}

console.log('\n================================================================');
console.log('✅ ALL PLANAR TRACKER TESTS PASSED (Workstream 3.2 Automated Verification Passed)');
console.log('================================================================');
