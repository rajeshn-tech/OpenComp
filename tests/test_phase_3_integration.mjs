/**
 * OpenComp Test Suite - Phase 3 Unified Integration & Master System Validation
 * Workstream 3.5: Verifies end-to-end integration of all Phase 3 systems:
 * 1. Multi-node production VFX graph execution (Tracker -> PlanarTracker -> SplineWarp -> Retime -> TimeWarp -> Merge)
 * 2. Dynamic BBox propagation through Phase 3 nodes
 * 3. Bidirectional OpenComp project serialization (.comp JSON)
 * 4. Bidirectional Foundry Nuke (.nk) script export & import round-trip
 * 5. Unified Node Registry & NodeCreationService catalog integrity (all 47 nodes)
 */

import { strict as assert } from 'assert';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { Graph } from '../src/core/Graph.js';
import { BBox } from '../src/core/BBox.js';
import { NODE_REGISTRY, NODE_MENU, createNode, NodeCreationService } from '../src/core/NodeRegistry.js';
import { NukeScriptIO } from '../src/core/NukeScriptIO.js';

console.log('================================================================');
console.log('🎯 RUNNING: tests/test_phase_3_integration.mjs');
console.log('================================================================\n');

let passedTests = 0;

function runTest(name, fn) {
  try {
    process.stdout.write(`▶ ${name} ... `);
    fn();
    console.log('✔ PASS');
    passedTests++;
  } catch (err) {
    console.log('❌ FAIL');
    console.error(err);
    process.exit(1);
  }
}

// -------------------------------------------------------------
// Test 1: Node Registry & NodeCreationService Catalog Integrity
// -------------------------------------------------------------
runTest('Test 1: Node Registry & NodeCreationService Catalog Integrity', () => {
  const regCount = Object.keys(NODE_REGISTRY).length;
  assert.ok(regCount >= 47, `Expected at least 47 registered nodes, got ${regCount}`);

  const phase3Types = ['Tracker', 'PlanarTracker', 'SplineWarp', 'Retime', 'TimeWarp'];
  for (const t of phase3Types) {
    assert.ok(NODE_REGISTRY[t], `Node type '${t}' must be in NODE_REGISTRY`);
    const instance = createNode(t);
    assert.ok(instance, `Failed to instantiate ${t}`);
    assert.equal(instance.type, t);
  }

  const mockApp = { graph: new Graph() };
  const service = new NodeCreationService(mockApp);
  const catalog = service.getCatalog();

  for (const t of phase3Types) {
    const entry = catalog.find(item => item.type === t);
    assert.ok(entry, `Catalog entry missing for ${t}`);
    assert.ok(entry.category === 'Transform' || entry.category === 'Time', `Unexpected category '${entry.category}' for ${t}`);
  }
});

// -------------------------------------------------------------
// Test 2: Dynamic BBox Propagation Across Phase 3 Nodes
// -------------------------------------------------------------
runTest('Test 2: Dynamic BBox Propagation Across Phase 3 Nodes', () => {
  const baseBox = new BBox(10, 20, 100, 200);

  // 1. TrackerNode (translate mode)
  const tracker = createNode('Tracker');
  tracker.setKnobValue('transformMode', 'matchmove');
  tracker.tracks = [
    {
      id: 1,
      enabled: true,
      refX: 100,
      refY: 100,
      keyframes: { 1: { x: 100, y: 100, ncc: 1.0 }, 5: { x: 125, y: 110, ncc: 0.99 } }
    }
  ];
  tracker.referenceFrame = 1;
  const bboxTracker = tracker.getBBox([baseBox], 5);
  assert.equal(bboxTracker.x, 35, 'Tracker bbox X shifted by dx=25');
  assert.equal(bboxTracker.y, 30, 'Tracker bbox Y shifted by dy=10');

  // 2. PlanarTrackerNode
  const planar = createNode('PlanarTracker');
  planar.setKnobValue('transformMode', 'matchmove');
  planar.currentCorners = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 0, y: 100 }
  ];
  planar.referenceCorners = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
  ];
  const bboxPlanar = planar.getBBox([baseBox], 1);
  assert.ok(bboxPlanar.width > baseBox.width, 'Planar tracker bbox should expand horizontally under 2x scale');

  // 3. SplineWarpNode
  const warp = createNode('SplineWarp');
  const pair = warp.addPair('s1');
  pair.addPointPair(50, 50, 80, 60, 1);
  const bboxWarp = warp.getBBox([baseBox], 1);
  assert.ok(bboxWarp.width >= baseBox.width, 'SplineWarp bbox must encompass input');

  // 4. RetimeNode & TimeWarpNode
  const retime = createNode('Retime');
  const bboxRetime = retime.getBBox([baseBox], 5);
  assert.equal(bboxRetime.x, baseBox.x);
  assert.equal(bboxRetime.width, baseBox.width);

  const timewarp = createNode('TimeWarp');
  const bboxTimeWarp = timewarp.getBBox([baseBox], 5);
  assert.equal(bboxTimeWarp.x, baseBox.x);
  assert.equal(bboxTimeWarp.width, baseBox.width);
});

