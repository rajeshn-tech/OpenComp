import fs from 'fs';
import path from 'path';
import { strict as assert } from 'node:assert';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { Graph } = await import('file:///' + path.join(workspace, 'src/core/Graph.js').replace(/\\/g, '/'));
const { createNode } = await import('file:///' + path.join(workspace, 'src/core/NodeRegistry.js').replace(/\\/g, '/'));
const { PixelBuffer, TiledPixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));

const W = 1024, H = 1024;
const tileSize = 256;

const contigPlate = new PixelBuffer(W, H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = (y * W + x) * 4;
    contigPlate.data[idx] = (x / W);
    contigPlate.data[idx + 1] = (y / H);
    contigPlate.data[idx + 2] = 0.5;
    contigPlate.data[idx + 3] = 1.0;
  }
}
const tiledPlate = TiledPixelBuffer.fromContiguous(contigPlate, tileSize);

// Contiguous DAG
const gContig = new Graph();
const cRead = createNode('Read', 'Plate'); cRead.setUploadedImage(contigPlate);
const cDepth = createNode('Depth', 'Depth1'); cDepth.setKnobValue('gradientType', 'ground_plane');
const cZDefocus = createNode('ZDefocus', 'ZDefocus1');
cZDefocus.setKnobValue('focusPlane', 0.2);
cZDefocus.setKnobValue('maxDefocus', 10.0);
const cWrite = createNode('Write', 'Write1');

gContig.addNode(cRead); gContig.addNode(cDepth); gContig.addNode(cZDefocus); gContig.addNode(cWrite);
gContig.connect('Plate', 'out', 'Depth1', 'in');
gContig.connect('Plate', 'out', 'ZDefocus1', 'in');
gContig.connect('Depth1', 'out', 'ZDefocus1', 'depth');
gContig.connect('ZDefocus1', 'out', 'Write1', 'in');

const resContig = gContig.evaluate('Write1');

// Tiled DAG
const gTiled = new Graph();
const tRead = createNode('Read', 'Plate'); tRead.setUploadedImage(tiledPlate);
const tDepth = createNode('Depth', 'Depth1'); tDepth.setKnobValue('gradientType', 'ground_plane');
const tZDefocus = createNode('ZDefocus', 'ZDefocus1');
tZDefocus.setKnobValue('focusPlane', 0.2);
tZDefocus.setKnobValue('maxDefocus', 10.0);
const tWrite = createNode('Write', 'Write1');

gTiled.addNode(tRead); gTiled.addNode(tDepth); gTiled.addNode(tZDefocus); gTiled.addNode(tWrite);
gTiled.connect('Plate', 'out', 'Depth1', 'in');
gTiled.connect('Plate', 'out', 'ZDefocus1', 'in');
gTiled.connect('Depth1', 'out', 'ZDefocus1', 'depth');
gTiled.connect('ZDefocus1', 'out', 'Write1', 'in');

const resTiled = gTiled.evaluate('Write1');
const resTiledFlat = resTiled.toContiguousBuffer();

let maxDiff = 0;
let diffIdx = -1;
for (let i = 0; i < resContig.data.length; i++) {
  const d = Math.abs(resContig.data[i] - resTiledFlat.data[i]);
  if (d > maxDiff) {
    maxDiff = d;
    diffIdx = i;
  }
}

const pIdx = Math.floor(diffIdx / 4);
const py = Math.floor(pIdx / W);
const px = pIdx % W;
console.log(`Max Diff: ${maxDiff} at pixel (${px}, ${py}), channel ${diffIdx % 4}`);
console.log(`Contig val: ${resContig.data[diffIdx]} | Tiled val: ${resTiledFlat.data[diffIdx]}`);

