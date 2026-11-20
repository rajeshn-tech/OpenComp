import { Worker } from 'node:worker_threads';
import { createNode } from '../src/core/NodeRegistry.js';
import { PixelBuffer, TiledPixelBuffer } from '../src/core/PixelBuffer.js';

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

const depthNode = createNode('Depth', 'Depth1');
depthNode.setKnobValue('gradientType', 'ground_plane');
const depthBuf = depthNode.compute({ in: contigPlate });

// Test with bloomMap in Phase 1
const WORKER_CODE_FIXED = `
const { workerData } = require('node:worker_threads');

const { numSamples, sharedControl, sharedOut, sharedSrc, sharedDepth, sharedCoC, sharedBloom, sharedParams, workerIdx } = workerData;

const control = new Int32Array(sharedControl);
const outData = new Float32Array(sharedOut);
const srcData = new Float32Array(sharedSrc);
const depthData = new Float32Array(sharedDepth);
const cocMap = new Float32Array(sharedCoC);
const bloomMap = new Float32Array(sharedBloom);
const paramF32 = new Float32Array(sharedParams);

const statusIdx = workerIdx * 8;
const sampleShiftsX = new Int32Array(numSamples);
const sampleShiftsY = new Int32Array(numSamples);
const sampleLinearOffset = new Int32Array(numSamples);

const offDX = new Float32Array(numSamples);
const offDY = new Float32Array(numSamples);

// Signal ready
Atomics.store(control, statusIdx, 1);

while (true) {
  Atomics.wait(control, statusIdx + 3, 0);
  const cmd = Atomics.load(control, statusIdx + 3);
  if (cmd === 0 || cmd === 99) break;

  const startY = Atomics.load(control, statusIdx + 1);
  const endY = Atomics.load(control, statusIdx + 2);
  const w = Atomics.load(control, statusIdx + 4);
  const h = Atomics.load(control, statusIdx + 5);

  const fp = paramF32[0];
  const hd = paramF32[1];
  const invNorm = paramF32[2];
  const maxDefocus = paramF32[3];
  const aspect = paramF32[4];
  const bloomFactor = paramF32[5];
  const hasBloom = bloomFactor > 0.0001;

  const normFactor = 1.0 / invNorm;
  const startIdx = startY * w;
  const endIdx = endY * w;

  // Phase 1a: Parallel CoC calculation
  for (let i = startIdx; i < endIdx; i++) {
    const z = depthData[i * 4];
    const delta = Math.abs(z - fp) - hd;
    if (delta <= 0) {
      cocMap[i] = 0;
    } else {
      const cocNorm = delta < normFactor ? delta * invNorm : 1.0;
      cocMap[i] = cocNorm * maxDefocus;
    }
  }

  // Phase 1b: Highlight bloom in parallel
  if (hasBloom) {
    for (let i = startIdx; i < endIdx; i++) {
      const sp4 = i * 4;
      const luma = srcData[sp4] * 0.2126 + srcData[sp4 + 1] * 0.7152 + srcData[sp4 + 2] * 0.0722;
      bloomMap[i] = 1.0 + Math.max(0.0, luma - 0.7) * bloomFactor;
    }
  }

  // Signal Phase 1 complete
  Atomics.store(control, statusIdx, 2);
  Atomics.store(control, statusIdx + 3, 0);
  Atomics.notify(control, statusIdx, 1);

  // Wait for Phase 2 command (Convolution)
  Atomics.wait(control, statusIdx + 3, 0);
  const cmd2 = Atomics.load(control, statusIdx + 3);
  if (cmd2 === 0 || cmd2 === 99) break;

  // Precompute Poisson disc for aspect ratio
  const goldenAngle = 2.39996323;
  for (let i = 0; i < numSamples; i++) {
    const r = Math.sqrt((i + 0.5) / numSamples);
    const theta = i * goldenAngle;
    offDX[i] = r * Math.cos(theta) * aspect;
    offDY[i] = r * Math.sin(theta);
  }

  // Phase 2: Convolution
  let lastCoC = -999.0;
  let maxShiftX = 0;
  let maxShiftY = 0;

  for (let y = startY; y < endY; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      const centerIdx = rowOffset + x;
      const centerCoC = cocMap[centerIdx];
      const p4 = centerIdx * 4;

      if (centerCoC < 0.5) {
        outData[p4]     = srcData[p4];
        outData[p4 + 1] = srcData[p4 + 1];
        outData[p4 + 2] = srcData[p4 + 2];
        outData[p4 + 3] = srcData[p4 + 3];
        continue;
      }

      if (centerCoC !== lastCoC) {
        lastCoC = centerCoC;
        maxShiftX = 0;
        maxShiftY = 0;
        for (let s = 0; s < numSamples; s++) {
          const sx = Math.round(offDX[s] * centerCoC);
          const sy = Math.round(offDY[s] * centerCoC);
          sampleShiftsX[s] = sx;
          sampleShiftsY[s] = sy;
          sampleLinearOffset[s] = sy * w + sx;
          const absX = Math.abs(sx);
          const absY = Math.abs(sy);
          if (absX > maxShiftX) maxShiftX = absX;
          if (absY > maxShiftY) maxShiftY = absY;
        }
      }

      const invCenterCoC = 1.0 / centerCoC;
      let accR = 0.0, accG = 0.0, accB = 0.0, accA = 0.0;
      let totalWeight = 0.0;

      const isInterior = (x >= maxShiftX && x < w - maxShiftX && y >= maxShiftY && y < h - maxShiftY);

      if (isInterior) {
        if (!hasBloom) {
          for (let s = 0; s < numSamples; s++) {
            const sIdx = centerIdx + sampleLinearOffset[s];
            const sCoC = cocMap[sIdx];
            const sp4 = sIdx * 4;

            if (sCoC >= centerCoC) {
              accR += srcData[sp4];
              accG += srcData[sp4 + 1];
              accB += srcData[sp4 + 2];
              accA += srcData[sp4 + 3];
              totalWeight += 1.0;
            } else {
              const w_s = Math.max(0.1, 1.0 - (centerCoC - sCoC) * invCenterCoC);
              accR += srcData[sp4] * w_s;
              accG += srcData[sp4 + 1] * w_s;
              accB += srcData[sp4 + 2] * w_s;
              accA += srcData[sp4 + 3] * w_s;
              totalWeight += w_s;
            }
          }
        } else {
          for (let s = 0; s < numSamples; s++) {
            const sIdx = centerIdx + sampleLinearOffset[s];
            const sCoC = cocMap[sIdx];
            const sp4 = sIdx * 4;
            const b = bloomMap[sIdx];

            if (sCoC >= centerCoC && b === 1.0) {
              accR += srcData[sp4];
              accG += srcData[sp4 + 1];
              accB += srcData[sp4 + 2];
              accA += srcData[sp4 + 3];
              totalWeight += 1.0;
            } else {
              const cocW = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, 1.0 - (centerCoC - sCoC) * invCenterCoC);
              const w_s = cocW * b;
              accR += srcData[sp4] * w_s;
              accG += srcData[sp4 + 1] * w_s;
              accB += srcData[sp4 + 2] * w_s;
              accA += srcData[sp4 + 3] * w_s;
              totalWeight += w_s;
            }
          }
        }
      } else {
        for (let s = 0; s < numSamples; s++) {
          const sx = x + sampleShiftsX[s];
          const sy = y + sampleShiftsY[s];

          if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
            const sIdx = sy * w + sx;
            const sCoC = cocMap[sIdx];
            const sp4 = sIdx * 4;

            const cocWeight = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, 1.0 - (centerCoC - sCoC) * invCenterCoC);
            const wFinal = hasBloom ? cocWeight * bloomMap[sIdx] : cocWeight;

            accR += srcData[sp4] * wFinal;
            accG += srcData[sp4 + 1] * wFinal;
            accB += srcData[sp4 + 2] * wFinal;
            accA += srcData[sp4 + 3] * wFinal;
            totalWeight += wFinal;
          }
        }
      }

      if (totalWeight > 0.0) {
        const invTotal = 1.0 / totalWeight;
        outData[p4]     = accR * invTotal;
        outData[p4 + 1] = accG * invTotal;
        outData[p4 + 2] = accB * invTotal;
        outData[p4 + 3] = accA * invTotal;
      } else {
        outData[p4]     = srcData[p4];
        outData[p4 + 1] = srcData[p4 + 1];
        outData[p4 + 2] = srcData[p4 + 2];
        outData[p4 + 3] = srcData[p4 + 3];
      }
    }
  }

  // Signal Phase 2 complete
  Atomics.store(control, statusIdx, 2);
  Atomics.store(control, statusIdx + 3, 0);
  Atomics.notify(control, statusIdx, 1);
}
`;