// -------------------------------------------------------------
// Test 3: Multi-Node Production VFX Pipeline Execution
// -------------------------------------------------------------
runTest('Test 3: Multi-Node Production VFX Pipeline Execution', () => {
  const graph = new Graph();

  // Create procedural animated sequence source
  const constNode = createNode('Constant', 'src_const');
  constNode.setKnobValue('width', 128);
  constNode.setKnobValue('height', 128);
  constNode.setKnobValue('colorR', 0.2);
  constNode.setKnobValue('colorG', 0.4);
  constNode.setKnobValue('colorB', 0.6);
  constNode.setKnobValue('colorA', 1.0);
  graph.addNode(constNode);

  // RetimeNode: 2x speedup
  const retime = createNode('Retime', 'retime_test');
  retime.setKnobValue('speed', 2.0);
  graph.addNode(retime);
  graph.connect(constNode.id, 'out', retime.id, 'in');

  // TimeWarpNode: Custom non-linear curve
  const timewarp = createNode('TimeWarp', 'timewarp_test');
  timewarp.setKeyframe('warpCurve', 1, 1);
  timewarp.setKeyframe('warpCurve', 5, 10);
  graph.addNode(timewarp);
  graph.connect(retime.id, 'out', timewarp.id, 'in');

  // TrackerNode: Matchmove stabilization
  const tracker = createNode('Tracker', 'tracker_test');
  tracker.setKnobValue('transformMode', 'matchmove');
  tracker.tracks = [
    {
      id: 1,
      enabled: true,
      refX: 64,
      refY: 64,
      keyframes: { 1: { x: 64, y: 64, ncc: 1.0 }, 2: { x: 68, y: 66, ncc: 0.99 } }
    }
  ];
  graph.addNode(tracker);
  graph.connect(timewarp.id, 'out', tracker.id, 'in');

  // PlanarTrackerNode
  const planar = createNode('PlanarTracker', 'planar_test');
  planar.referenceCorners = [
    { x: 10, y: 10 }, { x: 118, y: 10 },
    { x: 118, y: 118 }, { x: 10, y: 118 }
  ];
  planar.currentCorners = [
    { x: 10, y: 10 }, { x: 118, y: 10 },
    { x: 118, y: 118 }, { x: 10, y: 118 }
  ];
  graph.addNode(planar);
  graph.connect(tracker.id, 'out', planar.id, 'in');

  // SplineWarpNode
  const warp = createNode('SplineWarp', 'warp_test');
  const pair3 = warp.addPair('spline_1');
  pair3.addPointPair(30, 30, 30, 30, 1);
  pair3.addPointPair(90, 30, 90, 30, 1); // identity warp
  graph.addNode(warp);
  graph.connect(planar.id, 'out', warp.id, 'in');

  // MergeNode (comp over background)
  const bg = createNode('Constant', 'bg_const');
  bg.setKnobValue('width', 128);
  bg.setKnobValue('height', 128);
  bg.setKnobValue('colorR', 0.0);
  bg.setKnobValue('colorG', 0.0);
  bg.setKnobValue('colorB', 0.0);
  bg.setKnobValue('colorA', 1.0);
  graph.addNode(bg);

  const merge = createNode('Merge', 'merge_test');
  merge.setKnobValue('operation', 'over');
  graph.addNode(merge);
  graph.connect(bg.id, 'out', merge.id, 'B');
  graph.connect(warp.id, 'out', merge.id, 'A');

  // Evaluate the full 6-node pipeline at frame 1
  const outBuf = graph.evaluate(merge.id, 1);
  assert.ok(outBuf instanceof PixelBuffer, 'Pipeline output must be a PixelBuffer');
  assert.equal(outBuf.width, 1920);
  assert.equal(outBuf.height, 1080);

  const centerPx = outBuf.getPixel(960, 540);
  assert.ok(Math.abs(centerPx[0] - 0.2) < 1e-3, `Red channel mismatch: ${centerPx[0]}`);
  assert.ok(Math.abs(centerPx[1] - 0.4) < 1e-3, `Green channel mismatch: ${centerPx[1]}`);
  assert.ok(Math.abs(centerPx[2] - 0.6) < 1e-3, `Blue channel mismatch: ${centerPx[2]}`);
});

