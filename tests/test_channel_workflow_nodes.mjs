/**
 * OpenComp - Workstream 2.3 Channel & Data Workflow Nodes Test Suite
 * Tests CopyNode, ChannelMergeNode, AOV injection, Nuke .nk round-trip,
 * mix blending, mask gating, and dynamic bounding box integration.
 */

import assert from 'node:assert/strict';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { BBox } from '../src/core/BBox.js';
import { Graph } from '../src/core/Graph.js';
import { CopyNode } from '../src/nodes/CopyNode.js';
import { ChannelMergeNode } from '../src/nodes/ChannelMergeNode.js';
import { ConstantNode } from '../src/nodes/ConstantNode.js';
import { GradeNode } from '../src/nodes/GradeNode.js';
import { NukeScriptIO } from '../src/core/NukeScriptIO.js';
import { createNode, NODE_REGISTRY } from '../src/nodes/index.js';

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_channel_workflow_nodes.mjs');
console.log('----------------------------------------------------');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
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

// -------------------------------------------------------------
// 1. Registry & Catalog Completeness
// -------------------------------------------------------------
runTest('Registry: Copy & ChannelMerge Nodes Registered in Catalog', () => {
  assert.ok(NODE_REGISTRY['Copy'], 'Copy node must be in NODE_REGISTRY');
  assert.ok(NODE_REGISTRY['ChannelMerge'], 'ChannelMerge node must be in NODE_REGISTRY');

  const copy = createNode('Copy', 'Copy1');
  assert.equal(copy.type, 'Copy');
  assert.equal(copy.category, 'Channel');

  const cmerge = createNode('ChannelMerge', 'CMerge1');
  assert.equal(cmerge.type, 'ChannelMerge');
  assert.equal(cmerge.category, 'Channel');
});

// -------------------------------------------------------------
// 2. CopyNode: Basic Alpha Channel Copy
// -------------------------------------------------------------
runTest('CopyNode: Copy Alpha from A to B Stream', () => {
  const bufB = new PixelBuffer(100, 100);
  bufB.fill(0.8, 0.4, 0.2, 0.0); // Transparent background

  const bufA = new PixelBuffer(100, 100);
  bufA.fill(0.0, 0.0, 0.0, 0.75); // Foreground with 0.75 alpha

  const copy = new CopyNode('Copy1');
  copy.setKnobValue('from0', 'rgba.alpha');
  copy.setKnobValue('to0', 'rgba.alpha');

  const out = copy.compute({ B: bufB, A: bufA });

  // RGB preserved from B
  const px = out.getPixel(50, 50);
  assert(Math.abs(px[0] - 0.8) < 1e-4);
  assert(Math.abs(px[1] - 0.4) < 1e-4);
  assert(Math.abs(px[2] - 0.2) < 1e-4);
  // Alpha copied from A
  assert(Math.abs(px[3] - 0.75) < 1e-4);
});

// -------------------------------------------------------------
// 3. CopyNode: Channel Remapping (Red to Alpha)
// -------------------------------------------------------------
runTest('CopyNode: Channel Remapping (Red channel from A into Alpha in B)', () => {
  const bufB = new PixelBuffer(50, 50);
  bufB.fill(0.1, 0.2, 0.3, 1.0);

  const bufA = new PixelBuffer(50, 50);
  bufA.fill(0.42, 0.99, 0.88, 0.0);

  const copy = new CopyNode('Copy1');
  copy.setKnobValue('from0', 'rgba.red');
  copy.setKnobValue('to0', 'rgba.alpha');

  const out = copy.compute({ B: bufB, A: bufA });
  const px = out.getPixel(25, 25);
  assert(Math.abs(px[3] - 0.42) < 1e-4);
});

// -------------------------------------------------------------
// 4. CopyNode: Arbitrary AOV Channel Injection (depth.Z)
// -------------------------------------------------------------
runTest('CopyNode: Arbitrary AOV Channel Injection (e.g. depth.Z)', () => {
  const bufB = new PixelBuffer(80, 80);
  bufB.fill(0.5, 0.5, 0.5, 1.0);

  const bufA = new PixelBuffer(80, 80);
  const zData = new Float32Array(80 * 80).fill(150.5);
  bufA.setChannel('depth.Z', zData);

  const copy = new CopyNode('Copy1');
  copy.setKnobValue('from0', 'depth.Z');
  copy.setKnobValue('to0', 'depth.Z');

  const out = copy.compute({ B: bufB, A: bufA });
  assert.ok(out.hasChannel('depth.Z'), 'Output buffer must contain injected depth.Z AOV');
  const outZ = out.getChannel('depth.Z');
  assert.equal(outZ[0], 150.5);
  assert.equal(outZ[80 * 40 + 40], 150.5);
});