class TestPool {
  constructor(numWorkers = 4) {
    this.numWorkers = numWorkers;
    const capacity = 1024 * 1024;
    this.sharedControl = new SharedArrayBuffer(numWorkers * 8 * 4);
    this.control = new Int32Array(this.sharedControl);
    this.sharedOut = new SharedArrayBuffer(capacity * 4 * 4);
    this.sharedSrc = new SharedArrayBuffer(capacity * 4 * 4);
    this.sharedDepth = new SharedArrayBuffer(capacity * 4 * 4);
    this.sharedCoC = new SharedArrayBuffer(capacity * 4);
    this.sharedBloom = new SharedArrayBuffer(capacity * 4);
    this.sharedParams = new SharedArrayBuffer(16 * 4);

    this.sharedOutF32 = new Float32Array(this.sharedOut);
    this.sharedSrcF32 = new Float32Array(this.sharedSrc);
    this.sharedDepthF32 = new Float32Array(this.sharedDepth);
    this.paramF32 = new Float32Array(this.sharedParams);

    this.workers = [];
    for (let i = 0; i < numWorkers; i++) {
      const wrk = new Worker(WORKER_CODE_FIXED, {
        eval: true,
        workerData: {
          numSamples: 24,
          sharedControl: this.sharedControl,
          sharedOut: this.sharedOut,
          sharedSrc: this.sharedSrc,
          sharedDepth: this.sharedDepth,
          sharedCoC: this.sharedCoC,
          sharedBloom: this.sharedBloom,
          sharedParams: this.sharedParams,
          workerIdx: i
        }
      });
      wrk.unref();
      this.workers.push(wrk);
    }
    for (let i = 0; i < numWorkers; i++) {
      while (Atomics.load(this.control, i * 8) !== 1) {}
    }
  }