// -------------------------------------------------------------
// Test 4: OpenComp Project (.comp / JSON) Serialization Round-Trip
// -------------------------------------------------------------
runTest('Test 4: OpenComp Project (.comp / JSON) Serialization Round-Trip', () => {
  const originalGraph = new Graph();

  const tracker = createNode('Tracker', 'trk_serial');
  tracker.setKnobValue('motionType', 'T+R');
  tracker.referenceFrame = 10;
  tracker.tracks = [
    {
      id: 1,
      enabled: true,
      refX: 200,
      refY: 150,
      searchRadius: 30,
      templateRadius: 15,
      keyframes: { 10: { x: 200, y: 150, ncc: 1.0 }, 11: { x: 205, y: 152, ncc: 0.98 } }
    }
  ];
  originalGraph.addNode(tracker);

  const planar = createNode('PlanarTracker', 'pln_serial');
  planar.referenceCorners = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }];
  planar.currentCorners = [{ x: 12, y: 11 }, { x: 52, y: 11 }, { x: 52, y: 51 }, { x: 12, y: 51 }];
  originalGraph.addNode(planar);
  originalGraph.connect(tracker.id, 'out', planar.id, 'in');

  const warp = createNode('SplineWarp', 'warp_serial');
  warp.setKnobValue('falloff', 80);
  const pair4 = warp.addPair('sp1');
  pair4.addPointPair(100, 100, 110, 105, 1);
  originalGraph.addNode(warp);
  originalGraph.connect(planar.id, 'out', warp.id, 'in');

  const retime = createNode('Retime', 'ret_serial');
  retime.setKnobValue('speed', 0.5);
  retime.setKnobValue('filter', 'blend');
  originalGraph.addNode(retime);
  originalGraph.connect(warp.id, 'out', retime.id, 'in');

  const timewarp = createNode('TimeWarp', 'tw_serial');
  timewarp.setKeyframe('warpCurve', 1, 10);
  timewarp.setKeyframe('warpCurve', 10, 100);
  originalGraph.addNode(timewarp);
  originalGraph.connect(retime.id, 'out', timewarp.id, 'in');

  // Serialize to JSON object
  const serialized = originalGraph.serialize();
  const jsonStr = JSON.stringify(serialized);
  assert.ok(jsonStr.length > 500, 'Serialized graph JSON must be non-empty');

  // Deserialize into fresh Graph instance
  const restoredGraph = new Graph();
  restoredGraph.deserialize(JSON.parse(jsonStr), createNode);

  assert.equal(restoredGraph.getAllNodes().length, 5, 'Must restore all 5 nodes');

  // Verify Tracker restored data
  const restTrk = restoredGraph.getNode('trk_serial');
  assert.ok(restTrk, 'Tracker node must be restored');
  assert.equal(restTrk.knobs.motionType.value, 'T+R');
  assert.equal(restTrk.referenceFrame, 10);
  assert.equal(restTrk.tracks.length, 1);
  assert.equal(restTrk.tracks[0].refX, 200);
  assert.equal(restTrk.tracks[0].getPos(11).x, 205);

  // Verify PlanarTracker restored data
  const restPln = restoredGraph.getNode('pln_serial');
  assert.ok(restPln, 'PlanarTracker node must be restored');
  assert.equal(restPln.currentCorners[0].x, 12);
  assert.equal(restPln.inputs[0].connection?.nodeId, 'trk_serial', 'PlanarTracker must stay connected to Tracker');

  // Verify SplineWarp restored data
  const restWarp = restoredGraph.getNode('warp_serial');
  assert.ok(restWarp, 'SplineWarp node must be restored');
  assert.equal(restWarp.knobs.falloff.value, 80);
  assert.equal(restWarp.getAllPairs().length, 1);
  assert.equal(restWarp.getAllPairs()[0].destination.points[0].getAtFrame(1).x, 110);
  assert.equal(restWarp.inputs[0].connection?.nodeId, 'pln_serial', 'SplineWarp must stay connected to PlanarTracker');

  // Verify Retime restored data
  const restRet = restoredGraph.getNode('ret_serial');
  assert.ok(restRet, 'Retime node must be restored');
  assert.equal(restRet.knobs.speed.value, 0.5);
  assert.equal(restRet.knobs.filter.value, 'blend');

  // Verify TimeWarp restored data
  const restTW = restoredGraph.getNode('tw_serial');
  assert.ok(restTW, 'TimeWarp node must be restored');
  assert.equal(restTW.knobs.warpCurve.keyframes[1], 10);
  assert.equal(restTW.knobs.warpCurve.keyframes[10], 100);
});

