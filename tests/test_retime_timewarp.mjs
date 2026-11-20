/**
 * OpenComp - Unit & Acceptance Test Suite: Retime & TimeWarp (Workstream 3.4)
 * Validates speed control, reverse playback, freeze frames, curve remapping,
 * boundary clamping, and exact float32 linear frame blending.
 */

import assert from 'node:assert/strict';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { Graph } from '../src/core/Graph.js';
import { Node } from '../src/core/Node.js';
import { RetimeNode } from '../src/nodes/RetimeNode.js';
import { TimeWarpNode } from '../src/nodes/TimeWarpNode.js';

console.log('================================================================');
console.log('🎯 RUNNING: tests/test_retime_timewarp.mjs');
console.log('================================================================\n');

// Mock Sequence Generator Node: outputs solid luminance = frame / 100.0
class MockSequenceNode extends Node {
  constructor(id) {
    super(id, 'MockSeq', 'Image');
    this.isTimeDependent = true;
    this.addKnob('base', 'Base', 'number', 0);
  }
  compute(inputs, context = {}) {
    const frame = context.frame !== undefined ? context.frame : 1;
    const buf = new PixelBuffer(16, 16);
    const val = frame * 0.1; // Frame 1 = 0.1, Frame 2 = 0.2, etc.
    for (let i = 0; i < buf.data.length; i += 4) {
      buf.data[i] = val;
      buf.data[i + 1] = val;
      buf.data[i + 2] = val;
      buf.data[i + 3] = 1.0;
    }
    return buf;
  }
}

// -------------------------------------------------------------
// Test 1: Integer Speed Retime (2.0x Fast & 0.5x Slow)
// -------------------------------------------------------------
console.log('▶ Test 1: Integer Speed Scaling (Step / Nearest)...');
{
  const graph = new Graph();
  const seq = graph.addNode(new MockSequenceNode('Seq1'));
  const retime = graph.addNode(new RetimeNode('Retime_Speed'));
  retime.setKnobValue('filter', 'step');
  retime.setKnobValue('speed', 2.0); // 2x speed: frame 1 -> src 1, frame 2 -> src 3, frame 3 -> src 5
  retime.setKnobValue('firstFrame', 1);
  retime.setKnobValue('lastFrame', 10);
  graph.connect('Seq1', 'out', 'Retime_Speed', 'in');

  // Evaluate at frame 1: src = 1 + (1-1)*2 = 1 -> val = 0.1
  const buf1 = graph.evaluate('Retime_Speed', { frame: 1 });
  assert.ok(Math.abs(buf1.data[0] - 0.1) < 1e-5, 'Frame 1 at 2x speed should pull src frame 1 (val 0.1)');

  // Evaluate at frame 2: src = 1 + (2-1)*2 = 3 -> val = 0.3
  const buf2 = graph.evaluate('Retime_Speed', { frame: 2 });
  assert.ok(Math.abs(buf2.data[0] - 0.3) < 1e-5, 'Frame 2 at 2x speed should pull src frame 3 (val 0.3)');

  // Evaluate at frame 3: src = 1 + (3-1)*2 = 5 -> val = 0.5
  const buf3 = graph.evaluate('Retime_Speed', { frame: 3 });
  assert.ok(Math.abs(buf3.data[0] - 0.5) < 1e-5, 'Frame 3 at 2x speed should pull src frame 5 (val 0.5)');

  console.log(`  2x Speed Results: F1 = ${buf1.data[0].toFixed(2)}, F2 = ${buf2.data[0].toFixed(2)}, F3 = ${buf3.data[0].toFixed(2)}`);
  console.log('  ✔ Integer speed retiming verified');
}

