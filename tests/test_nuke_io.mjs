/**
 * OpenComp Test Suite - Foundry Nuke (.nk) Bidirectional Interoperability Test
 * Validates Nuke script generation, stack-based DAG parsing, knob serialization, 
 * connection restoration, and round-trip fidelity.
 */

import { strict as assert } from 'assert';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';
import { NukeScriptIO } from '../src/core/NukeScriptIO.js';

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_nuke_io.mjs');
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

// 1. Export Graph to authentic Nuke syntax
runTest('NukeScriptIO: Export Complex Multi-Branch DAG to .nk Script', () => {
  const graph = new Graph();

  const c1 = createNode('Constant', 'BG_Constant', 100, 100);
  c1.setKnobValue('colorR', 0.2);
  c1.setKnobValue('colorG', 0.3);
  c1.setKnobValue('colorB', 0.4);

  const g1 = createNode('Grade', 'Grade_Primary', 100, 200);
  g1.setKnobValue('gain', 1.35);
  g1.setKnobValue('gamma', 0.85);

  const fg = createNode('Constant', 'FG_Constant', 300, 100);
  fg.setKnobValue('colorR', 0.9);

  const m1 = createNode('Merge', 'Merge_Comp', 100, 300);
  m1.setKnobValue('operation', 'over');

  const v1 = createNode('Viewer', 'Viewer1', 100, 450);

  graph.addNode(c1);
  graph.addNode(g1);
  graph.addNode(fg);
  graph.addNode(m1);
  graph.addNode(v1);

  graph.connect('BG_Constant', 'out', 'Grade_Primary', 'in');
  graph.connect('Grade_Primary', 'out', 'Merge_Comp', 'B');
  graph.connect('FG_Constant', 'out', 'Merge_Comp', 'A');
  graph.connect('Merge_Comp', 'out', 'Viewer1', '1');

  const nkText = NukeScriptIO.exportToNuke(graph);

  // Validate Nuke syntax tokens
  assert(nkText.includes('version 14.0 v1'), 'Must include Nuke version line');
  assert(nkText.includes('Root {'), 'Must include Root definition');
  assert(nkText.includes('format "1920 1080'), 'Must include project format');
  assert(nkText.includes('Constant {'), 'Must export Constant block');
  assert(nkText.includes('Grade {'), 'Must export Grade block');
  assert(nkText.includes('Merge2 {') || nkText.includes('Merge {'), 'Must export Merge block');
  assert(nkText.includes('gain 1.35'), 'Must preserve knob values');
  assert(nkText.includes('gamma 0.85'), 'Must preserve knob values');
  assert(nkText.includes('push $N_') || nkText.includes('set N_'), 'Must preserve DAG stack routing tokens');
});

// 2. Bidirectional Round-Trip Import & Reconnection
runTest('NukeScriptIO: Bidirectional Round-Trip Import & Graph Reconnection', () => {
  const originalGraph = new Graph();

  const c = createNode('Constant', 'C_Source', 50, 50);
  c.setKnobValue('colorR', 0.7);
  const b = createNode('Blur', 'Blur_Pass', 50, 150);
  b.setKnobValue('size', 25.0);

  originalGraph.addNode(c);
  originalGraph.addNode(b);
  originalGraph.connect('C_Source', 'out', 'Blur_Pass', 'in');

  const exportedNK = NukeScriptIO.exportToNuke(originalGraph);

  // Import into a fresh new graph
  const importedGraph = new Graph();
  const success = NukeScriptIO.importFromNuke(exportedNK, importedGraph, createNode);
  assert(Array.isArray(success) ? success.length > 0 : !!success);

  const importedNodes = importedGraph.getAllNodes();
  assert(importedNodes.length >= 2, `Expected at least 2 nodes, got ${importedNodes.length}`);

  const importedC = importedNodes.find(n => n.type === 'Constant');
  const importedB = importedNodes.find(n => n.type === 'Blur');
  assert(importedC !== undefined, 'Constant node must be reconstructed');
  assert(importedB !== undefined, 'Blur node must be reconstructed');

  // Verify knob preservation
  assert.equal(importedB.getKnobValue('size'), 25.0);

  // Verify DAG connection was preserved
  const inPort = importedB.inputs.find(inp => inp.id === 'in');
  assert(inPort !== undefined);
  assert(inPort.connection !== null, 'Connection between Constant and Blur must be re-established');
  assert.equal(inPort.connection.nodeId, importedC.id);
});

