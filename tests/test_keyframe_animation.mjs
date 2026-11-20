/**
 * OpenComp - Keyframe & Temporal Animation Test Suite
 * Validates deterministic multi-curve keyframe interpolation (Linear, Bezier, Hold),
 * boundary clamping, and animated node knob DAG evaluation.
 */

import { strict as assert } from 'assert';
import { KeyframeTrack, Keyframe } from '../src/core/Animation.js';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_keyframe_animation.mjs');
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

// 1. Linear Keyframe Interpolation
runTest('Scalar Linear Keyframe Interpolation', () => {
  const track = new KeyframeTrack(0.0);
  track.addKey(1, 0.0, 'linear');
  track.addKey(11, 100.0, 'linear');

  assert.equal(track.evaluate(1), 0.0);
  assert.equal(track.evaluate(11), 100.0);
  assert.equal(track.evaluate(6), 50.0); // Midpoint
  assert.equal(track.evaluate(3), 20.0);
  assert.equal(track.evaluate(0), 0.0);   // Clamped left
  assert.equal(track.evaluate(20), 100.0); // Clamped right
});

// 2. Hold Keyframe Interpolation
runTest('Hold Keyframe Interpolation (Step)', () => {
  const track = new KeyframeTrack(0.0);
  track.addKey(1, 10.0, 'hold');
  track.addKey(10, 50.0, 'hold');
  track.addKey(20, 100.0, 'hold');

  assert.equal(track.evaluate(1), 10.0);
  assert.equal(track.evaluate(5), 10.0);
  assert.equal(track.evaluate(9.99), 10.0);
  assert.equal(track.evaluate(10), 50.0);
  assert.equal(track.evaluate(15), 50.0);
  assert.equal(track.evaluate(20), 100.0);
});

// 3. Smooth Cubic Bezier Interpolation
runTest('Smooth Cubic Bezier Hermite Interpolation', () => {
  const track = new KeyframeTrack(0.0);
  track.addKey(1, 0.0, 'bezier');
  track.addKey(5, 50.0, 'bezier');
  track.addKey(10, 100.0, 'bezier');

  const vMid1 = track.evaluate(3);
  // In smooth curve, value should be continuous and monotonic here
  assert(vMid1 > 0.0 && vMid1 < 50.0);

  const vMid2 = track.evaluate(7.5);
  assert(vMid2 > 50.0 && vMid2 < 100.0);
});

// 4. Vector / Point Keyframe Interpolation
runTest('Vector Control Point [x, y] Interpolation', () => {
  const track = new KeyframeTrack([0, 0]);
  track.addKey(1, [100, 200], 'linear');
  track.addKey(11, [300, 600], 'linear');

  const mid = track.evaluate(6);
  assert.equal(mid[0], 200);
  assert.equal(mid[1], 400);
});

// 5. Track Serialization & Deserialization
runTest('Keyframe Track Serialization Fidelity', () => {
  const track = new KeyframeTrack(1.5);
  track.addKey(1, 10.0, 'linear');
  track.addKey(25, 80.0, 'bezier');

  const json = track.serialize();
  const restored = KeyframeTrack.deserialize(json);

  assert.equal(restored.length, 2);
  assert.equal(restored.defaultValue, 1.5);
  assert.equal(restored.evaluate(1), 10.0);
  assert.equal(restored.evaluate(25), 80.0);
  assert.equal(restored.keys[1].interpolation, 'bezier');
});

// 6. Node Knob Animation DAG Evaluation
runTest('Node Knob Keyframe Temporal Evaluation in DAG', () => {
  const graph = new Graph();
  const c = createNode('Constant', 'C_Anim');
  c.setKnobValue('format', '320x180');
  c.setKnobValue('colorR', 0.5);

  const g = createNode('Grade', 'G_Anim');
  // Animate gain: frame 1 -> 1.0, frame 11 -> 2.0
  g.setKeyframe('gain', 1, 1.0);
  g.setKeyframe('gain', 11, 2.0);

  graph.addNode(c);
  graph.addNode(g);
  graph.connect('C_Anim', 'out', 'G_Anim', 'in');

  // Evaluate at frame 1: gain = 1.0 => 0.5 * 1.0 = 0.5
  const resF1 = graph.evaluate('G_Anim', { frame: 1 });
  assert.equal(Math.abs(resF1.data[0] - 0.5) < 1e-4, true);

  // Evaluate at frame 11: gain = 2.0 => 0.5 * 2.0 = 1.0
  g.markDirty();
  const resF11 = graph.evaluate('G_Anim', { frame: 11 });
  assert.equal(Math.abs(resF11.data[0] - 1.0) < 1e-4, true);

  // Evaluate at frame 6: gain = 1.5 => 0.5 * 1.5 = 0.75
  g.markDirty();
  const resF6 = graph.evaluate('G_Anim', { frame: 6 });
  assert.equal(Math.abs(resF6.data[0] - 0.75) < 1e-4, true);
});

console.log(`\n🎉 test_keyframe_animation.mjs PASSED: All ${passedTests} tests succeeded!\n`);