// -------------------------------------------------------------
// Test 2: Sub-Frame Linear Cross-Dissolve Blend Math
// -------------------------------------------------------------
console.log('\n▶ Test 2: Frame Blend (Linear Cross-Dissolve Math)...');
{
  const graph = new Graph();
  const seq = graph.addNode(new MockSequenceNode('Seq2'));
  const retime = graph.addNode(new RetimeNode('Retime_Blend'));
  retime.setKnobValue('filter', 'blend');
  retime.setKnobValue('speed', 0.5); // 0.5x slow motion
  retime.setKnobValue('firstFrame', 1);
  retime.setKnobValue('lastFrame', 10);
  graph.connect('Seq2', 'out', 'Retime_Blend', 'in');

  // Timeline Frame 1: src = 1 + (1-1)*0.5 = 1.0 -> val = 0.1
  const buf1 = graph.evaluate('Retime_Blend', { frame: 1 });
  assert.ok(Math.abs(buf1.data[0] - 0.1) < 1e-5, 'Frame 1 should be exactly 0.1');

  // Timeline Frame 2: src = 1 + (2-1)*0.5 = 1.5 -> midpoint between Frame 1 (0.1) and Frame 2 (0.2)
  // Expected = 0.5 * 0.1 + 0.5 * 0.2 = 0.1500000
  const buf2 = graph.evaluate('Retime_Blend', { frame: 2 });
  console.log(`  Mid-Frame Blend Value at F2 (src 1.5): ${buf2.data[0].toFixed(6)} (Expected: 0.150000)`);
  assert.ok(Math.abs(buf2.data[0] - 0.15) < 1e-6, `Frame blend should be exactly 0.15, got ${buf2.data[0]}`);

  // Timeline Frame 3: src = 1 + (3-1)*0.5 = 2.0 -> exactly Frame 2 (0.2)
  const buf3 = graph.evaluate('Retime_Blend', { frame: 3 });
  assert.ok(Math.abs(buf3.data[0] - 0.2) < 1e-5, 'Frame 3 should be exactly 0.2');

  console.log('  ✔ Sub-frame float32 linear cross-dissolve verified with exact math');
}

// -------------------------------------------------------------
// Test 3: Reverse Playback
// -------------------------------------------------------------
console.log('\n▶ Test 3: Reverse Playback Sequence Inversion...');
{
  const graph = new Graph();
  const seq = graph.addNode(new MockSequenceNode('Seq3'));
  const retime = graph.addNode(new RetimeNode('Retime_Reverse'));
  retime.setKnobValue('reverse', true);
  retime.setKnobValue('speed', 1.0);
  retime.setKnobValue('firstFrame', 1);
  retime.setKnobValue('lastFrame', 5); // 5 frames: 1=0.1, 2=0.2, 3=0.3, 4=0.4, 5=0.5
  graph.connect('Seq3', 'out', 'Retime_Reverse', 'in');

  // Timeline Frame 1: reversed should pull last frame (frame 5 -> val 0.5)
  const b1 = graph.evaluate('Retime_Reverse', { frame: 1 });
  assert.ok(Math.abs(b1.data[0] - 0.5) < 1e-5, 'Frame 1 of reverse should pull frame 5 (0.5)');

  // Timeline Frame 5: reversed should pull first frame (frame 1 -> val 0.1)
  const b5 = graph.evaluate('Retime_Reverse', { frame: 5 });
  assert.ok(Math.abs(b5.data[0] - 0.1) < 1e-5, 'Frame 5 of reverse should pull frame 1 (0.1)');

  console.log(`  Reverse Playback: Timeline F1 = ${b1.data[0].toFixed(2)} (src 5), Timeline F5 = ${b5.data[0].toFixed(2)} (src 1)`);
  console.log('  ✔ Reverse playback verified');
}

// -------------------------------------------------------------
// Test 4: Freeze Frame Hold
// -------------------------------------------------------------
console.log('\n▶ Test 4: Freeze Frame Hold...');
{
  const graph = new Graph();
  const seq = graph.addNode(new MockSequenceNode('Seq4'));
  const retime = graph.addNode(new RetimeNode('Retime_Freeze'));
  retime.setKnobValue('freezeFrame', 3); // Freeze at frame 3 (val 0.3)
  graph.connect('Seq4', 'out', 'Retime_Freeze', 'in');

  const b1 = graph.evaluate('Retime_Freeze', { frame: 1 });
  const b10 = graph.evaluate('Retime_Freeze', { frame: 10 });
  const b100 = graph.evaluate('Retime_Freeze', { frame: 100 });

  assert.ok(Math.abs(b1.data[0] - 0.3) < 1e-5);
  assert.ok(Math.abs(b10.data[0] - 0.3) < 1e-5);
  assert.ok(Math.abs(b100.data[0] - 0.3) < 1e-5);

  console.log('  ✔ Freeze frame held constant value 0.3 across all timeline frames');
}

