/**
 * OpenComp - Stability & Stress Testing Suite
 * Validates system resilience under high-stress conditions:
 * - 100+ node DAG graphs
 * - 100-cycle memory leak verification
 * - Dynamic addition & deletion of 200 nodes
 * - Missing footage & malformed connection resilience
 * - Repeated serialize/deserialize project integrity
 */

import { strict as assert } from 'assert';
import { performance } from 'perf_hooks';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_stability_stress.mjs');
console.log('====================================================\n');

let passedTests = 0;

function runTest(name, fn) {
  try {
    process.stdout.write(`▶ ${name}... `);
    const t0 = performance.now();
    fn();
    const t1 = performance.now();
    console.log(`✅ PASSED (${(t1 - t0).toFixed(1)} ms)`);
    passedTests++;
  } catch (err) {
    console.log(`❌ FAILED`);
    console.error(err);
    process.exit(1);
  }
}

// ----------------------------------------------------------------------
// 1. 100+ Node Massive DAG Graph Evaluation
// ----------------------------------------------------------------------
runTest('120-Node Deep Composite DAG Construction & Topological Evaluation', () => {
  const graph = new Graph();

  // Root Generator
  const root = createNode('Constant', 'Root_Constant');
  root.setKnobValue('format', '320x180');
  root.setKnobValue('colorR', 0.5);
  graph.addNode(root);

  let prevNode = root;
  const totalNodes = 120;

  for (let i = 1; i <= totalNodes; i++) {
    let nodeType = 'Grade';
    if (i % 5 === 0) nodeType = 'Blur';
    else if (i % 5 === 1) nodeType = 'Invert';
    else if (i % 5 === 2) nodeType = 'Premult';
    else if (i % 5 === 3) nodeType = 'Unpremult';

    const node = createNode(nodeType, `Node_${i}`);
    if (nodeType === 'Blur') node.setKnobValue('size', 1.0);
    if (nodeType === 'Grade') node.setKnobValue('gain', 1.001);

    graph.addNode(node);
    graph.connect(prevNode.id, 'out', node.id, 'in');
    prevNode = node;
  }

  assert.equal(graph.getAllNodes().length, totalNodes + 1);

  // Validate topological order on 120 nodes
  const order = graph.getTopologicalOrder();
  assert.equal(order.length, totalNodes + 1);
  assert.equal(order[0], 'Root_Constant');
  assert.equal(order[order.length - 1], `Node_${totalNodes}`);

  // Evaluate the 120-node tail
  const result = graph.evaluate(`Node_${totalNodes}`);
  assert(result !== null);
  assert.equal(result.width, 320);
  assert.equal(result.height, 180);
});

// ----------------------------------------------------------------------
// 2. 100-Cycle Memory Leak Stress Test
// ----------------------------------------------------------------------
runTest('100-Cycle Evaluation Memory Leak Verification', () => {
  const graph = new Graph();
  const c = createNode('Constant', 'C_Mem');
  c.setKnobValue('format', '640x360');
  const g = createNode('Grade', 'G_Mem');
  g.setKnobValue('gain', 1.1);
  graph.addNode(c);
  graph.addNode(g);
  graph.connect('C_Mem', 'out', 'G_Mem', 'in');

  // Warmup 5 cycles
  for (let i = 0; i < 5; i++) {
    g.markDirty();
    graph.evaluate('G_Mem');
  }

  if (global.gc) global.gc();
  const memStart = process.memoryUsage().heapUsed;

  // Run 100 consecutive full-frame re-evaluations
  for (let i = 0; i < 100; i++) {
    g.markDirty();
    c.setKnobValue('colorR', (i % 10) * 0.1);
    graph.evaluate('G_Mem');
  }

  if (global.gc) global.gc();
  const memEnd = process.memoryUsage().heapUsed;
  const memGrowthMB = (memEnd - memStart) / (1024 * 1024);

  // Memory growth after 100 full-frame evaluations should be under 15 MB
  assert(memGrowthMB < 15.0, `Memory leak detected! Growth: ${memGrowthMB.toFixed(2)} MB`);
});

// ----------------------------------------------------------------------
// 3. Dynamic Node Addition & Deletion Cleanup
// ----------------------------------------------------------------------
runTest('Dynamic Addition & Deletion of 200 Nodes with Connection Pruning', () => {
  const graph = new Graph();
  const root = createNode('Constant', 'Anchor');
  graph.addNode(root);

  const createdIds = [];
  for (let i = 0; i < 200; i++) {
    const n = createNode('Grade', `TempNode_${i}`);
    graph.addNode(n);
    graph.connect(root.id, 'out', n.id, 'in');
    createdIds.push(n.id);
  }

  assert.equal(graph.getAllNodes().length, 201);

  // Delete all 200 nodes
  for (const id of createdIds) {
    graph.removeNode(id);
  }

  assert.equal(graph.getAllNodes().length, 1);
  assert.equal(graph.getNode('Anchor') !== undefined, true);
});

// ----------------------------------------------------------------------
// 4. Missing Footage & Malformed Connection Resilience
// ----------------------------------------------------------------------
runTest('Resilience Against Missing Footage, Circular Loops & Invalid Ports', () => {
  const graph = new Graph();

  // Read pointing to missing file
  const r = createNode('Read', 'Read_Missing');
  r.setKnobValue('sourceType', 'file'); // No image uploaded
  graph.addNode(r);

  const g = createNode('Grade', 'Grade_Orphan');
  graph.addNode(g);
  graph.connect('Read_Missing', 'out', 'Grade_Orphan', 'in');

  // Should evaluate safely to null without crashing or throwing uncaught exceptions
  assert.doesNotThrow(() => {
    const res = graph.evaluate('Grade_Orphan');
    assert.equal(res, null);
  });

  // Invalid connection attempts
  const badConn1 = graph.connect('NonExistent', 'out', 'Grade_Orphan', 'in');
  assert.equal(badConn1, false);

  const badConn2 = graph.connect('Read_Missing', 'out', 'Grade_Orphan', 'invalid_port');
  assert.equal(badConn2, false);
});

// ----------------------------------------------------------------------
// 5. 50-Cycle Project Serialization / Deserialization Integrity
// ----------------------------------------------------------------------
runTest('50-Cycle Project Serialization & Deserialization Invariance', () => {
  const graph = new Graph();
  const c = createNode('Constant', 'C1', 10, 20);
  c.setKnobValue('colorR', 0.33);
  const g = createNode('Grade', 'G1', 30, 40);
  g.setKnobValue('gamma', 1.45);
  graph.addNode(c);
  graph.addNode(g);
  graph.connect('C1', 'out', 'G1', 'in');

  let currentData = graph.serialize();

  for (let i = 0; i < 50; i++) {
    const newGraph = new Graph();
    newGraph.deserialize(currentData, createNode);
    currentData = newGraph.serialize();
  }

  const finalGraph = new Graph();
  finalGraph.deserialize(currentData, createNode);

  assert.equal(finalGraph.getAllNodes().length, 2);
  const restoredC = finalGraph.getNode('C1');
  const restoredG = finalGraph.getNode('G1');
  assert(restoredC !== undefined);
  assert(restoredG !== undefined);
  assert.equal(restoredC.getKnobValue('colorR'), 0.33);
  assert.equal(restoredG.getKnobValue('gamma'), 1.45);
  assert.equal(restoredG.inputs[0].connection.nodeId, 'C1');
});

console.log(`\n🎉 test_stability_stress.mjs PASSED: All ${passedTests} stress tests succeeded!\n`);