// -------------------------------------------------------------
// 5. CopyNode: Mix Blending & Mask Modulation
// -------------------------------------------------------------
runTest('CopyNode: 50% Mix Blending with Mask Gating', () => {
  const bufB = new PixelBuffer(60, 60);
  bufB.fill(1.0, 1.0, 1.0, 0.2); // Initial alpha 0.2

  const bufA = new PixelBuffer(60, 60);
  bufA.fill(0.0, 0.0, 0.0, 0.8); // Source alpha 0.8

  const copy = new CopyNode('Copy1');
  copy.setKnobValue('from0', 'rgba.alpha');
  copy.setKnobValue('to0', 'rgba.alpha');
  copy.setKnobValue('mix', 0.5); // 50% mix: 0.2 * 0.5 + 0.8 * 0.5 = 0.5

  const out = copy.compute({ B: bufB, A: bufA });
  const px = out.getPixel(30, 30);
  assert(Math.abs(px[3] - 0.5) < 1e-4, `Expected alpha 0.5, got ${px[3]}`);

  // Mask gating test: half mask (left 0.0, right 1.0)
  const mask = new PixelBuffer(60, 60);
  for (let y = 0; y < 60; y++) {
    for (let x = 0; x < 60; x++) {
      mask.setPixel(x, y, 0, 0, 0, x < 30 ? 0.0 : 1.0);
    }
  }

  copy.setKnobValue('mix', 1.0);
  const outMasked = copy.compute({ B: bufB, A: bufA, mask });
  // Left half untouched (0.2)
  assert(Math.abs(outMasked.getPixel(10, 30)[3] - 0.2) < 1e-4);
  // Right half copied (0.8)
  assert(Math.abs(outMasked.getPixel(45, 30)[3] - 0.8) < 1e-4);
});

// -------------------------------------------------------------
// 6. ChannelMergeNode: Boolean Union & Intersection Operations
// -------------------------------------------------------------
runTest('ChannelMergeNode: Union (A + B - A*B) & Intersection (A*B)', () => {
  const bufB = new PixelBuffer(50, 50);
  bufB.fill(0, 0, 0, 0.4);

  const bufA = new PixelBuffer(50, 50);
  bufA.fill(0, 0, 0, 0.6);

  const cm = new ChannelMergeNode('CMerge1');
  cm.setKnobValue('A', 'rgba.alpha');
  cm.setKnobValue('B', 'rgba.alpha');
  cm.setKnobValue('output', 'rgba.alpha');

  // 1. Union: 0.6 + 0.4 - (0.6 * 0.4) = 1.0 - 0.24 = 0.76
  cm.setKnobValue('operation', 'union');
  const outUnion = cm.compute({ B: bufB, A: bufA });
  const pxU = outUnion.getPixel(25, 25);
  assert(Math.abs(pxU[3] - 0.76) < 1e-4, `Union: Expected 0.76, got ${pxU[3]}`);

  // 2. Intersection: 0.6 * 0.4 = 0.24
  cm.setKnobValue('operation', 'intersection');
  const outInter = cm.compute({ B: bufB, A: bufA });
  const pxI = outInter.getPixel(25, 25);
  assert(Math.abs(pxI[3] - 0.24) < 1e-4, `Intersection: Expected 0.24, got ${pxI[3]}`);

  // 3. Stencil: B * (1 - A) = 0.4 * (1 - 0.6) = 0.16
  cm.setKnobValue('operation', 'stencil');
  const outStencil = cm.compute({ B: bufB, A: bufA });
  const pxS = outStencil.getPixel(25, 25);
  assert(Math.abs(pxS[3] - 0.16) < 1e-4, `Stencil: Expected 0.16, got ${pxS[3]}`);
});

