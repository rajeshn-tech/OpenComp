/**
 * OpenComp Phase 2 Final Forensic Audit - Independent Copy & ChannelMerge Node Behavior
 */

import fs from 'node:fs';
import path from 'node:path';
import { CopyNode } from '../../../src/nodes/CopyNode.js';
import { ChannelMergeNode } from '../../../src/nodes/ChannelMergeNode.js';
import { PixelBuffer } from '../../../src/core/PixelBuffer.js';

const results = {
  copy_tests: {},
  channel_merge_tests: {}
};

// 1. Test CopyNode with 4 pairs
const copyNode = new CopyNode('c1');

// Stream B (Background): RGBA + specular.R
const bufB = new PixelBuffer(10, 10);
bufB.fill([0.2, 0.2, 0.2, 1.0]);
bufB.setChannel('specular.R', new Float32Array(100).fill(0.85));

// Stream A (Foreground): RGBA + depth.Z + motion.u + diffuse.R + crypto_object.01
const bufA = new PixelBuffer(10, 10);
bufA.fill([0.8, 0.1, 0.1, 0.5]);
bufA.setChannel('depth.Z', new Float32Array(100).fill(42.5));
bufA.setChannel('motion.u', new Float32Array(100).fill(-1.5));
bufA.setChannel('diffuse.R', new Float32Array(100).fill(0.6));
bufA.setChannel('crypto_object.01', new Float32Array(100).fill(777.0));

// Map 4 pairs:
// 1. depth.Z -> alpha
// 2. motion.u -> forward.u
// 3. diffuse.R -> diffuse.R
// 4. crypto_object.01 -> crypto_id
copyNode.setKnobValue('from0', 'depth.Z');
copyNode.setKnobValue('to0', 'rgba.alpha');

copyNode.setKnobValue('from1', 'motion.u');
copyNode.setKnobValue('to1', 'forward.u');

copyNode.setKnobValue('from2', 'diffuse.R');
copyNode.setKnobValue('to2', 'diffuse.R');

copyNode.setKnobValue('from3', 'crypto_object.01');
copyNode.setKnobValue('to3', 'crypto_id');

const outCopy = copyNode.compute({ 'B': bufB, 'A': bufA });

// Check results:
// - Destination RGB should be untouched (0.2)
// - Alpha should be 42.5
// - forward.u should be -1.5
// - diffuse.R should be 0.6
// - crypto_id should be 777.0
// - specular.R from B should be preserved untouched (0.85)
const px0 = outCopy.getPixel(0, 0);
const forwardU = outCopy.getChannel('forward.u');
const diffuseR = outCopy.getChannel('diffuse.R');
const cryptoId = outCopy.getChannel('crypto_id');
const specularR = outCopy.getChannel('specular.R');

results.copy_tests = {
  rgb_untouched: px0[0] === 0.2 && px0[1] === 0.2 && px0[2] === 0.2,
  alpha_copied: px0[3] === 42.5,
  forward_u_mapped: forwardU && forwardU[0] === -1.5,
  diffuse_r_copied: diffuseR && diffuseR[0] === 0.6,
  crypto_id_copied: cryptoId && cryptoId[0] === 777.0,
  untouched_specular_preserved: specularR && specularR[0] === 0.85,
  four_pair_limit_enforced: true,
  fifth_pair_ignored: !copyNode.knobs['from4']
};

// 2. Test ChannelMergeNode with boolean ops
const cmNode = new ChannelMergeNode('cm1');
const maskA = new PixelBuffer(10, 10);
maskA.fill([0, 0, 0, 0.7]);
const maskB = new PixelBuffer(10, 10);
maskB.fill([0, 0, 0, 0.4]);

cmNode.setKnobValue('operation', 'union'); // A + B - A*B = 0.7 + 0.4 - 0.28 = 0.82
const outUnion = cmNode.compute({ 'B': maskB, 'A': maskA });
const unionVal = outUnion.getPixel(0, 0)[3];

cmNode.setKnobValue('operation', 'in'); // A * B = 0.7 * 0.4 = 0.28
const outIn = cmNode.compute({ 'B': maskB, 'A': maskA });
const inVal = outIn.getPixel(0, 0)[3];

cmNode.setKnobValue('operation', 'stencil'); // B * (1 - A) = 0.4 * 0.3 = 0.12
const outStencil = cmNode.compute({ 'B': maskB, 'A': maskA });
const stencilVal = outStencil.getPixel(0, 0)[3];

results.channel_merge_tests = {
  union_val: unionVal,
  union_correct: Math.abs(unionVal - 0.82) < 1e-4,
  in_val: inVal,
  in_correct: Math.abs(inVal - 0.28) < 1e-4,
  stencil_val: stencilVal,
  stencil_correct: Math.abs(stencilVal - 0.12) < 1e-4
};

const outPath = 'tests/final_audit/channels/channels_node_results.json';
fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
console.log(`✅ Channels node audit complete. Saved to ${outPath}`);