// -------------------------------------------------------------
// Test 5: Foundry Nuke (.nk) Script Bidirectional Round-Trip
// -------------------------------------------------------------
runTest('Test 5: Foundry Nuke (.nk) Script Bidirectional Round-Trip', () => {
  const graph = new Graph();

  const trk = createNode('Tracker', 'Tracker1');
  trk.setKnobValue('transformMode', 'matchmove');
  graph.addNode(trk);

  const pln = createNode('PlanarTracker', 'PlanarTracker1');
  graph.addNode(pln);
  graph.connect(trk.id, 'out', pln.id, 'in');

  const sw = createNode('SplineWarp', 'SplineWarp1');
  sw.setKnobValue('falloff', 64);
  graph.addNode(sw);
  graph.connect(pln.id, 'out', sw.id, 'in');

  const rt = createNode('Retime', 'Retime1');
  rt.setKnobValue('speed', 1.5);
  graph.addNode(rt);
  graph.connect(sw.id, 'out', rt.id, 'in');

  const tw = createNode('TimeWarp', 'TimeWarp1');
  graph.addNode(tw);
  graph.connect(rt.id, 'out', tw.id, 'in');

  // Export to authentic Nuke .nk script
  const nkScript = NukeScriptIO.exportToNuke(graph);

  // Verify canonical Nuke node type declarations
  assert.ok(nkScript.includes('Tracker4 {'), 'Must export as Tracker4');
  assert.ok(nkScript.includes('PlanarTracker1_1 {'), 'Must export as PlanarTracker1_1');
  assert.ok(nkScript.includes('SplineWarp3 {'), 'Must export as SplineWarp3');
  assert.ok(nkScript.includes('Retime {'), 'Must export as Retime');
  assert.ok(nkScript.includes('TimeWarp {'), 'Must export as TimeWarp');

  // Import back from Nuke script
  const importedGraph = new Graph();
  const parsedNodes = NukeScriptIO.importFromNuke(nkScript, createNode, importedGraph);

  assert.equal(parsedNodes.length, 5, `Expected 5 parsed nodes, got ${parsedNodes.length}`);

  const types = parsedNodes.map(n => n.type);
  assert.ok(types.includes('Tracker'), 'Parsed nodes must contain Tracker');
  assert.ok(types.includes('PlanarTracker'), 'Parsed nodes must contain PlanarTracker');
  assert.ok(types.includes('SplineWarp'), 'Parsed nodes must contain SplineWarp');
  assert.ok(types.includes('Retime'), 'Parsed nodes must contain Retime');
  assert.ok(types.includes('TimeWarp'), 'Parsed nodes must contain TimeWarp');

  // Verify reconstructed connection topology
  const parsedRT = importedGraph.getNode('Retime1');
  const parsedSW = importedGraph.getNode('SplineWarp1');
  assert.ok(parsedRT, 'Retime1 must exist in imported graph');
  assert.ok(parsedSW, 'SplineWarp1 must exist in imported graph');
  assert.equal(parsedRT.inputs[0].connection?.nodeId, parsedSW.id, 'Retime must be connected to SplineWarp');
});

console.log('\n================================================================');
console.log(`✅ ALL PHASE 3 INTEGRATION TESTS PASSED (${passedTests}/5)`);
console.log('================================================================');
