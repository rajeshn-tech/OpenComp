import { Worker } from 'node:worker_threads';
import { createNode } from '../src/core/NodeRegistry.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

const W = 1024, H = 1024;
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

const cDepth = createNode('Depth', 'Depth1');
cDepth.setKnobValue('gradientType', 'ground_plane');
const depthBuf = cDepth.compute({ in: contigPlate });

// Let's run a worker that logs what happens at (0, 768)
// We can run the exact code of Worker 3 for scanlines 768 to 1024!
const numSamples = 24;
const focusPlane = 0.2;
const dof = 0.1;
const maxDefocus = 10.0;
const aspect = 1.0;
const bloom = 0.2; // default knob value is 0.2! In Workflow 4, bloom knob was NOT set, so it's 0.2!
const halfDof = dof * 0.5;
const normFactor = Math.max(0.01, 1.0 - halfDof);
const invNormFactor = 1.0 / normFactor;
const bloomFactor = bloom * 2.0;
const hasBloom = bloomFactor > 0.0001;

console.log('bloom:', bloom, 'bloomFactor:', bloomFactor, 'hasBloom:', hasBloom);

// Let's compute cocMap and bloomMap for the whole 1024x1024
const cocMap = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) {
  const z = depthBuf.data[i * 4];
  const delta = Math.abs(z - focusPlane) - halfDof;
  cocMap[i] = delta <= 0 ? 0 : (delta < normFactor ? delta * invNormFactor : 1.0) * maxDefocus;
}

const bloomMap = new Float32Array(W * H);
if (hasBloom) {
  for (let i = 0; i < W * H; i++) {
    const sp4 = i * 4;
    const luma = contigPlate.data[sp4] * 0.2126 + contigPlate.data[sp4 + 1] * 0.7152 + contigPlate.data[sp4 + 2] * 0.0722;
    bloomMap[i] = 1.0 + Math.max(0.0, luma - 0.7) * bloomFactor;
  }
}

// Now let's trace pixel (0, 768):
const x = 0;
const y = 768;
const centerIdx = y * W + x;
const centerCoC = cocMap[centerIdx];
console.log('centerCoC at (0, 768):', centerCoC);

const offDX = new Float32Array(numSamples);
const offDY = new Float32Array(numSamples);
const goldenAngle = 2.39996323;
for (let i = 0; i < numSamples; i++) {
  const r = Math.sqrt((i + 0.5) / numSamples);
  const theta = i * goldenAngle;
  offDX[i] = r * Math.cos(theta) * aspect;
  offDY[i] = r * Math.sin(theta);
}

const sampleShiftsX = new Int32Array(numSamples);
const sampleShiftsY = new Int32Array(numSamples);
let maxShiftX = 0;
let maxShiftY = 0;
for (let s = 0; s < numSamples; s++) {
  const sx = Math.round(offDX[s] * centerCoC);
  const sy = Math.round(offDY[s] * centerCoC);
  sampleShiftsX[s] = sx;
  sampleShiftsY[s] = sy;
  if (Math.abs(sx) > maxShiftX) maxShiftX = Math.abs(sx);
  if (Math.abs(sy) > maxShiftY) maxShiftY = Math.abs(sy);
}

console.log('maxShiftX:', maxShiftX, 'maxShiftY:', maxShiftY);
const isInterior = (x >= maxShiftX && x < W - maxShiftX && y >= maxShiftY && y < H - maxShiftY);
console.log('isInterior:', isInterior);

let accR = 0, accG = 0, accB = 0, accA = 0, totalWeight = 0;
const invCenterCoC = 1.0 / centerCoC;

for (let s = 0; s < numSamples; s++) {
  const sx = x + sampleShiftsX[s];
  const sy = y + sampleShiftsY[s];
  if (sx >= 0 && sx < W && sy >= 0 && sy < H) {
    const sIdx = sy * W + sx;
    const sCoC = cocMap[sIdx];
    const sp4 = sIdx * 4;
    const cocWeight = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, 1.0 - (centerCoC - sCoC) * invCenterCoC);
    const wFinal = hasBloom ? cocWeight * bloomMap[sIdx] : cocWeight;
    accR += contigPlate.data[sp4] * wFinal;
    accG += contigPlate.data[sp4 + 1] * wFinal;
    accB += contigPlate.data[sp4 + 2] * wFinal;
    accA += contigPlate.data[sp4 + 3] * wFinal;
    totalWeight += wFinal;
  }
}

console.log('Calculated at (0, 768):', accG / totalWeight, 'totalWeight:', totalWeight);

