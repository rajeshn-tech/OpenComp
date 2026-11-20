import { createNode } from '../src/core/NodeRegistry.js';
import { PixelBuffer, TiledPixelBuffer } from '../src/core/PixelBuffer.js';

const W = 1024, H = 1024;
const tileSize = 256;

const contigPlate = new PixelBuffer(W, H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = (y * W + x) * 4;
    contigPlate.data[idx] = (x % 32 < 16) ? 0.9 : 0.1;
    contigPlate.data[idx + 1] = (y % 32 < 16) ? 0.9 : 0.1;
    contigPlate.data[idx + 2] = 0.5;
    contigPlate.data[idx + 3] = 1.0;
  }
}
const tiledPlate = TiledPixelBuffer.fromContiguous(contigPlate, tileSize);

const cDepth = createNode('Depth', 'Depth1');
cDepth.setKnobValue('gradientType', 'ground_plane');
const cDepthOut = cDepth.compute({ in: contigPlate });

const tDepth = createNode('Depth', 'Depth1');
tDepth.setKnobValue('gradientType', 'ground_plane');
const tDepthOut = tDepth.compute({ in: tiledPlate });

const cZDefocus = createNode('ZDefocus', 'ZDefocus1');
cZDefocus.setKnobValue('focusPlane', 0.2);
cZDefocus.setKnobValue('maxDefocus', 10.0);
const resContig = cZDefocus.compute({ in: contigPlate, depth: cDepthOut });

const tZDefocus = createNode('ZDefocus', 'ZDefocus1');
tZDefocus.setKnobValue('focusPlane', 0.2);
tZDefocus.setKnobValue('maxDefocus', 10.0);
const resTiled = tZDefocus.compute({ in: tiledPlate, depth: tDepthOut });

// Compare resTiled and resContig
let maxDelta = 0;
let maxCoord = null;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const tp = resTiled.getPixel(x, y);
    const cIdx = (y * W + x) * 4;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(tp[c] - resContig.data[cIdx + c]);
      if (d > maxDelta) {
        maxDelta = d;
        maxCoord = { x, y, c, tiled: tp[c], contig: resContig.data[cIdx + c] };
      }
    }
  }
}

console.log('Max Delta:', maxDelta);
console.log('At coord:', maxCoord);

