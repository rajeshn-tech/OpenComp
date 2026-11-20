import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const inputBuf = ImageIO.readEXR(fs.readFileSync(bgPath));
const src = inputBuf.data;
const len = src.length;

// Test params from Grade_Atmosphere: lift: 0.04, gain: 1.02, gamma: 0.98, blackClamp: true, whiteClamp: false
const bp = 0.0, wp = 1.0, lift = 0.04, gain = 1.02, mult = 1.0, offset = 0.0;
const gamma = 0.98;
const denom = (wp - bp) === 0 ? 0.00001 : (wp - bp);
const A = mult * (gain - lift) / denom;
const B = offset + lift - A * bp;
const invGamma = 1.0 / gamma;

// 1. Reference compute using pure Math.pow
const dstRef = new Float32Array(len);
const tRef0 = performance.now();
for (let iter = 0; iter < 3; iter++) {
  for (let i = 0; i < len; i += 4) {
    let r = A * src[i] + B;
    let g = A * src[i + 1] + B;
    let b = A * src[i + 2] + B;
    if (r > 0) r = Math.pow(r, invGamma); else r = 0;
    if (g > 0) g = Math.pow(g, invGamma); else g = 0;
    if (b > 0) b = Math.pow(b, invGamma); else b = 0;
    dstRef[i] = r;
    dstRef[i + 1] = g;
    dstRef[i + 2] = b;
    dstRef[i + 3] = src[i + 3];
  }
}
const tRef = (performance.now() - tRef0) / 3;

// 2. LUT compute
const LUT_SIZE = 65536;
const LUT_MAX = 4.0;
const LUT_SCALE = LUT_SIZE / LUT_MAX;
const LUT_INV_SCALE = LUT_MAX / LUT_SIZE;

const lutF32 = new Float32Array(LUT_SIZE + 1);
const lutDeltaF32 = new Float32Array(LUT_SIZE + 1);
for (let i = 0; i <= LUT_SIZE; i++) {
  lutF32[i] = Math.pow(i * LUT_INV_SCALE, invGamma);
}
for (let i = 0; i < LUT_SIZE; i++) {
  lutDeltaF32[i] = lutF32[i + 1] - lutF32[i];
}
lutDeltaF32[LUT_SIZE] = 0;

const dstLUT = new Float32Array(len);
const tLUT0 = performance.now();
for (let iter = 0; iter < 3; iter++) {
  for (let i = 0; i < len; i += 4) {
    let r = A * src[i] + B;
    let g = A * src[i + 1] + B;
    let b = A * src[i + 2] + B;

    if (r <= 0) {
      dstLUT[i] = 0;
    } else if (r <= 4.0) {
      const idxF = r * LUT_SCALE;
      const idx = idxF | 0;
      dstLUT[i] = lutF32[idx] + (idxF - idx) * lutDeltaF32[idx];
    } else {
      dstLUT[i] = Math.pow(r, invGamma);
    }

    if (g <= 0) {
      dstLUT[i + 1] = 0;
    } else if (g <= 4.0) {
      const idxF = g * LUT_SCALE;
      const idx = idxF | 0;
      dstLUT[i + 1] = lutF32[idx] + (idxF - idx) * lutDeltaF32[idx];
    } else {
      dstLUT[i + 1] = Math.pow(g, invGamma);
    }

    if (b <= 0) {
      dstLUT[i + 2] = 0;
    } else if (b <= 4.0) {
      const idxF = b * LUT_SCALE;
      const idx = idxF | 0;
      dstLUT[i + 2] = lutF32[idx] + (idxF - idx) * lutDeltaF32[idx];
    } else {
      dstLUT[i + 2] = Math.pow(b, invGamma);
    }

    dstLUT[i + 3] = src[i + 3];
  }
}
const tLUT = (performance.now() - tLUT0) / 3;

// Compare accuracy
let maxDiff = 0;
let sumDiff = 0;
let sumSqDiff = 0;
let count = 0;

for (let i = 0; i < len; i += 4) {
  for (let c = 0; c < 3; c++) {
    const diff = Math.abs(dstLUT[i + c] - dstRef[i + c]);
    if (diff > maxDiff) maxDiff = diff;
    sumDiff += diff;
    sumSqDiff += diff * diff;
    count++;
  }
}

const mae = sumDiff / count;
const rmse = Math.sqrt(sumSqDiff / count);

console.log(`Reference Math.pow Time: ${tRef.toFixed(2)} ms`);
console.log(`Optimized LUT Time:     ${tLUT.toFixed(2)} ms`);
console.log(`Speedup:                ${(tRef / tLUT).toFixed(2)}x`);
console.log(`Max Absolute Error:     ${maxDiff.toExponential(4)}`);
console.log(`MAE:                    ${mae.toExponential(4)}`);
console.log(`RMSE:                   ${rmse.toExponential(4)}`);