  execute(inputBuf, depthBuf, focusPlane, dof, maxDefocus, aspect, bloom) {
    const w = inputBuf.width;
    const h = inputBuf.height;
    this.sharedSrcF32.set(inputBuf.data);
    this.sharedDepthF32.set(depthBuf.data);

    const halfDof = dof * 0.5;
    const normFactor = Math.max(0.01, 1.0 - halfDof);
    const invNormFactor = 1.0 / normFactor;
    const bloomFactor = bloom * 2.0;

    this.paramF32[0] = focusPlane;
    this.paramF32[1] = halfDof;
    this.paramF32[2] = invNormFactor;
    this.paramF32[3] = maxDefocus;
    this.paramF32[4] = aspect;
    this.paramF32[5] = bloomFactor;

    const bandHeight = Math.ceil(h / this.numWorkers);

    for (let i = 0; i < this.numWorkers; i++) {
      const startY = i * bandHeight;
      const endY = Math.min(h, (i + 1) * bandHeight);
      const sIdx = i * 8;
      Atomics.store(this.control, sIdx + 1, startY);
      Atomics.store(this.control, sIdx + 2, endY);
      Atomics.store(this.control, sIdx + 4, w);
      Atomics.store(this.control, sIdx + 5, h);

      Atomics.store(this.control, sIdx, 1);
      Atomics.store(this.control, sIdx + 3, 1);
      Atomics.notify(this.control, sIdx + 3, 1);
    }

    for (let i = 0; i < this.numWorkers; i++) {
      const sIdx = i * 8;
      while (Atomics.load(this.control, sIdx) !== 2) {
        Atomics.wait(this.control, sIdx, 1, 100);
      }
    }

    for (let i = 0; i < this.numWorkers; i++) {
      const startY = i * bandHeight;
      const endY = Math.min(h, (i + 1) * bandHeight);
      const sIdx = i * 8;
      Atomics.store(this.control, sIdx + 1, startY);
      Atomics.store(this.control, sIdx + 2, endY);
      Atomics.store(this.control, sIdx + 4, w);
      Atomics.store(this.control, sIdx + 5, h);

      Atomics.store(this.control, sIdx, 1);
      Atomics.store(this.control, sIdx + 3, 2);
      Atomics.notify(this.control, sIdx + 3, 1);
    }

    for (let i = 0; i < this.numWorkers; i++) {
      const sIdx = i * 8;
      while (Atomics.load(this.control, sIdx) !== 2) {
        Atomics.wait(this.control, sIdx, 1, 100);
      }
    }

    const outBuf = new PixelBuffer(w, h);
    outBuf.data.set(this.sharedOutF32.subarray(0, w * h * 4));
    return outBuf;
  }
}