// -------------------------------------------------------------
// 7. ChannelMergeNode: Mathematical Operations (absminus, plus, min, max)
// -------------------------------------------------------------
runTest('ChannelMergeNode: Math Operations (absminus, plus, min, max)', () => {
  const bufB = new PixelBuffer(40, 40);
  bufB.fill(0, 0, 0, 0.3);

  const bufA = new PixelBuffer(40, 40);
  bufA.fill(0, 0, 0, 0.7);

  const cm = new ChannelMergeNode('CMerge1');
  cm.setKnobValue('A', 'rgba.alpha');
  cm.setKnobValue('B', 'rgba.alpha');
  cm.setKnobValue('output', 'rgba.alpha');

  // absminus: |0.7 - 0.3| = 0.4
  cm.setKnobValue('operation', 'absminus');
  assert(Math.abs(cm.compute({ B: bufB, A: bufA }).getPixel(20, 20)[3] - 0.4) < 1e-4);

  // plus: 0.7 + 0.3 = 1.0
  cm.setKnobValue('operation', 'plus');
  assert(Math.abs(cm.compute({ B: bufB, A: bufA }).getPixel(20, 20)[3] - 1.0) < 1e-4);

  // min: min(0.7, 0.3) = 0.3
  cm.setKnobValue('operation', 'min');
  assert(Math.abs(cm.compute({ B: bufB, A: bufA }).getPixel(20, 20)[3] - 0.3) < 1e-4);

  // max: max(0.7, 0.3) = 0.7
  cm.setKnobValue('operation', 'max');
  assert(Math.abs(cm.compute({ B: bufB, A: bufA }).getPixel(20, 20)[3] - 0.7) < 1e-4);
});

// -------------------------------------------------------------
// 8. Dynamic BBox Propagation in Copy and ChannelMerge
// -------------------------------------------------------------
runTest('BBox Integration: Copy & ChannelMerge Dynamic BBox Propagation', () => {
  const bufB = new PixelBuffer(1920, 1080);
  bufB.bbox = new BBox(0, 0, 800, 600);

  const bufA = new PixelBuffer(1920, 1080);
  bufA.bbox = new BBox(400, 300, 1200, 900);

  // Copy with bbox = 'B'
  const copy = new CopyNode('Copy1');
  copy.setKnobValue('bbox', 'B');
  assert.ok(copy.getBBox({ B: bufB, A: bufA }).equals(bufB.bbox));

  // Copy with bbox = 'union'
  copy.setKnobValue('bbox', 'union');
  const uBox = copy.getBBox({ B: bufB, A: bufA });
  assert.equal(uBox.x, 0);
  assert.equal(uBox.y, 0);
  assert.equal(uBox.r, 1200);
  assert.equal(uBox.t, 900);

  // ChannelMerge with bbox = 'intersection'
  const cm = new ChannelMergeNode('CMerge1');
  cm.setKnobValue('bbox', 'intersection');
  const iBox = cm.getBBox({ B: bufB, A: bufA });
  assert.equal(iBox.x, 400);
  assert.equal(iBox.y, 300);
  assert.equal(iBox.r, 800);
  assert.equal(iBox.t, 600);
});

