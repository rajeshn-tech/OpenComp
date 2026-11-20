import { createNode } from '../src/core/NodeRegistry.js';
import { PixelBuffer, TiledPixelBuffer } from '../src/core/PixelBuffer.js';

const W = 1024, H = 1024;
const contigPlate = new PixelBuffer(W, H);
const tiledPlate = TiledPixelBuffer.fromContiguous(contigPlate, 256);

const cDepth = createNode('Depth', 'Depth1');
cDepth.setKnobValue('gradientType', 'ground_plane');
const cDepthOut = cDepth.compute({ in: contigPlate });

const tDepth = createNode('Depth', 'Depth1');
tDepth.setKnobValue('gradientType', 'ground_plane');
const tDepthOut = tDepth.compute({ in: tiledPlate });

console.log('cDepthOut isTiled:', cDepthOut.isTiled);
console.log('tDepthOut isTiled:', tDepthOut.isTiled);

let maxDepthDiff = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const tp = tDepthOut.getPixel(x, y);
    const cp = cDepthOut.getPixel(x, y);
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(tp[c] - cp[c]);
      if (d > maxDepthDiff) maxDepthDiff = d;
    }
  }
}
console.log('Max Depth diff:', maxDepthDiff);