// -------------------------------------------------------------
// Test 5: TimeWarp Animated Curve Remapping
// -------------------------------------------------------------
console.log('\n▶ Test 5: TimeWarp Animated Curve Evaluation...');
{
  const graph = new Graph();
  const seq = graph.addNode(new MockSequenceNode('Seq5'));
  const tw = graph.addNode(new TimeWarpNode('TimeWarp1'));
  tw.setKnobValue('filter', 'blend');
  tw.setKnobValue('firstFrame', 1);
  tw.setKnobValue('lastFrame', 10);

  // Set non-linear curve:
  // Timeline F1 -> Source F1 (0.1)
  // Timeline F5 -> Source F9 (0.9) (Accelerated speed ramp)
  tw.setWarpKey(1, 1.0);
  tw.setWarpKey(5, 9.0);
  graph.connect('Seq5', 'out', 'TimeWarp1', 'in');

  // Timeline F1: src = 1.0 -> 0.1
  const b1 = graph.evaluate('TimeWarp1', { frame: 1 });
  assert.ok(Math.abs(b1.data[0] - 0.1) < 1e-5, 'F1 should be 0.1');

  // Timeline F3: midpoint on linear curve between F1 (1.0) and F5 (9.0) -> src = 5.0 -> 0.5
  const b3 = graph.evaluate('TimeWarp1', { frame: 3 });
  console.log(`  TimeWarp Non-Linear Lookup at Timeline F3: Value = ${b3.data[0].toFixed(4)} (src 5.0)`);
  assert.ok(Math.abs(b3.data[0] - 0.5) < 1e-4, 'F3 on warp curve should evaluate to src frame 5 (0.5)');

  // Timeline F5: src = 9.0 -> 0.9
  const b5 = graph.evaluate('TimeWarp1', { frame: 5 });
  assert.ok(Math.abs(b5.data[0] - 0.9) < 1e-4, 'F5 should be 0.9');

  console.log('  ✔ TimeWarp animated curve successfully remapped frames');
}

// -------------------------------------------------------------
// Test 6: Boundary Handling (Hold vs Black)
// -------------------------------------------------------------
console.log('\n▶ Test 6: Boundary Handling (Hold vs Black)...');
{
  const graph = new Graph();
  const seq = graph.addNode(new MockSequenceNode('Seq6'));
  const retime = graph.addNode(new RetimeNode('Retime_Bounds'));
  retime.setKnobValue('firstFrame', 5);
  retime.setKnobValue('lastFrame', 15);
  retime.setKnobValue('before', 'black');
  retime.setKnobValue('after', 'black');
  graph.connect('Seq6', 'out', 'Retime_Bounds', 'in');

  // Before range (frame 2 < firstFrame 5) with before=black
  const beforeBuf = graph.evaluate('Retime_Bounds', { frame: 2 });
  assert.ok(beforeBuf.data[0] === 0.0, 'Before range with black mode should return zero buffer');

  // Change to hold mode
  retime.setKnobValue('before', 'hold');
  const holdBuf = graph.evaluate('Retime_Bounds', { frame: 2 });
  assert.ok(Math.abs(holdBuf.data[0] - 0.5) < 1e-5, 'Before range with hold mode should hold frame 5 (0.5)');

  console.log('  ✔ Boundary conditions (black & hold) verified');
}

console.log('\n================================================================');
console.log('✅ ALL RETIME & TIMEWARP TESTS PASSED (Workstream 3.4 Automated Verification Passed)');
console.log('================================================================');
