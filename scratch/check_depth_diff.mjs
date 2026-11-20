import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { Graph } = await import('file:///' + path.join(workspace, 'src/core/Graph.js').replace(/\\/g, '/'));
const { createNode } = await import('file:///' + path.join(workspace, 'src/core/NodeRegistry.js').replace(/\\/g, '/'));
const { PixelBuffer, TiledPixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));

const W = 1024, H = 1024;
const tileSize = 256;

const contigPlate = new PixelBuffer(W, H);
const tiledPlate = TiledPixelBuffer.fromContiguous(contigPlate, tileSize);

const gContig = new Graph();
const cRead = createNode('Read', 'Plate'); cRead.setUploadedImage(contigPlate);
const cDepth = createNode('Depth', 'Depth1'); cDepth.setKnobValue('gradientType', 'ground_plane');
gContig.addNode(cRead); gContig.addNode(cDepth);
gContig.connect('Plate', 'out', 'Depth1', 'in');
const dContig = gContig.evaluate('Depth1');

const gTiled = new Graph();
const tRead = createNode('Read', 'Plate'); tRead.setUploadedImage(tiledPlate);
const tDepth = createNode('Depth', 'Depth1'); tDepth.setKnobValue('gradientType', 'ground_plane');
gTiled.addNode(tRead); gTiled.addNode(tDepth);
gTiled.connect('Plate', 'out', 'Depth1', 'in');
const dTiled = gTiled.evaluate('Depth1');
const dTiledFlat = dTiled.toContiguousBuffer();

console.log('Depth comparison:');
let depthDiff = 0;
for (let i = 0; i < dContig.data.length; i++) {
  const d = Math.abs(dContig.data[i] - dTiledFlat.data[i]);
  if (d > depthDiff) depthDiff = d;
}
console.log(`Depth max diff: ${depthDiff}`);

// Check pixel (4, 512)
const idx = (512 * W + 4) * 4;
console.log(`Pixel (4, 512) depth: Contig = ${dContig.data[idx]}, Tiled = ${dTiledFlat.data[idx]}`);

