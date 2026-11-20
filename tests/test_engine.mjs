/**
 * OpenComp Test Suite - Engine, DAG, Memory & History Verification
 * Rigorously validates PixelBuffer, DAG topological sorting, cycle prevention, 
 * dirty-flag propagation, keyframe animation evaluation, and undo/redo history.
 */

import { strict as assert } from 'assert';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { Graph } from '../src/core/Graph.js';
import { HistoryManager } from '../src/core/HistoryManager.js';
import { createNode } from '../src/nodes/index.js';

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_engine.mjs');
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

// 1. PixelBuffer Core
runTest('PixelBuffer: Allocation, Dimensions & Float32 Precision', () => {
  const buf = new PixelBuffer(100, 50);
  assert.equal(buf.width, 100);
  assert.equal(buf.height, 50);
  assert.equal(buf.data.length, 100 * 50 * 4);
  assert(buf.data instanceof Float32Array);

  // Set and get pixel
  buf.setPixel(10, 20, [0.1234567, 0.7654321, 1.5, 0.8]);
  const p = buf.getPixel(10, 20);
  assert(Math.abs(p[0] - 0.1234567) < 1e-6);
  assert(Math.abs(p[1] - 0.7654321) < 1e-6);
  assert(Math.abs(p[2] - 1.5) < 1e-6);
  assert(Math.abs(p[3] - 0.8) < 1e-6);

  // Boundary check
  const oob = buf.getPixel(-1, 999);
  assert.deepEqual(oob, [0, 0, 0, 0]);
});

runTest('PixelBuffer: Clone and Memory Isolation', () => {
  const original = new PixelBuffer(10, 10);
  original.setPixel(5, 5, [1, 1, 1, 1]);
  const clone = original.clone();
  assert.deepEqual(clone.getPixel(5, 5), [1, 1, 1, 1]);

  // Mutate clone and ensure original is untouched
  clone.setPixel(5, 5, [0, 0, 0, 0]);
  assert.deepEqual(original.getPixel(5, 5), [1, 1, 1, 1]);
});

// 2. DAG Topology & Cycle Prevention
runTest('Graph: Node Addition, Connections and Querying', () => {
  const graph = new Graph();
  const c = createNode('Constant', 'C1', 0, 0);
  const g = createNode('Grade', 'G1', 0, 100);
  graph.addNode(c);
  graph.addNode(g);

  assert.equal(graph.getAllNodes().length, 2);
  const connected = graph.connect('C1', 'out', 'G1', 'in');
  assert.equal(connected, true);

  const inPort = g.inputs.find(i => i.id === 'in');
  assert.equal(inPort.connection.nodeId, 'C1');
});

runTest('Graph: Cycle Detection Rejection', () => {
  const graph = new Graph();
  const n1 = createNode('Grade', 'N1', 0, 0);
  const n2 = createNode('Blur', 'N2', 0, 100);
  graph.addNode(n1);
  graph.addNode(n2);

  graph.connect('N1', 'out', 'N2', 'in');

  // Attempt to connect N2 back to N1 (creating cycle N1 -> N2 -> N1)
  const cyclicConnected = graph.connect('N2', 'out', 'N1', 'in');
  assert.equal(cyclicConnected, false, 'Cycle must be rejected by graph manager');
});

runTest('Graph: Topological Sorting Order', () => {
  const graph = new Graph();
  const c = createNode('Constant', 'Const1', 0, 0);
  const g = createNode('Grade', 'Grade1', 0, 100);
  const b = createNode('Blur', 'Blur1', 0, 200);
  const v = createNode('Viewer', 'Viewer1', 0, 300);

  graph.addNode(v);
  graph.addNode(b);
  graph.addNode(g);
  graph.addNode(c);

  graph.connect('Const1', 'out', 'Grade1', 'in');
  graph.connect('Grade1', 'out', 'Blur1', 'in');
  graph.connect('Blur1', 'out', 'Viewer1', '1');

  const order = graph.getTopologicalOrder();
  assert(order.indexOf('Const1') < order.indexOf('Grade1'));
  assert(order.indexOf('Grade1') < order.indexOf('Blur1'));
  assert(order.indexOf('Blur1') < order.indexOf('Viewer1'));
});

