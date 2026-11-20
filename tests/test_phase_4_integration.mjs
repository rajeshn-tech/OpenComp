/**
 * OpenComp - Workstream 4.5 Integration Test Suite
 * Validates full Phase 4 integration:
 * 1. Multi-node 2D/3D Production Pipeline:
 *    Constant -> Project3D -> Card3D (with Axis3D parent) -> Scene3D + Camera3D -> ScanlineRender -> Grade -> Merge
 * 2. Complete Project Serialization & Deserialization Round-Trip
 * 3. Bidirectional Foundry Nuke (.nk) ASCII Script Translation
 * 4. Node Registry, Catalog, and Factory Audit (54 registered nodes)
 */

import { Graph } from '../src/core/Graph.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { NukeScriptIO } from '../src/core/NukeScriptIO.js';
import { NODE_REGISTRY, NODE_MENU, createNode } from '../src/nodes/index.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    passed++;
    console.log(`  ✔ PASS: ${message}`);
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🎯 RUNNING: tests/test_phase_4_integration.mjs (Workstream 4.5)');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test 1: Node Registry & Factory Audit
  // -------------------------------------------------------------
  console.log('▶ Test 1: Node Registry & Factory Audit ...');
  {
    const expected3DNodes = [
      'Axis3D',
      'Camera3D',
      'Card3D',
      'Cube3D',
      'Scene3D',
      'Project3D',
      'ScanlineRender'
    ];

    for (const type of expected3DNodes) {
      assert(NODE_REGISTRY[type] !== undefined, `Node type '${type}' registered in NODE_REGISTRY`);
      const instance = createNode(type);
      assert(instance !== null && instance.type === type, `createNode('${type}') returns valid instance`);
    }

    const menu3D = NODE_MENU.find(m => m.category === '3D');
    assert(menu3D !== undefined, "'3D' category exists in NODE_MENU");
    assert(menu3D.items.length === 7, `'3D' menu contains exactly 7 items (found ${menu3D ? menu3D.items.length : 0})`);

    const totalNodes = Object.keys(NODE_REGISTRY).length;
    assert(totalNodes >= 54, `Total registered nodes in catalog is at least 54 (found ${totalNodes})`);
  }

  // -------------------------------------------------------------
  // Test 2: Multi-Node 2D/3D Hybrid Production Pipeline
  // -------------------------------------------------------------
  console.log('\n▶ Test 2: Full 2D/3D Hybrid Production Pipeline ...');
  {
    const graph = new Graph();

    // 1. 2D Texture Constant (Pure Red)
    const constTex = createNode('Constant', 'tex1');
    constTex.setKnobValue('format', '128x128');
    constTex.setKnobValue('colorR', 1.0);
    constTex.setKnobValue('colorG', 0.0);
    constTex.setKnobValue('colorB', 0.0);
    constTex.setKnobValue('colorA', 1.0);
    graph.addNode(constTex);

    // 2. 2D Background Constant (Pure Dark Blue)
    const constBg = createNode('Constant', 'bg1');
    constBg.setKnobValue('format', '128x128');
    constBg.setKnobValue('colorR', 0.0);
    constBg.setKnobValue('colorG', 0.0);
    constBg.setKnobValue('colorB', 0.2);
    constBg.setKnobValue('colorA', 1.0);
    graph.addNode(constBg);

    // 3. Parent Axis for 3D card
    const axis = createNode('Axis3D', 'axis1');
    axis.setKnobValue('translateZ', 0.0);
    graph.addNode(axis);

    // 4. Card3D Geometry connected to Axis
    const card = createNode('Card3D', 'card1');
    card.setKnobValue('uniformScale', 2.0);
    graph.addNode(card);
    graph.connect(axis.id, 'out', card.id, 'axis');

    // 5. Camera for projection and scene view
    const cam = createNode('Camera3D', 'cam1');
    cam.setKnobValue('translateZ', 5.0);
    graph.addNode(cam);

    // 6. Project3D: project constant texture onto card
    const project = createNode('Project3D', 'proj1');
    graph.addNode(project);
    graph.connect(constTex.id, 'out', project.id, 'in');
    graph.connect(cam.id, 'out', project.id, 'cam');
    graph.connect(card.id, 'out', project.id, 'geo');

    // 7. Scene3D container
    const scene = createNode('Scene3D', 'scene1');
    graph.addNode(scene);
    graph.connect(project.id, 'out', scene.id, '0');

    // 8. ScanlineRender
    const render = createNode('ScanlineRender', 'render1');
    render.setKnobValue('format', 'custom');
    render.setKnobValue('width', 128);
    render.setKnobValue('height', 128);
    render.setKnobValue('shading', 'unlit');
    graph.addNode(render);
    graph.connect(scene.id, 'out', render.id, 'obj');
    graph.connect(cam.id, 'out', render.id, 'cam');

    // 9. Grade (2D post-render adjustment: double gain on Red)
    const grade = createNode('Grade', 'grade1');
    grade.setKnobValue('gain', 1.0);
    graph.addNode(grade);
    graph.connect(render.id, 'out', grade.id, 'in');

    // 10. Merge (Over composite 3D render over 2D background plate)
    const merge = createNode('Merge', 'merge1');
    merge.setKnobValue('operation', 'over');
    graph.addNode(merge);
    graph.connect(constBg.id, 'out', merge.id, 'B');
    graph.connect(grade.id, 'out', merge.id, 'A');

    // Evaluate pipeline through DAG
    const finalBuffer = await graph.evaluate(merge.id);

    assert(finalBuffer instanceof PixelBuffer, 'Pipeline evaluation returns a PixelBuffer');
    assert(finalBuffer.width === 128 && finalBuffer.height === 128, 'Output matches format (128x128)');

    // Center pixel should be Red from 3D card
    const centerIdx = (64 * 128 + 64) * 4;
    const cr = finalBuffer.data[centerIdx];
    const cg = finalBuffer.data[centerIdx + 1];
    const cb = finalBuffer.data[centerIdx + 2];
    assert(cr > 0.9 && cg < 0.1 && cb < 0.1, `Center pixel is Red from 3D Card (R=${cr.toFixed(2)}, G=${cg.toFixed(2)}, B=${cb.toFixed(2)})`);

    // Corner pixel outside card should be Background Blue (0, 0, 0.2, 1)
    const cornerIdx = (4 * 128 + 4) * 4;
    const bgr = finalBuffer.data[cornerIdx];
    const bgg = finalBuffer.data[cornerIdx + 1];
    const bgb = finalBuffer.data[cornerIdx + 2];
    assert(bgr < 0.05 && bgg < 0.05 && Math.abs(bgb - 0.2) < 0.05,
      `Corner pixel is Background Blue (R=${bgr.toFixed(2)}, B=${bgb.toFixed(2)})`);
  }

  // -------------------------------------------------------------
  // Test 3: Project JSON Serialization & Deserialization Round-Trip
  // -------------------------------------------------------------
  console.log('\n▶ Test 3: Project Serialization Round-Trip ...');
  {
    const graph = new Graph();
    const cam = createNode('Camera3D', 'cam1');
    cam.setKnobValue('focal', 35.0);
    cam.setKnobValue('translateY', 1.5);
    graph.addNode(cam);

    const card = createNode('Card3D', 'card1');
    card.setKnobValue('uniformScale', 3.0);
    graph.addNode(card);

    const render = createNode('ScanlineRender', 'render1');
    render.setKnobValue('shading', 'flat');
    graph.addNode(render);
    graph.connect(card.id, 'out', render.id, 'obj');
    graph.connect(cam.id, 'out', render.id, 'cam');

    // Serialize to JSON string
    const jsonStr = JSON.stringify(graph.serialize());

    // Reconstruct into fresh graph
    const freshGraph = new Graph();
    const parsedData = JSON.parse(jsonStr);
    freshGraph.deserialize(parsedData, (type, id, x, y) => createNode(type, id, x, y));

    const reconCam = freshGraph.getNode('cam1');
    const reconCard = freshGraph.getNode('card1');
    const reconRender = freshGraph.getNode('render1');

    assert(reconCam && reconCam.type === 'Camera3D', 'Camera3D successfully deserialized');
    assert(reconCam.getKnobValue('focal') === 35.0, 'Camera3D focal knob value preserved');
    assert(reconCam.getKnobValue('translateY') === 1.5, 'Camera3D translateY knob value preserved');

    assert(reconCard && reconCard.type === 'Card3D', 'Card3D successfully deserialized');
    assert(reconCard.getKnobValue('uniformScale') === 3.0, 'Card3D uniformScale knob value preserved');

    assert(reconRender && reconRender.type === 'ScanlineRender', 'ScanlineRender successfully deserialized');
    assert(reconRender.getKnobValue('shading') === 'flat', 'ScanlineRender shading knob value preserved');

    // Verify connections preserved
    const objInp = reconRender.inputs.find(i => i.id === 'obj');
    const camInp = reconRender.inputs.find(i => i.id === 'cam');
    assert(objInp && objInp.connection && objInp.connection.nodeId === 'card1',
      'ScanlineRender obj input connection restored');
    assert(camInp && camInp.connection && camInp.connection.nodeId === 'cam1',
      'ScanlineRender cam input connection restored');
  }

  // -------------------------------------------------------------
  // Test 4: Foundry Nuke (.nk) Script Bidirectional Translation
  // -------------------------------------------------------------
  console.log('\n▶ Test 4: Nuke Script Bidirectional Round-Trip ...');
  {
    const graph = new Graph();

    const cam = createNode('Camera3D', 'Camera3D1');
    cam.setKnobValue('focal', 28.0);
    cam.setKnobValue('haperture', 24.0);
    graph.addNode(cam);

    const card = createNode('Card3D', 'Card3D1');
    card.setKnobValue('uniformScale', 2.5);
    graph.addNode(card);

    const render = createNode('ScanlineRender', 'ScanlineRender1');
    render.setKnobValue('shading', 'unlit');
    graph.addNode(render);
    graph.connect(card.id, 'out', render.id, 'obj');
    graph.connect(cam.id, 'out', render.id, 'cam');

    // Export to Nuke script
    const nkScript = NukeScriptIO.exportToNuke(graph);

    assert(nkScript.includes('Camera2 {'), 'Nuke script exports Camera2 block');
    assert(nkScript.includes('Card2 {'), 'Nuke script exports Card2 block');
    assert(nkScript.includes('ScanlineRender {'), 'Nuke script exports ScanlineRender block');
    assert(nkScript.includes('focal 28'), 'Nuke script exports focal knob');

    // Parse back into a new graph
    const importedGraph = new Graph();
    NukeScriptIO.importFromNuke(
      nkScript,
      (type, id, x, y) => createNode(type, id, x, y),
      importedGraph
    );

    const impCam = importedGraph.getAllNodes().find(n => n.type === 'Camera3D');
    const impCard = importedGraph.getAllNodes().find(n => n.type === 'Card3D');
    const impRender = importedGraph.getAllNodes().find(n => n.type === 'ScanlineRender');

    assert(impCam !== undefined, 'Camera2 imported as Camera3D');
    assert(impCard !== undefined, 'Card2 imported as Card3D');
    assert(impRender !== undefined, 'ScanlineRender imported as ScanlineRender');
    assert(impCam.getKnobValue('focal') === 28, 'Camera3D focal knob value parsed accurately');
  }

  console.log('\n================================================================');
  console.log(`✅ ALL PHASE 4 INTEGRATION TESTS PASSED (${passed}/${passed + failed})`);
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
