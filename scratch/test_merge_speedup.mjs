import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { MergeNode } = await import('file:///' + path.join(workspace, 'src/nodes/MergeNode.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const charPath = path.join(workspace, 'demo/vfx_showcase/source/character_plate.0001.exr');

const bufB = ImageIO.readEXR(fs.readFileSync(bgPath));
const bufA = ImageIO.readEXR(fs.readFileSync(charPath));

// With original redundant channels:
const merge = new MergeNode('merge');
merge.setKnobValue('operation', 'over');
merge.compute({ B: bufB, A: bufA });

const t0 = performance.now();
for (let i = 0; i < 5; i++) merge.compute({ B: bufB, A: bufA });
const dtOrig = (performance.now() - t0) / 5;

// Pruning primary channels:
for (const k of ['R', 'G', 'B', 'A']) {
  bufB.extraChannels.delete(k);
  bufA.extraChannels.delete(k);
}
const t1 = performance.now();
for (let i = 0; i < 5; i++) merge.compute({ B: bufB, A: bufA });
const dtPruned = (performance.now() - t1) / 5;

console.log(`MergeNode with redundant primary channels: ${dtOrig.toFixed(2)} ms`);
console.log(`MergeNode with pruned primary channels:    ${dtPruned.toFixed(2)} ms`);
console.log(`Speedup: ${(dtOrig / dtPruned).toFixed(2)}x`);

