/**
 * OpenComp - Independent Project Serialization Compatibility Verifier
 * Verifies 16-pair CopyNode project save/reload and legacy 4-pair project backward compatibility.
 */

import { strict as assert } from 'assert';
import { CopyNode } from '../../../src/nodes/CopyNode.js';
import { Graph } from '../../../src/core/Graph.js';
import { PixelBuffer } from '../../../src/core/PixelBuffer.js';
import fs from 'fs';
import path from 'path';

console.log('----------------------------------------------------');
console.log('🧪 VERIFYING: CopyNode Serialization & Schema Compatibility');
console.log('----------------------------------------------------');

const results = {
  test_16_pair_save_reload: false,
  test_legacy_4_pair_load: false,
  pairs_16_checked: [],
  legacy_pairs_checked: []
};

// -------------------------------------------------------------
// Test 1: Save & Reload Graph with 16-Pair CopyNode
// -------------------------------------------------------------
const graph1 = new Graph();
const copy1 = new CopyNode('Copy_16Pair_Test', 150, 250);

const channelList16 = [
  'depth.Z', 'forward.u', 'forward.v', 'backward.u', 'backward.v',
  'diffuse.R', 'diffuse.G', 'diffuse.B', 'specular.R', 'specular.G', 'specular.B',
  'normal.X', 'normal.Y', 'normal.Z', 'crypto_material', 'crypto_object'
];

for (let i = 0; i < 16; i++) {
  copy1.setKnobValue(`from${i}`, channelList16[i]);
  copy1.setKnobValue(`to${i}`, `target_${channelList16[i]}`);
}
copy1.setKnobValue('mix', 0.65);
copy1.setKnobValue('bbox', 'union');
copy1.setKnobValue('maskChannel', 'luma');
copy1.setKnobValue('invertMask', true);

graph1.addNode(copy1);

// Save to JSON
const serializedProject = JSON.stringify(graph1.serialize(), null, 2);
const projectFilePath = path.resolve('tests/final_audit/channels/test_16pair_project.opencomp');
fs.writeFileSync(projectFilePath, serializedProject, 'utf8');

// Reload into fresh graph
const graph2 = new Graph();
const loadedData = JSON.parse(fs.readFileSync(projectFilePath, 'utf8'));

// Reconstruct using node factory
for (const nodeData of loadedData.nodes) {
  let node = null;
  if (nodeData.type === 'Copy') {
    node = new CopyNode(nodeData.id, nodeData.x, nodeData.y);
  }
  if (node) {
    node.deserialize(nodeData);
    graph2.addNode(node);
  }
}

const copy2 = graph2.getNode('Copy_16Pair_Test');
assert.ok(copy2, 'Reloaded graph must contain Copy_16Pair_Test node');
assert.equal(copy2.getKnobValue('mix'), 0.65);
assert.equal(copy2.getKnobValue('bbox'), 'union');
assert.equal(copy2.getKnobValue('maskChannel'), 'luma');
assert.equal(copy2.getKnobValue('invertMask'), true);
assert.equal(copy2.getActivePairs().length, 16);

for (let i = 0; i < 16; i++) {
  const f = copy2.getKnobValue(`from${i}`);
  const t = copy2.getKnobValue(`to${i}`);
  assert.equal(f, channelList16[i]);
  assert.equal(t, `target_${channelList16[i]}`);
  results.pairs_16_checked.push({ index: i, from: f, to: t, verified: true });
}
results.test_16_pair_save_reload = true;
console.log('  ✅ 16-pair CopyNode project successfully saved and reloaded with 100% fidelity');

// -------------------------------------------------------------
// Test 2: Load Legacy Phase 2 Four-Pair Project Payload
// -------------------------------------------------------------
const legacyProjectPayload = {
  version: '1.0.0',
  nodes: [
    {
      id: 'Copy_Legacy_Node',
      name: 'Copy_Legacy_Node',
      type: 'Copy',
      category: 'Channel',
      x: 100,
      y: 100,
      disabled: false,
      knobs: {
        from0: { value: 'rgba.alpha' },
        to0: { value: 'rgba.alpha' },
        from1: { value: 'depth.Z' },
        to1: { value: 'depth.Z' },
        from2: { value: 'forward.u' },
        to2: { value: 'forward.u' },
        from3: { value: 'specular.R' },
        to3: { value: 'specular.R' },
        mix: { value: 0.9 },
        bbox: { value: 'B' },
        maskChannel: { value: 'alpha' },
        invertMask: { value: false }
      },
      inputs: [
        { id: 'B', name: 'B', connection: null },
        { id: 'A', name: 'A', connection: null },
        { id: 'mask', name: 'mask', connection: null }
      ]
    }
  ]
};

const legacyCopy = new CopyNode(legacyProjectPayload.nodes[0].id, 100, 100);
legacyCopy.deserialize(legacyProjectPayload.nodes[0]);

assert.equal(legacyCopy.getKnobValue('from0'), 'rgba.alpha');
assert.equal(legacyCopy.getKnobValue('to0'), 'rgba.alpha');
assert.equal(legacyCopy.getKnobValue('from1'), 'depth.Z');
assert.equal(legacyCopy.getKnobValue('to1'), 'depth.Z');
assert.equal(legacyCopy.getKnobValue('from2'), 'forward.u');
assert.equal(legacyCopy.getKnobValue('to2'), 'forward.u');
assert.equal(legacyCopy.getKnobValue('from3'), 'specular.R');
assert.equal(legacyCopy.getKnobValue('to3'), 'specular.R');
assert.equal(legacyCopy.getKnobValue('mix'), 0.9);
assert.equal(legacyCopy.getActivePairs().length, 4);

results.legacy_pairs_checked = legacyCopy.getActivePairs();
results.test_legacy_4_pair_load = true;
console.log('  ✅ Legacy 4-pair Phase 2 project payload loaded bit-identically');

// Write audit output
const auditOutputPath = path.resolve('tests/final_audit/channels/serialization_audit_results.json');
fs.writeFileSync(auditOutputPath, JSON.stringify(results, null, 2), 'utf8');

console.log('====================================================');
console.log('🎉 Serialization audit passed! Output written to:');
console.log(auditOutputPath);
console.log('====================================================');

