import { createNode } from '../src/core/NodeRegistry.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

const W = 1024, H = 1024;
const contigPlate = new PixelBuffer(W, H);
const cDepth = createNode('Depth', 'Depth1');
cDepth.setKnobValue('gradientType', 'ground_plane');
const depthBuf = cDepth.compute({ in: contigPlate });

const focusPlane = 0.2;
const dof = 0.1;
const maxDefocus = 10.0;
const halfDof = dof * 0.5;
const normFactor = Math.max(0.01, 1.0 - halfDof);
const invNormFactor = 1.0 / normFactor;

for (let y of [0, 255, 256, 511, 512, 767, 768, 1023]) {
  const i = y * W + 0;
  const z = depthBuf.data[i * 4];
  const delta = Math.abs(z - focusPlane) - halfDof;
  const coc = delta <= 0 ? 0 : (delta < normFactor ? delta * invNormFactor : 1.0) * maxDefocus;
  console.log(`y=${y}: z=${z}, delta=${delta}, coc=${coc}`);
}