// 3. Dirty Flag Propagation & Evaluation Caching
runTest('Graph: Dirty Flag Downstream Invalidation', () => {
  const graph = new Graph();
  const c = createNode('Constant', 'C', 0, 0);
  c.setKnobValue('colorR', 0.5);
  const g = createNode('Grade', 'G', 0, 100);
  graph.addNode(c);
  graph.addNode(g);
  graph.connect('C', 'out', 'G', 'in');

  // Initial evaluation
  const result1 = graph.evaluate('G');
  assert(result1 !== null);
  assert.equal(g.isDirty, false);

  // Changing upstream constant knob must mark downstream Grade dirty
  c.setKnobValue('colorR', 0.9);
  assert.equal(c.isDirty, true);
  assert.equal(g.isDirty, true);
  assert.equal(g.cachedBuffer, null);
});

// 4. Keyframe Animation & Frame-Aware Caching
runTest('Graph: Frame-Aware Animation Caching', () => {
  const graph = new Graph();
  const c = createNode('Constant', 'C_Anim', 0, 0);
  c.setKeyframe('colorR', 1, 0.0);
  c.setKeyframe('colorR', 10, 1.0);

  const g = createNode('Grade', 'G_Anim', 0, 100);
  graph.addNode(c);
  graph.addNode(g);
  graph.connect('C_Anim', 'out', 'G_Anim', 'in');

  // Evaluate at frame 1
  const bufFrame1 = graph.evaluate('G_Anim', { frame: 1 });
  const p1 = bufFrame1.getPixel(10, 10);
  assert(Math.abs(p1[0] - 0.0) < 1e-4);

  // Evaluate at frame 10 (without manual dirty marking; frame change must trigger evaluation)
  const bufFrame10 = graph.evaluate('G_Anim', { frame: 10 });
  const p10 = bufFrame10.getPixel(10, 10);
  assert(Math.abs(p10[0] - 1.0) < 1e-4);

  // Interpolated middle frame (frame 5.5)
  const bufFrameMid = graph.evaluate('G_Anim', { frame: 5.5 });
  const pMid = bufFrameMid.getPixel(10, 10);
  assert(Math.abs(pMid[0] - 0.5) < 1e-3);
});

// 5. HistoryManager Undo / Redo
runTest('HistoryManager: Multi-Step Snapshot, Undo and Redo', () => {
  const graph = new Graph();
  const history = new HistoryManager(10);

  const c1 = createNode('Constant', 'C1', 10, 20);
  graph.addNode(c1);
  history.pushState(graph);

  // Step 2: Add second node
  const g1 = createNode('Grade', 'G1', 30, 40);
  graph.addNode(g1);
  graph.connect('C1', 'out', 'G1', 'in');
  history.pushState(graph);

  assert.equal(graph.getAllNodes().length, 2);

  // Undo back to Step 1
  const undone = history.undo(graph, createNode);
  assert.equal(undone, true);
  assert.equal(graph.getAllNodes().length, 1);
  assert.equal(graph.getNode('C1') !== undefined, true);
  assert.equal(graph.getNode('G1'), undefined);

  // Redo back to Step 2
  const redone = history.redo(graph, createNode);
  assert.equal(redone, true);
  assert.equal(graph.getAllNodes().length, 2);
  assert.equal(graph.getNode('G1') !== undefined, true);
  assert.equal(graph.getNode('G1').inputs[0].connection.nodeId, 'C1');
});

console.log(`\n🎉 test_engine.mjs PASSED: All ${passedTests} engine tests succeeded with 0 errors.\n`);

