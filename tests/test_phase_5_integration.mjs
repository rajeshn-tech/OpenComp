/**
 * OpenComp - Workstream 5.5 Phase 5 Unified Deep Compositing Integration Test Suite
 * Validates full Phase 5 production integration:
 * 1. Node Registry, Menu Catalog & Factory Audit:
 *    - 7 Deep nodes: DeepToImage, DeepFromImage, DeepMerge, DeepHoldout, DeepCrop, DeepRead, DeepWrite
 *    - Catalog expansion from 54 to 61 nodes
 *    - 'Deep' category in NODE_MENU
 * 2. Multi-Node Deep Compositing Pipeline:
 *    Constant -> DeepFromImage -> DeepMerge -> DeepHoldout -> DeepCrop -> DeepToImage -> Grade
 * 3. Complete Project Serialization & Deserialization Round-Trip for Deep DAGs
 * 4. Bidirectional Foundry Nuke (.nk) ASCII Script Translation for Deep Nodes
 */

import { Graph } from '../src/core/Graph.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { DeepPixelBuffer } from '../src/core/deep/DeepPixelBuffer.js';
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
  console.log('🎯 RUNNING: tests/test_phase_5_integration.mjs (Workstream 5.5)');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test 1: Node Registry & Factory Audit
  // -------------------------------------------------------------
  console.log('▶ Test 1: Deep Node Registry & Factory Audit ...');
  {
    const expectedDeepNodes = [
      'DeepToImage',
      'DeepFromImage',
      'DeepMerge',
      'DeepHoldout',
      'DeepCrop',
      'DeepRead',
      'DeepWrite'
    ];

    for (const type of expectedDeepNodes) {
      assert(NODE_REGISTRY[type] !== undefined, `Node type '${type}' registered in NODE_REGISTRY`);
      const instance = createNode(type);
      assert(instance !== null && instance.type === type, `createNode('${type}') returns valid instance`);
    }

    const menuDeep = NODE_MENU.find(m => m.category === 'Deep');
    assert(menuDeep !== undefined, "'Deep' category exists in NODE_MENU");
    assert(menuDeep.items.length === 7, `'Deep' menu contains exactly 7 items (found ${menuDeep ? menuDeep.items.length : 0})`);

    const totalNodes = Object.keys(NODE_REGISTRY).length;
    assert(totalNodes === 61, `Total registered nodes in catalog is 61 (found ${totalNodes})`);
  }

  // -------------------------------------------------------------
  // Test 2: Full End-to-End Multi-Node Deep Production Pipeline
  // -------------------------------------------------------------
  console.log('\n▶ Test 2: Full End-to-End Multi-Node Deep Pipeline ...');
  {
    const graph = new Graph();

    // Plate 1: Red foreground at depth Z = 5.0
    const constRed = createNode('Constant', 'constRed');
    constRed.setKnobValue('format', '64x64');
    constRed.setKnobValue('colorR', 0.8);
    constRed.setKnobValue('colorG', 0.0);
    constRed.setKnobValue('colorB', 0.0);
    constRed.setKnobValue('colorA', 1.0);
    graph.addNode(constRed);

    const deepRed = createNode('DeepFromImage', 'deepRed');
    deepRed.setKnobValue('defaultDepth', 5.0);
    graph.addNode(deepRed);
    graph.connect(constRed.id, 'out', deepRed.id, 'in');

    // Plate 2: Blue background at depth Z = 12.0
    const constBlue = createNode('Constant', 'constBlue');
    constBlue.setKnobValue('format', '64x64');
    constBlue.setKnobValue('colorR', 0.0);
    constBlue.setKnobValue('colorG', 0.0);
    constBlue.setKnobValue('colorB', 0.9);
    constBlue.setKnobValue('colorA', 1.0);
    graph.addNode(constBlue);

    const deepBlue = createNode('DeepFromImage', 'deepBlue');
    deepBlue.setKnobValue('defaultDepth', 12.0);
    graph.addNode(deepBlue);
    graph.connect(constBlue.id, 'out', deepBlue.id, 'in');

    // Plate 3: Holdout occluder at depth Z = 2.0 (in front of both) with alpha 0.5
    const constHoldout = createNode('Constant', 'constHoldout');
    constHoldout.setKnobValue('format', '64x64');
    constHoldout.setKnobValue('colorR', 0.0);
    constHoldout.setKnobValue('colorG', 0.0);
    constHoldout.setKnobValue('colorB', 0.0);
    constHoldout.setKnobValue('colorA', 0.5);
    graph.addNode(constHoldout);

    const deepHoldoutSrc = createNode('DeepFromImage', 'deepHoldoutSrc');
    deepHoldoutSrc.setKnobValue('defaultDepth', 2.0);
    graph.addNode(deepHoldoutSrc);
    graph.connect(constHoldout.id, 'out', deepHoldoutSrc.id, 'in');

    // Merge: Interleave Blue (B) and Red (A)
    const deepMerge = createNode('DeepMerge', 'deepMerge');
    deepMerge.setKnobValue('dropHidden', false);
    graph.addNode(deepMerge);
    graph.connect(deepBlue.id, 'out', deepMerge.id, 'B');
    graph.connect(deepRed.id, 'out', deepMerge.id, 'A');

    // Holdout: Attenuate merged streams by 50% holdout occluder
    const deepHoldout = createNode('DeepHoldout', 'deepHoldout');
    graph.addNode(deepHoldout);
    graph.connect(deepMerge.id, 'out', deepHoldout.id, 'in');
    graph.connect(deepHoldoutSrc.id, 'out', deepHoldout.id, 'holdout');

    // Crop: Depth clip range [3.0, 8.0] -> Keeps Red (Z=5.0), drops Blue (Z=12.0)
    const deepCrop = createNode('DeepCrop', 'deepCrop');
    deepCrop.setKnobValue('useZNear', true);
    deepCrop.setKnobValue('zNear', 3.0);
    deepCrop.setKnobValue('useZFar', true);
    deepCrop.setKnobValue('zFar', 8.0);
    graph.addNode(deepCrop);
    graph.connect(deepHoldout.id, 'out', deepCrop.id, 'in');

    // Flatten to 2D
    const deepToImage = createNode('DeepToImage', 'deepToImage');
    deepToImage.setKnobValue('outputDepth', true);
    graph.addNode(deepToImage);
    graph.connect(deepCrop.id, 'out', deepToImage.id, 'in');

    // Post-flatten 2D Grade
    const grade = createNode('Grade', 'grade');
    grade.setKnobValue('gain', 2.0);
    graph.addNode(grade);
    graph.connect(deepToImage.id, 'out', grade.id, 'in');

    // Evaluate entire graph through DAG
    const finalBuffer = await graph.evaluate(grade.id);

    assert(finalBuffer instanceof PixelBuffer, 'Pipeline evaluation returns standard 2D PixelBuffer');
    assert(finalBuffer.width === 64 && finalBuffer.height === 64, 'Output matches expected 64x64 format');

    // Inspect center pixel:
    // Red sample originally 0.8 * 0.5 (attenuated by holdout) = 0.4.
    // Grade gain 2.0 -> 0.4 * 2.0 = 0.8.
    // Blue sample (Z=12.0) was culled by DeepCrop (zFar=8.0).
    const centerIdx = (32 * 64 + 32) * 4;
    const cr = finalBuffer.data[centerIdx];
    const cg = finalBuffer.data[centerIdx + 1];
    const cb = finalBuffer.data[centerIdx + 2];
    const ca = finalBuffer.data[centerIdx + 3];

    assert(Math.abs(cr - 0.8) < 1e-3, `Center pixel Red is 0.80 after holdout, crop and grade (actual: ${cr.toFixed(4)})`);
    assert(Math.abs(cg - 0.0) < 1e-4, `Center pixel Green is 0.00 (actual: ${cg.toFixed(4)})`);
    assert(Math.abs(cb - 0.0) < 1e-4, `Center pixel Blue is 0.00 (culled by DeepCrop) (actual: ${cb.toFixed(4)})`);
    assert(Math.abs(ca - 0.5) < 1e-3, `Center pixel Alpha is 0.50 after holdout (actual: ${ca.toFixed(4)})`);
  }

  // -------------------------------------------------------------
  // Test 3: Project JSON Serialization & Deserialization Round-Trip
  // -------------------------------------------------------------
  console.log('\n▶ Test 3: Deep Project Serialization Round-Trip ...');
  {
    const graph = new Graph();

    const read = createNode('DeepRead', 'dread1');
    read.setKnobValue('filePath', 'C:/assets/render.deep.exr');
    graph.addNode(read);

    const crop = createNode('DeepCrop', 'dcrop1');
    crop.setKnobValue('useZNear', true);
    crop.setKnobValue('zNear', 10.5);
    crop.setKnobValue('useZFar', true);
    crop.setKnobValue('zFar', 500.0);
    graph.addNode(crop);
    graph.connect(read.id, 'out', crop.id, 'in');

    const toImg = createNode('DeepToImage', 'dtoimg1');
    toImg.setKnobValue('primaryDepth', 'midpoint');
    toImg.setKnobValue('earlyTermination', false);
    graph.addNode(toImg);
    graph.connect(crop.id, 'out', toImg.id, 'in');

    const write = createNode('DeepWrite', 'dwrite1');
    write.setKnobValue('filePath', 'C:/output/cropped.deep.exr');
    graph.addNode(write);
    graph.connect(crop.id, 'out', write.id, 'in');

    // Serialize to JSON
    const serialized = graph.serialize();
    const jsonStr = JSON.stringify(serialized);

    // Reconstruct into fresh graph
    const freshGraph = new Graph();
    freshGraph.deserialize(JSON.parse(jsonStr), (type, id, x, y) => createNode(type, id, x, y));

    const reconRead = freshGraph.getNode('dread1');
    const reconCrop = freshGraph.getNode('dcrop1');
    const reconToImg = freshGraph.getNode('dtoimg1');
    const reconWrite = freshGraph.getNode('dwrite1');

    assert(reconRead && reconRead.type === 'DeepRead', 'DeepRead deserialized accurately');
    assert(reconRead.getKnobValue('filePath') === 'C:/assets/render.deep.exr', 'DeepRead filePath knob preserved');

    assert(reconCrop && reconCrop.type === 'DeepCrop', 'DeepCrop deserialized accurately');
    assert(reconCrop.getKnobValue('zNear') === 10.5, 'DeepCrop zNear knob preserved');
    assert(reconCrop.getKnobValue('zFar') === 500.0, 'DeepCrop zFar knob preserved');

    assert(reconToImg && reconToImg.type === 'DeepToImage', 'DeepToImage deserialized accurately');
    assert(reconToImg.getKnobValue('primaryDepth') === 'midpoint', 'DeepToImage primaryDepth knob preserved');
    assert(reconToImg.getKnobValue('earlyTermination') === false, 'DeepToImage earlyTermination knob preserved');

    assert(reconWrite && reconWrite.type === 'DeepWrite', 'DeepWrite deserialized accurately');
    assert(reconWrite.getKnobValue('filePath') === 'C:/output/cropped.deep.exr', 'DeepWrite filePath knob preserved');

    // Connections
    const cropInp = reconCrop.inputs.find(i => i.id === 'in');
    assert(cropInp && cropInp.connection && cropInp.connection.nodeId === 'dread1', 'DeepCrop input connection restored');

    const toImgInp = reconToImg.inputs.find(i => i.id === 'in');
    assert(toImgInp && toImgInp.connection && toImgInp.connection.nodeId === 'dcrop1', 'DeepToImage input connection restored');

    const writeInp = reconWrite.inputs.find(i => i.id === 'in');
    assert(writeInp && writeInp.connection && writeInp.connection.nodeId === 'dcrop1', 'DeepWrite input connection restored');
  }

  // -------------------------------------------------------------
  // Test 4: Foundry Nuke (.nk) Script Bidirectional Translation
  // -------------------------------------------------------------
  console.log('\n▶ Test 4: Nuke Script Bidirectional Round-Trip ...');
  {
    const graph = new Graph();

    const dRead = createNode('DeepRead', 'DeepRead1');
    dRead.setKnobValue('filePath', '/shots/fx_comp.deep.exr');
    graph.addNode(dRead);

    const dCrop = createNode('DeepCrop', 'DeepCrop1');
    dCrop.setKnobValue('zNear', 5.0);
    dCrop.setKnobValue('zFar', 100.0);
    graph.addNode(dCrop);
    graph.connect(dRead.id, 'out', dCrop.id, 'in');

    const dToImg = createNode('DeepToImage', 'DeepToImage1');
    graph.addNode(dToImg);
    graph.connect(dCrop.id, 'out', dToImg.id, 'in');

    // Export to Nuke script
    const nkScript = NukeScriptIO.exportToNuke(graph);

    assert(nkScript.includes('DeepRead {'), 'Nuke script exports DeepRead block');
    assert(nkScript.includes('DeepCrop {'), 'Nuke script exports DeepCrop block');
    assert(nkScript.includes('DeepToImage {'), 'Nuke script exports DeepToImage block');
    assert(nkScript.includes('file /shots/fx_comp.deep.exr'), 'Nuke script exports DeepRead file knob');
    assert(nkScript.includes('znear 5'), 'Nuke script exports DeepCrop znear knob');

    // Parse back into fresh graph
    const importedGraph = new Graph();
    NukeScriptIO.importFromNuke(
      nkScript,
      (type, id, x, y) => createNode(type, id, x, y),
      importedGraph
    );

    const impRead = importedGraph.getAllNodes().find(n => n.type === 'DeepRead');
    const impCrop = importedGraph.getAllNodes().find(n => n.type === 'DeepCrop');
    const impToImg = importedGraph.getAllNodes().find(n => n.type === 'DeepToImage');

    assert(impRead !== undefined, 'DeepRead imported correctly');
    assert(impCrop !== undefined, 'DeepCrop imported correctly');
    assert(impToImg !== undefined, 'DeepToImage imported correctly');

    assert(impRead.getKnobValue('filePath') === '/shots/fx_comp.deep.exr', 'DeepRead filePath restored');
    assert(impCrop.getKnobValue('zNear') === 5, 'DeepCrop zNear restored');

    const importedCropInp = impCrop.inputs.find(i => i.id === 'in');
    assert(importedCropInp && importedCropInp.connection, 'DeepCrop input connection restored from Nuke DAG stack');
  }

  console.log('\n================================================================');
  console.log(`✅ ALL PHASE 5 INTEGRATION TESTS PASSED (${passed}/${passed + failed})`);
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