// -------------------------------------------------------------
// 9. Nuke (.nk) Script Round-Trip Compatibility
// -------------------------------------------------------------
runTest('Nuke Script IO: Export and Import of Copy and ChannelMerge with Stack Connections', () => {
  const graph = new Graph();
  const c1 = createNode('Constant', 'C1');
  const c2 = createNode('Constant', 'C2');
  const copy = createNode('Copy', 'Copy1');
  copy.setKnobValue('from0', 'rgba.red');
  copy.setKnobValue('to0', 'rgba.alpha');

  const cmerge = createNode('ChannelMerge', 'CMerge1');
  cmerge.setKnobValue('operation', 'union');

  graph.addNode(c1);
  graph.addNode(c2);
  graph.addNode(copy);
  graph.addNode(cmerge);

  // Connect C1 -> B, C2 -> A
  graph.connect('C1', 'out', 'Copy1', 'B');
  graph.connect('C2', 'out', 'Copy1', 'A');
  // Connect Copy1 -> B, C2 -> A
  graph.connect('Copy1', 'out', 'CMerge1', 'B');
  graph.connect('C2', 'out', 'CMerge1', 'A');

  // Export to Nuke script
  const scriptText = NukeScriptIO.exportToNukeScript(graph);
  assert.ok(scriptText.includes('Copy {\n'), 'Exported script must contain "Copy {"');
  assert.ok(scriptText.includes('ChannelMerge {\n'), 'Exported script must contain "ChannelMerge {"');
  assert.ok(scriptText.includes('from0 rgba.red'), 'Exported script must contain knob from0');
  assert.ok(scriptText.includes('operation union'), 'Exported script must contain operation union');

  // Import into a fresh Graph
  const targetGraph = new Graph();
  NukeScriptIO.parseNukeScript(scriptText, (type, id, x, y) => createNode(type, id, x, y), targetGraph);

  const importedCopy = targetGraph.getNode('Copy1');
  assert.ok(importedCopy, 'Target graph must contain imported Copy1');
  assert.equal(importedCopy.getKnobValue('from0'), 'rgba.red');

  const importedCMerge = targetGraph.getNode('CMerge1');
  assert.ok(importedCMerge, 'Target graph must contain imported CMerge1');
  assert.equal(importedCMerge.getKnobValue('operation'), 'union');

  // Verify stack-reconstructed connections
  const copyInputB = importedCopy.inputs.find(i => i.id === 'B');
  assert.ok(copyInputB && copyInputB.connection && copyInputB.connection.nodeId === 'C1', 'Copy1 B input must connect to C1');
  const copyInputA = importedCopy.inputs.find(i => i.id === 'A');
  assert.ok(copyInputA && copyInputA.connection && copyInputA.connection.nodeId === 'C2', 'Copy1 A input must connect to C2');

  const cmInputB = importedCMerge.inputs.find(i => i.id === 'B');
  assert.ok(cmInputB && cmInputB.connection && cmInputB.connection.nodeId === 'Copy1', 'CMerge1 B input must connect to Copy1');
});

// -------------------------------------------------------------
// 10. Scalable CopyNode: 8-Pair Concurrent Channel Mapping & Preservation
// -------------------------------------------------------------
runTest('Scalable CopyNode: 8-Pair Concurrent Channel Mapping & Untouched Channel Preservation', () => {
  const w = 40;
  const h = 40;
  const len = w * h;

  const bufB = new PixelBuffer(w, h);
  bufB.fill(0.2, 0.4, 0.6, 1.0);
  bufB.setChannel('ambient.R', new Float32Array(len).fill(99.5));

  const bufA = new PixelBuffer(w, h);
  const channels8 = [
    'depth.Z', 'forward.u', 'forward.v', 'diffuse.R',
    'diffuse.G', 'diffuse.B', 'specular.R', 'crypto_object.01'
  ];

  for (let c = 0; c < 8; c++) {
    bufA.setChannel(channels8[c], new Float32Array(len).fill((c + 1) * 10.0));
  }

  const copy = new CopyNode('Copy_Scalable_8');
  for (let c = 0; c < 8; c++) {
    copy.setKnobValue(`from${c}`, channels8[c]);
    copy.setKnobValue(`to${c}`, channels8[c]);
  }

  assert.equal(copy.getActivePairs().length, 8);
  const out = copy.compute({ B: bufB, A: bufA });

  // Verify all 8 channels exist with exact data
  for (let c = 0; c < 8; c++) {
    const ch = channels8[c];
    assert.ok(out.hasChannel(ch), `Missing copied channel ${ch}`);
    const data = out.getChannel(ch);
    assert.equal(data[0], (c + 1) * 10.0);
    assert.equal(data[len - 1], (c + 1) * 10.0);
  }

  // Verify untouched ambient.R preserved bit-identically
  assert.ok(out.hasChannel('ambient.R'));
  assert.equal(out.getChannel('ambient.R')[0], 99.5);

  // Verify original RGBA preserved
  const px = out.getPixel(20, 20);
  assert(Math.abs(px[0] - 0.2) < 1e-4);
  assert(Math.abs(px[1] - 0.4) < 1e-4);
  assert(Math.abs(px[2] - 0.6) < 1e-4);
  assert(Math.abs(px[3] - 1.0) < 1e-4);
});