// Single threaded reference
function runSingleThreaded(inputBuf, depthBuf, focusPlane, dof, maxDefocus, aspect, bloom) {
  const w = inputBuf.width;
  const h = inputBuf.height;
  const pixelCount = w * h;
  const outBuf = new PixelBuffer(w, h);
  const outData = outBuf.data;
  const srcData = inputBuf.data;
  const depthData = depthBuf.data;

  const cocMap = new Float32Array(pixelCount);
  const halfDof = dof * 0.5;
  const normFactor = Math.max(0.01, 1.0 - halfDof);
  const invNormFactor = 1.0 / normFactor;

  for (let i = 0; i < pixelCount; i++) {
    const z = depthData[i * 4];
    const delta = Math.abs(z - focusPlane) - halfDof;
    if (delta <= 0) {
      cocMap[i] = 0;
    } else {
      const cocNorm = delta < normFactor ? delta * invNormFactor : 1.0;
      cocMap[i] = cocNorm * maxDefocus;
    }
  }

  const numSamples = 24;
  const offDX = new Float32Array(numSamples);
  const offDY = new Float32Array(numSamples);
  const goldenAngle = 2.39996323;

  for (let i = 0; i < numSamples; i++) {
    const r = Math.sqrt((i + 0.5) / numSamples);
    const theta = i * goldenAngle;
    offDX[i] = r * Math.cos(theta) * aspect;
    offDY[i] = r * Math.sin(theta);
  }

  const bloomFactor = bloom * 2.0;
  const hasBloom = bloomFactor > 0.0001;
  let bloomMap = null;
  if (hasBloom) {
    bloomMap = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const sp4 = i * 4;
      const luma = srcData[sp4] * 0.2126 + srcData[sp4 + 1] * 0.7152 + srcData[sp4 + 2] * 0.0722;
      bloomMap[i] = 1.0 + Math.max(0.0, luma - 0.7) * bloomFactor;
    }
  }

  const sampleShiftsX = new Int32Array(numSamples);
  const sampleShiftsY = new Int32Array(numSamples);
  const sampleLinearOffset = new Int32Array(numSamples);
  let lastCoC = -999.0;
  let maxShiftX = 0;
  let maxShiftY = 0;

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      const centerIdx = rowOffset + x;
      const centerCoC = cocMap[centerIdx];
      const p4 = centerIdx * 4;

      if (centerCoC < 0.5) {
        outData[p4]     = srcData[p4];
        outData[p4 + 1] = srcData[p4 + 1];
        outData[p4 + 2] = srcData[p4 + 2];
        outData[p4 + 3] = srcData[p4 + 3];
        continue;
      }

      if (centerCoC !== lastCoC) {
        lastCoC = centerCoC;
        maxShiftX = 0;
        maxShiftY = 0;
        for (let s = 0; s < numSamples; s++) {
          const sx = Math.round(offDX[s] * centerCoC);
          const sy = Math.round(offDY[s] * centerCoC);
          sampleShiftsX[s] = sx;
          sampleShiftsY[s] = sy;
          sampleLinearOffset[s] = sy * w + sx;
          const absX = Math.abs(sx);
          const absY = Math.abs(sy);
          if (absX > maxShiftX) maxShiftX = absX;
          if (absY > maxShiftY) maxShiftY = absY;
        }
      }

      const invCenterCoC = 1.0 / centerCoC;
      let accR = 0.0, accG = 0.0, accB = 0.0, accA = 0.0;
      let totalWeight = 0.0;

      const isInterior = (x >= maxShiftX && x < w - maxShiftX && y >= maxShiftY && y < h - maxShiftY);

      if (isInterior) {
        if (!hasBloom) {
          for (let s = 0; s < numSamples; s++) {
            const sIdx = centerIdx + sampleLinearOffset[s];
            const sCoC = cocMap[sIdx];
            const sp4 = sIdx * 4;

            if (sCoC >= centerCoC) {
              accR += srcData[sp4];
              accG += srcData[sp4 + 1];
              accB += srcData[sp4 + 2];
              accA += srcData[sp4 + 3];
              totalWeight += 1.0;
            } else {
              const w_s = Math.max(0.1, 1.0 - (centerCoC - sCoC) * invCenterCoC);
              accR += srcData[sp4] * w_s;
              accG += srcData[sp4 + 1] * w_s;
              accB += srcData[sp4 + 2] * w_s;
              accA += srcData[sp4 + 3] * w_s;
              totalWeight += w_s;
            }
          }
        } else {
          for (let s = 0; s < numSamples; s++) {
            const sIdx = centerIdx + sampleLinearOffset[s];
            const sCoC = cocMap[sIdx];
            const sp4 = sIdx * 4;
            const b = bloomMap[sIdx];

            if (sCoC >= centerCoC && b === 1.0) {
              accR += srcData[sp4];
              accG += srcData[sp4 + 1];
              accB += srcData[sp4 + 2];
              accA += srcData[sp4 + 3];
              totalWeight += 1.0;
            } else {
              const cocW = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, 1.0 - (centerCoC - sCoC) * invCenterCoC);
              const w_s = cocW * b;
              accR += srcData[sp4] * w_s;
              accG += srcData[sp4 + 1] * w_s;
              accB += srcData[sp4 + 2] * w_s;
              accA += srcData[sp4 + 3] * w_s;
              totalWeight += w_s;
            }
          }
        }
      } else {
        for (let s = 0; s < numSamples; s++) {
          const sx = x + sampleShiftsX[s];
          const sy = y + sampleShiftsY[s];

          if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
            const sIdx = sy * w + sx;
            const sCoC = cocMap[sIdx];
            const sp4 = sIdx * 4;

            const cocWeight = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, 1.0 - (centerCoC - sCoC) * invCenterCoC);
            const wFinal = hasBloom ? cocWeight * bloomMap[sIdx] : cocWeight;

            accR += srcData[sp4] * wFinal;
            accG += srcData[sp4 + 1] * wFinal;
            accB += srcData[sp4 + 2] * wFinal;
            accA += srcData[sp4 + 3] * wFinal;
            totalWeight += wFinal;
          }
        }
      }

      if (totalWeight > 0.0) {
        const invTotal = 1.0 / totalWeight;
        outData[p4]     = accR * invTotal;
        outData[p4 + 1] = accG * invTotal;
        outData[p4 + 2] = accB * invTotal;
        outData[p4 + 3] = accA * invTotal;
      } else {
        outData[p4]     = srcData[p4];
        outData[p4 + 1] = srcData[p4 + 1];
        outData[p4 + 2] = srcData[p4 + 2];
        outData[p4 + 3] = srcData[p4 + 3];
      }
    }
  }
  return outBuf;
}

const pool = new TestPool(4);
const resFixed = pool.execute(contigPlate, depthBuf, 0.2, 0.1, 10.0, 1.0, 0.2);
const resSingle = runSingleThreaded(contigPlate, depthBuf, 0.2, 0.1, 10.0, 1.0, 0.2);

let maxDelta = 0;
for (let i = 0; i < W * H * 4; i++) {
  const d = Math.abs(resFixed.data[i] - resSingle.data[i]);
  if (d > maxDelta) maxDelta = d;
}
console.log('Fixed Worker vs SingleThreaded Max Delta across entire 1024x1024 image:', maxDelta);