// 3. Robust parsing of Foundry Nuke scripts with unknown knobs & comments
runTest('NukeScriptIO: Parse Script with Real Nuke Knobs and Comments', () => {
  const sampleRealNukeScript = `#! /usr/local/Nuke13.2v2/libnuke-13.2.2.so -nx
version 13.2 v2
define_window_layout_xml {<layout version="1.0">...</layout>}
Root {
 inputs 0
 name "TestProductionShot_v01.nk"
 frame 101
 first_frame 101
 last_frame 150
 lock_range true
 format "2048 1080 0 0 2048 1080 1 2K_DCI"
 proxy_type scale
}
Constant {
 inputs 0
 channels rgb
 color {0.1 0.2 0.3 1}
 format "2048 1080 0 0 2048 1080 1 2K_DCI"
 name Constant_Studio
 xpos 120
 ypos 50
}
Grade {
 inputs 1
 blackpoint 0.05
 whitepoint 0.95
 gamma 1.2
 black_clamp true
 name Grade_Studio
 xpos 120
 ypos 180
}
`;

  const parsedGraph = new Graph();
  const ok = NukeScriptIO.importFromNuke(sampleRealNukeScript, parsedGraph, createNode);
  assert(Array.isArray(ok) ? ok.length > 0 : !!ok);

  const grade = parsedGraph.getAllNodes().find(n => n.type === 'Grade');
  assert(grade !== undefined, 'Grade node should be created');
  assert.equal(grade.getKnobValue('gamma'), 1.2);
  assert.equal(grade.getKnobValue('blackpoint'), 0.05);
  assert.equal(grade.getKnobValue('whitepoint'), 0.95);
});

// 4. Round-trip newly added VFX production nodes
runTest('NukeScriptIO: Bidirectional Round-Trip of Production Nodes (Switch, FrameHold, ZDefocus, ContactSheet)', () => {
  const g = new Graph();

  const c1 = createNode('Constant', 'PlateA', 0, 0);
  const c2 = createNode('Constant', 'PlateB', 150, 0);
  const depth = createNode('Constant', 'DepthMap', 300, 0);

  const fh = createNode('FrameHold', 'HoldFrame_PlateA', 0, 100);
  fh.setKnobValue('firstFrame', 105);

  const sw = createNode('Switch', 'Switch_AB', 100, 200);
  sw.setKnobValue('which', 1.0);

  const zdef = createNode('ZDefocus', 'Bokeh_Defocus', 100, 300);
  zdef.setKnobValue('maxDefocus', 24.0);
  zdef.setKnobValue('focusPlane', 0.42);

  const cs = createNode('ContactSheet', 'ContactMatrix', 100, 400);
  cs.setKnobValue('rows', 2);
  cs.setKnobValue('columns', 2);

  g.addNode(c1);
  g.addNode(c2);
  g.addNode(depth);
  g.addNode(fh);
  g.addNode(sw);
  g.addNode(zdef);
  g.addNode(cs);

  g.connect('PlateA', 'out', 'HoldFrame_PlateA', 'in');
  g.connect('HoldFrame_PlateA', 'out', 'Switch_AB', '0');
  g.connect('PlateB', 'out', 'Switch_AB', '1');
  g.connect('Switch_AB', 'out', 'Bokeh_Defocus', 'in');
  g.connect('DepthMap', 'out', 'Bokeh_Defocus', 'depth');
  g.connect('Bokeh_Defocus', 'out', 'ContactMatrix', '0');

  const nkText = NukeScriptIO.exportToNuke(g);
  assert(nkText.includes('FrameHold {'), 'Export must contain FrameHold');
  assert(nkText.includes('Switch {'), 'Export must contain Switch');
  assert(nkText.includes('ZDefocus2 {'), 'Export must contain ZDefocus2');
  assert(nkText.includes('ContactSheet {'), 'Export must contain ContactSheet');
  assert(nkText.includes('firstFrame 105'), 'FrameHold firstFrame knob must be preserved');
  assert(nkText.includes('maxDefocus 24'), 'ZDefocus maxDefocus knob must be preserved');

  // Re-import
  const importedGraph = new Graph();
  NukeScriptIO.importFromNuke(nkText, importedGraph, createNode);
  const importedNodes = importedGraph.getAllNodes();

  const importedFh = importedNodes.find(n => n.type === 'FrameHold');
  const importedSw = importedNodes.find(n => n.type === 'Switch');
  const importedZdef = importedNodes.find(n => n.type === 'ZDefocus');
  const importedCs = importedNodes.find(n => n.type === 'ContactSheet');

  assert(importedFh, 'Imported FrameHold must exist');
  assert(importedSw, 'Imported Switch must exist');
  assert(importedZdef, 'Imported ZDefocus must exist');
  assert(importedCs, 'Imported ContactSheet must exist');

  assert.equal(importedFh.getKnobValue('firstFrame'), 105);
  assert.equal(importedSw.getKnobValue('which'), 1.0);
  assert.equal(importedZdef.getKnobValue('maxDefocus'), 24.0);
  assert.equal(importedZdef.getKnobValue('focusPlane'), 0.42);
  assert.equal(importedCs.getKnobValue('rows'), 2);

  // Check DAG re-connections
  const switchIn0 = importedSw.inputs.find(i => i.id === '0');
  const switchIn1 = importedSw.inputs.find(i => i.id === '1');
  assert(switchIn0 && switchIn0.connection, 'Switch port 0 should be connected');
  assert(switchIn1 && switchIn1.connection, 'Switch port 1 should be connected');

  const zdefIn = importedZdef.inputs.find(i => i.id === 'in');
  const zdefDepth = importedZdef.inputs.find(i => i.id === 'depth');
  assert(zdefIn && zdefIn.connection, 'ZDefocus image input should be connected');
  assert(zdefDepth && zdefDepth.connection, 'ZDefocus depth input should be connected');
});

console.log(`\n🎉 test_nuke_io.mjs PASSED: All ${passedTests} Nuke I/O tests succeeded with 0 errors.\n`);
