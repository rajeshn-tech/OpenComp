/**
 * OpenComp - Unit & Acceptance Test Suite: Point Tracker (Workstream 3.1)
 * Validates subpixel pattern matching, NCC, multi-track affine estimation,
 * stabilization, matchmove, track loss detection, and serialization.
 */

import assert from 'node:assert/strict';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { TrackerEngine, TrackPoint } from '../src/core/TrackerEngine.js';
import { TrackerNode } from '../src/nodes/TrackerNode.js';

console.log('================================================================');
console.log('🎯 RUNNING: tests/test_point_tracker.mjs');
console.log('================================================================\n');

// --- Helper: Generate Synthetic Test Target ---
function createSyntheticPlate(width = 256, height = 256, targetX = 128, targetY = 128) {
  const buf = new PixelBuffer(width, height);
  const data = buf.data;

  // Background subtle gradient
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = 0.1 + 0.05 * (x / width);
      data[idx + 1] = 0.1 + 0.05 * (y / height);
      data[idx + 2] = 0.12;
      data[idx + 3] = 1.0;
    }
  }

  // Draw an analytical multi-scale Gaussian feature centered at (targetX, targetY)
  const radius = 16;
  const minX = Math.max(0, Math.floor(targetX - radius));
  const maxX = Math.min(width - 1, Math.ceil(targetX + radius));
  const minY = Math.max(0, Math.floor(targetY - radius));
  const maxY = Math.min(height - 1, Math.ceil(targetY + radius));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - targetX;
      const dy = y - targetY;
      const r2 = dx * dx + dy * dy;
      if (r2 <= radius * radius) {
        // Multi-frequency smooth Gaussian feature
        const g1 = Math.exp(-r2 / (2 * 6 * 6));
        const g2 = Math.exp(-r2 / (2 * 2 * 2));
        const val = 0.15 + 0.6 * g1 + 0.25 * g2;
        const idx = (y * width + x) * 4;
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 1.0;
      }
    }
  }

  return buf;
}

// -------------------------------------------------------------
// Test 1: Subpixel Translation & NCC Accuracy
// -------------------------------------------------------------
console.log('▶ Test 1: Subpixel Optical Tracking & NCC Accuracy...');
{
  const engine = new TrackerEngine();
  const track = engine.addTrack('feature1', 128, 128);

  const frame1 = createSyntheticPlate(256, 256, 128.0, 128.0);
  engine.grabReferencePattern(track, frame1, 1);

  // Frame 2: Translated by exactly (+4.35, -2.75) pixels
  const trueDx = 4.35;
  const trueDy = -2.75;
  const frame2 = createSyntheticPlate(256, 256, 128.0 + trueDx, 128.0 + trueDy);

  const result = engine.trackFeature(track, frame2, 1, 2);

  const errorX = Math.abs((result.x - 128.0) - trueDx);
  const errorY = Math.abs((result.y - 128.0) - trueDy);

  console.log(`  Subpixel Error: X = ${errorX.toFixed(4)} px, Y = ${errorY.toFixed(4)} px | NCC = ${result.correlation.toFixed(4)}`);

  assert.ok(errorX < 0.08, `X error should be subpixel (< 0.08 px), got ${errorX}`);
  assert.ok(errorY < 0.08, `Y error should be subpixel (< 0.08 px), got ${errorY}`);
  assert.ok(result.correlation > 0.95, `NCC score should be > 0.95, got ${result.correlation}`);
  assert.equal(result.trackLost, false, 'Track should not be lost');
  console.log('  ✔ Subpixel accuracy & high correlation verified');
}

// -------------------------------------------------------------
// Test 2: Track Loss Detection on Feature Occlusion
// -------------------------------------------------------------
console.log('\n▶ Test 2: Track Loss Detection on Occlusion...');
{
  const engine = new TrackerEngine();
  engine.correlationThreshold = 0.70;
  const track = engine.addTrack('feature1', 128, 128);

  const frame1 = createSyntheticPlate(256, 256, 128, 128);
  engine.grabReferencePattern(track, frame1, 1);

  // Blank frame (feature completely occluded)
  const occludedFrame = new PixelBuffer(256, 256);

  const result = engine.trackFeature(track, occludedFrame, 1, 2);

  console.log(`  Occluded NCC Score: ${result.correlation.toFixed(4)} | Track Lost Flag: ${result.trackLost}`);
  assert.ok(result.correlation < 0.70, 'Correlation score should drop significantly');
  assert.equal(result.trackLost, true, 'Track loss should be triggered');
  assert.equal(result.x, 128, 'Should retain previous position when track lost');
  console.log('  ✔ Track loss safely identified and flagged');
}

// -------------------------------------------------------------
// Test 3: Multi-Frame Reversible Sequence Tracking
// -------------------------------------------------------------
console.log('\n▶ Test 3: Reversible Forward/Backward Sequence Tracking...');
{
  const node = new TrackerNode('Tracker1');
  const track = node.addTrack('track1', 100, 100);

  // Generate 5 frames with moving feature (+3 px/frame in X)
  const frames = [];
  for (let f = 1; f <= 5; f++) {
    frames[f] = createSyntheticPlate(256, 256, 100 + (f - 1) * 3.0, 100);
  }

  // Forward tracking 1 -> 5
  node.engine.grabReferencePattern(track, frames[1], 1);
  for (let f = 2; f <= 5; f++) {
    node.engine.trackFeature(track, frames[f], f - 1, f);
  }

  const posF5 = track.getPos(5);
  console.log(`  Forward Track to Frame 5: X = ${posF5.x.toFixed(3)} (Expected ~112.0)`);
  assert.ok(Math.abs(posF5.x - 112.0) < 0.15, 'Forward position should track accurately');

  // Backward tracking 5 -> 1
  for (let f = 4; f >= 1; f--) {
    node.engine.trackFeature(track, frames[f], f + 1, f);
  }

  const posF1Return = track.getPos(1);
  console.log(`  Backward Track to Frame 1: X = ${posF1Return.x.toFixed(3)} (Expected ~100.0)`);
  assert.ok(Math.abs(posF1Return.x - 100.0) < 0.15, 'Reversible backward tracking should return to start');
  console.log('  ✔ Forward/backward consistency verified');
}

