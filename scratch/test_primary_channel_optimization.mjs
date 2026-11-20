import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { PixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));
const { MergeNode } = await import('file:///' + path.join(workspace, 'src/nodes/MergeNode.js').replace(/\\/g, '/'));
const { Graph } = await import('file:///' + path.join(workspace, 'src/core/Graph.js').replace(/\\/g, '/'));
const { createNode } = await import('file:///' + path.join(workspace, 'src/core/NodeRegistry.js').replace(/\\/g, '/'));

console.log('Testing Primary Channel Optimization on PixelBuffer...');

// Check ImageIO.readEXR with and without primary channel exclusion
const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const buf = ImageIO.readEXR(fs.readFileSync(bgPath));
console.log('Current extraChannels keys:', Array.from(buf.extraChannels.keys()));

// If we delete primary channels from extraChannels:
buf.extraChannels.delete('R');
buf.extraChannels.delete('G');
buf.extraChannels.delete('B');
buf.extraChannels.delete('A');

console.log('After pruning primary keys:', Array.from(buf.extraChannels.keys()));

const t0 = performance.now();
for (let i = 0; i < 10; i++) {
  buf.clone();
}
const dtPruned = (performance.now() - t0) / 10;
console.log(`Pruned buf.clone() time: ${dtPruned.toFixed(2)} ms (was ~72.5 ms)`);