// -------------------------------------------------------------
// 11. Scalable CopyNode: 16-Pair Concurrent Channel Mapping
// -------------------------------------------------------------
runTest('Scalable CopyNode: 16-Pair Concurrent Channel Mapping & Memory Stability', () => {
  const w = 32;
  const h = 32;
  const len = w * h;

  const bufB = new PixelBuffer(w, h);
  bufB.fill(0, 0, 0, 1);

  const bufA = new PixelBuffer(w, h);
  const channels16 = [
    'depth.Z', 'forward.u', 'forward.v', 'backward.u', 'backward.v',
    'diffuse.R', 'diffuse.G', 'diffuse.B', 'specular.R', 'specular.G', 'specular.B',
    'normal.X', 'normal.Y', 'normal.Z', 'crypto_material', 'crypto_object'
  ];

  for (let c = 0; c < 16; c++) {
    bufA.setChannel(channels16[c], new Float32Array(len).fill(c * 5.0 + 1.0));
  }

  const copy = new CopyNode('Copy_Scalable_16');
  for (let c = 0; c < 16; c++) {
    copy.setKnobValue(`from${c}`, channels16[c]);
    copy.setKnobValue(`to${c}`, channels16[c]);
  }

  assert.equal(copy.getActivePairs().length, 16);
  assert.equal(copy.getChannelPairCount(), 16);

  const out = copy.compute({ B: bufB, A: bufA });
  for (let c = 0; c < 16; c++) {
    const ch = channels16[c];
    assert.ok(out.hasChannel(ch));
    assert.equal(out.getChannel(ch)[0], c * 5.0 + 1.0);
  }
});

// -------------------------------------------------------------
// 12. Scalable CopyNode: Dynamic Channel Pair API (add, remove, clear, setPairs)
// -------------------------------------------------------------
runTest('Scalable CopyNode: Dynamic Channel Pair API (add, remove, clear, setPairs)', () => {
  const copy = new CopyNode('Copy_API');
  assert.equal(copy.getChannelPairCount(), 4);

  const idx1 = copy.addChannelPair('depth.Z', 'depth.Z');
  assert.equal(idx1, 1);

  copy.addChannelPair('u', 'u');
  copy.addChannelPair('v', 'v');
  const idx4 = copy.addChannelPair('n.x', 'n.x');
  assert.equal(idx4, 4);

  assert.equal(copy.getChannelPairCount(), 5);
  copy.removeChannelPair(4);
  assert.equal(copy.getChannelPairCount(), 4);

  copy.setChannelPairs([
    { from: 'ch1', to: 'ch1' },
    { from: 'ch2', to: 'ch2' },
    { from: 'ch3', to: 'ch3' },
    { from: 'ch4', to: 'ch4' },
    { from: 'ch5', to: 'ch5' },
    { from: 'ch6', to: 'ch6' },
    { from: 'ch7', to: 'ch7' },
    { from: 'ch8', to: 'ch8' }
  ]);
  assert.equal(copy.getActivePairs().length, 8);
  assert.equal(copy.getKnobValue('from7'), 'ch8');
});

// -------------------------------------------------------------
// 13. Scalable CopyNode: Project Serialization & Deserialization
// -------------------------------------------------------------
runTest('Scalable CopyNode: Full Project JSON Serialization & Deserialization', () => {
  const copy1 = new CopyNode('Copy_Serialize');
  for (let i = 0; i < 10; i++) {
    copy1.setKnobValue(`from${i}`, `layer_${i}.R`);
    copy1.setKnobValue(`to${i}`, `target_${i}.R`);
  }
  copy1.setKnobValue('mix', 0.75);

  const serialized = copy1.serialize();
  const copy2 = new CopyNode('Copy_Deserialized');
  copy2.deserialize(serialized);

  assert.equal(copy2.getKnobValue('mix'), 0.75);
  assert.equal(copy2.getActivePairs().length, 10);
  for (let i = 0; i < 10; i++) {
    assert.equal(copy2.getKnobValue(`from${i}`), `layer_${i}.R`);
    assert.equal(copy2.getKnobValue(`to${i}`), `target_${i}.R`);
  }
});

console.log('\n====================================================');
console.log(`🎉 test_channel_workflow_nodes.mjs PASSED: All ${passedTests}/${totalTests} tests succeeded!`);
console.log('====================================================\n');