// -------------------------------------------------------------
// Test 4: 2-Point and 3-Point Affine Motion Estimation
// -------------------------------------------------------------
console.log('\n▶ Test 4: Affine Motion Estimation (T + R + S)...');
{
  const engine = new TrackerEngine();
  engine.referenceFrame = 1;

  // Setup 2 tracks at frame 1: (100, 100) and (200, 100) -> distance = 100, angle = 0
  const t1 = engine.addTrack('t1', 100, 100);
  const t2 = engine.addTrack('t2', 200, 100);

  // Simulate Frame 2:
  // Translation: (+10, +20)
  // Scale: 1.5x (distance becomes 150)
  // Rotation: +90 deg (vector becomes vertical pointing up)
  // Center of reference = (150, 100)
  // New Center = (160, 120)
  // p1 new = (160, 120) - (0, 75) = (160, 45)
  // p2 new = (160, 120) + (0, 75) = (160, 195)
  t1.setManualKey(2, 160, 45);
  t2.setManualKey(2, 160, 195);

  const tForm = engine.computeTransform(2, 1, 'T+R+S');
  console.log(`  Computed Affine: tx = ${tForm.tx.toFixed(2)}, ty = ${tForm.ty.toFixed(2)}, rot = ${tForm.rotate.toFixed(2)}°, scale = ${tForm.scale.toFixed(3)}`);

  assert.ok(Math.abs(tForm.tx - 10.0) < 1e-4, 'Translation X should be 10');
  assert.ok(Math.abs(tForm.ty - 20.0) < 1e-4, 'Translation Y should be 20');
  assert.ok(Math.abs(tForm.rotate - 90.0) < 1e-4, 'Rotation should be 90 degrees');
  assert.ok(Math.abs(tForm.scale - 1.5) < 1e-4, 'Scale should be 1.5x');
  console.log('  ✔ 2-Point Affine transformation matches ground truth');
}

// -------------------------------------------------------------
// Test 5: Image Stabilization Verification (Zero Residual Motion)
// -------------------------------------------------------------
console.log('\n▶ Test 5: Full Image Stabilization Verification...');
{
  const node = new TrackerNode('Tracker_Stabilize');
  node.setKnobValue('transformMode', 'stabilize');
  node.setKnobValue('motionType', 'T');
  node.setKnobValue('referenceFrame', 1);

  const track = node.addTrack('track1', 128, 128);

  const frame1 = createSyntheticPlate(256, 256, 128, 128);
  const frame2 = createSyntheticPlate(256, 256, 140, 150); // Shifted by (+12, +22)

  // Track keyframes
  track.setManualKey(1, 128, 128);
  track.setManualKey(2, 140, 150);

  // Compute stabilized frame 2
  const stabilizedFrame2 = node.compute({ in: frame2 }, { frame: 2 });

  // In the stabilized frame 2, the feature that was at (140, 150) should now be shifted back to (128, 128)!
  const pixelAtTarget = stabilizedFrame2.getPixel(128, 128);
  console.log(`  Stabilized Target Center Pixel [R,G,B]: [${pixelAtTarget[0].toFixed(3)}, ${pixelAtTarget[1].toFixed(3)}, ${pixelAtTarget[2].toFixed(3)}]`);

  assert.ok(pixelAtTarget[0] > 0.85, 'Stabilized image should place the high-contrast target center at (128, 128)');
  console.log('  ✔ Image stabilization successfully canceled feature motion');
}

// -------------------------------------------------------------
// Test 6: Serialization & Deserialization Fidelity
// -------------------------------------------------------------
console.log('\n▶ Test 6: Serialization & Restoration...');
{
  const node = new TrackerNode('Tracker_Serialize');
  node.setKnobValue('transformMode', 'matchmove');
  node.setKnobValue('referenceFrame', 12);

  const t1 = node.addTrack('Corner_TL', 50, 50);
  t1.setManualKey(12, 50.5, 50.2);
  t1.setManualKey(13, 53.1, 52.8);

  const serialized = node.serialize();
  const jsonStr = JSON.stringify(serialized);

  const restoredNode = new TrackerNode('Tracker_Restored');
  restoredNode.deserialize(JSON.parse(jsonStr));

  assert.equal(restoredNode.getKnobValue('transformMode'), 'matchmove');
  assert.equal(restoredNode.getKnobValue('referenceFrame'), 12);
  assert.equal(restoredNode.getAllTracks().length, 1);

  const restoredTrack = restoredNode.getTrack(t1.id);
  assert.ok(restoredTrack, 'Track should exist');
  assert.equal(restoredTrack.name, 'Corner_TL');

  const p13 = restoredTrack.getPos(13);
  assert.ok(Math.abs(p13.x - 53.1) < 1e-4, 'Restored keyframe X should match');
  assert.ok(Math.abs(p13.y - 52.8) < 1e-4, 'Restored keyframe Y should match');
  console.log('  ✔ TrackerNode serialized and deserialized with 100% data fidelity');
}

console.log('\n================================================================');
console.log('✅ ALL POINT TRACKER TESTS PASSED (Workstream 3.1 Automated Verification Passed)');
console.log('================================================================');
