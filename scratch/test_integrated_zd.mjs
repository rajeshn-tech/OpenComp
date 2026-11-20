import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));
const { PixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));

const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const depthPath = path.join(workspace, 'demo/vfx_showcase/depth/depth_pass.0001.exr');
const inputBuf = ImageIO.readEXR(fs.readFileSync(bgPath));
const depthBuf = ImageIO.readEXR(fs.readFileSync(depthPath));

const w = inputBuf.width;
const h = inputBuf.height;
const focusPlane = 0.5;
const dof = 0.12;
const maxDefocus = 14.0;
const aspect = 1.0;
const bloom = 0.25;

// Reference Single-Threaded Baseline
function computeReference() {
  const outBuf = new PixelBuffer(w, h);
  const outData = outBuf.data;
  const srcData = inputBuf.data;
  const depthData = depthBuf.data;

  const cocMap = new Float32Array(w * h);
  const halfDof = dof * 0.5;
  const normFactor = Math.max(0.01, 1.0 - halfDof);
  const invNormFactor = 1.0 / normFactor;

  for (let i = 0; i < w * h; i++) {
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
    bloomMap = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
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
        for (let s = 0; s < numSamples; s++) {
          const sIdx = centerIdx + sampleLinearOffset[s];
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

// Optimized Multi-Threaded Engine with Worker Pool Manager
class ZDefocusThreadPool {
  constructor(numWorkers = 4) {
    this.numWorkers = numWorkers;
    this.allocatedCapacity = 0;
    this.workers = [];
    this.ready = false;
    this.initWorkers();
  }

  ensureCapacity(width, height) {
    const requiredPixels = width * height;
    if (this.allocatedCapacity >= requiredPixels) return;

    this.allocatedCapacity = requiredPixels;
    const byteLenRGBA = requiredPixels * 4 * 4; // 16 bytes per pixel
    const byteLenScalar = requiredPixels * 4;   // 4 bytes per pixel

    this.sharedControl = new SharedArrayBuffer(this.numWorkers * 8 * 4);
    this.control = new Int32Array(this.sharedControl);

    this.sharedOut = new SharedArrayBuffer(byteLenRGBA);
    this.sharedSrc = new SharedArrayBuffer(byteLenRGBA);
    this.sharedDepth = new SharedArrayBuffer(byteLenRGBA);
    this.sharedCoC = new SharedArrayBuffer(byteLenScalar);
    this.sharedBloom = new SharedArrayBuffer(byteLenScalar);

    this.sharedOutF32 = new Float32Array(this.sharedOut);
    this.sharedSrcF32 = new Float32Array(this.sharedSrc);
    this.sharedDepthF32 = new Float32Array(this.sharedDepth);

    this.paramBuf = new SharedArrayBuffer(32);
    this.paramF32 = new Float32Array(this.paramBuf);
    this.paramI32 = new Int32Array(this.paramBuf);

    this.restartWorkers(width, height);
  }

  initWorkers() {
    // Lazy initialized on ensureCapacity
  }

  restartWorkers(w, h) {
    // Terminate old workers if any
    for (const wrk of this.workers) {
      wrk.terminate();
    }
    this.workers = [];

    const numSamples = 24;
    const workerScript = `
import { parentPort, workerData } from 'worker_threads';

const { w, h, numSamples, sharedControl, sharedOut, sharedSrc, sharedDepth, sharedCoC, sharedBloom, workerIdx } = workerData;

const control = new Int32Array(sharedControl);
const outData = new Float32Array(sharedOut);
const srcData = new Float32Array(sharedSrc);
const depthData = new Float32Array(sharedDepth);
const cocMap = new Float32Array(sharedCoC);
const bloomMap = new Float32Array(sharedBloom);

const statusIdx = workerIdx * 8;
const sampleShiftsX = new Int32Array(numSamples);
const sampleShiftsY = new Int32Array(numSamples);
const sampleLinearOffset = new Int32Array(numSamples);

const offDX = new Float32Array(numSamples);
const offDY = new Float32Array(numSamples);

// Parameter buffer view
const paramBuf = new SharedArrayBuffer(32);
const paramF32 = new Float32Array(paramBuf);
const paramI32 = new Int32Array(paramBuf);

// Signal ready
Atomics.store(control, statusIdx, 1);

while (true) {
  Atomics.wait(control, statusIdx + 3, 0); // wait for command !== 0
  const cmd = Atomics.load(control, statusIdx + 3);
  if (cmd === 0 || cmd === 99) break; // exit

  const startY = Atomics.load(control, statusIdx + 1);
  const endY = Atomics.load(control, statusIdx + 2);

  paramI32[0] = Atomics.load(control, statusIdx + 4);
  paramI32[1] = Atomics.load(control, statusIdx + 5);
  paramI32[2] = Atomics.load(control, statusIdx + 6);
  paramI32[3] = Atomics.load(control, statusIdx + 7);

  const fp = paramF32[0];
  const hd = paramF32[1];
  const invNorm = paramF32[2];
  const maxDefocus = paramF32[3];

  const normFactor = 1.0 / invNorm;
  const startIdx = startY * w;
  const endIdx = endY * w;

  // 1. CoC Map calculation in parallel
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

  // Signal Phase 1 done
  Atomics.store(control, statusIdx, 2);
  Atomics.store(control, statusIdx + 3, 0);
  Atomics.notify(control, statusIdx, 1);

  // Wait for Phase 2 command (Convolution)
  Atomics.wait(control, statusIdx + 3, 0);
  const cmd2 = Atomics.load(control, statusIdx + 3);
  if (cmd2 === 0 || cmd2 === 99) break;

  paramI32[0] = Atomics.load(control, statusIdx + 4);
  paramI32[1] = Atomics.load(control, statusIdx + 5);
  const aspect = paramF32[0];
  const bloomFactor = paramF32[1];
  const hasBloom = bloomFactor > 0.0001;

  // Precompute Poisson disc for this aspect ratio
  const goldenAngle = 2.39996323;
  for (let i = 0; i < numSamples; i++) {
    const r = Math.sqrt((i + 0.5) / numSamples);
    const theta = i * goldenAngle;
    offDX[i] = r * Math.cos(theta) * aspect;
    offDY[i] = r * Math.sin(theta);
  }

  // Precalculate Bloom map in parallel if active
  if (hasBloom) {
    for (let i = startIdx; i < endIdx; i++) {
      const sp4 = i * 4;
      const luma = srcData[sp4] * 0.2126 + srcData[sp4 + 1] * 0.7152 + srcData[sp4 + 2] * 0.0722;
      bloomMap[i] = 1.0 + Math.max(0.0, luma - 0.7) * bloomFactor;
    }
  }

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

  // Signal Phase 2 done
  Atomics.store(control, statusIdx, 2);
  Atomics.store(control, statusIdx + 3, 0);
  Atomics.notify(control, statusIdx, 1);
}
`;

    const scriptPath = path.join(workspace, 'scratch/zd_pool_worker.mjs');
    fs.writeFileSync(scriptPath, workerScript);

    for (let i = 0; i < this.numWorkers; i++) {
      const wrk = new Worker(scriptPath, {
        workerData: {
          w, h, numSamples,
          sharedControl: this.sharedControl,
          sharedOut: this.sharedOut,
          sharedSrc: this.sharedSrc,
          sharedDepth: this.sharedDepth,
          sharedCoC: this.sharedCoC,
          sharedBloom: this.sharedBloom,
          workerIdx: i
        }
      });
      wrk.unref(); // Don't hold Node process open
      this.workers.push(wrk);
    }

    for (let i = 0; i < this.numWorkers; i++) {
      while (Atomics.load(this.control, i * 8) !== 1) {}
    }
    this.ready = true;
  }

  execute(inputBuf, depthBuf, focusPlane, dof, maxDefocus, aspect, bloom) {
    const w = inputBuf.width;
    const h = inputBuf.height;
    this.ensureCapacity(w, h);

    // Transfer inputs to shared memory
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

    const bandHeight = Math.ceil(h / this.numWorkers);

    // Phase 1: Parallel CoC Map computation
    for (let i = 0; i < this.numWorkers; i++) {
      const startY = i * bandHeight;
      const endY = Math.min(h, (i + 1) * bandHeight);
      const sIdx = i * 8;
      Atomics.store(this.control, sIdx + 1, startY);
      Atomics.store(this.control, sIdx + 2, endY);
      Atomics.store(this.control, sIdx + 4, this.paramI32[0]);
      Atomics.store(this.control, sIdx + 5, this.paramI32[1]);
      Atomics.store(this.control, sIdx + 6, this.paramI32[2]);
      Atomics.store(this.control, sIdx + 7, this.paramI32[3]);

      Atomics.store(this.control, sIdx, 1);
      Atomics.store(this.control, sIdx + 3, 1); // command = 1 (CoC)
      Atomics.notify(this.control, sIdx + 3, 1);
    }

    for (let i = 0; i < this.numWorkers; i++) {
      const sIdx = i * 8;
      while (Atomics.load(this.control, sIdx) !== 2) {
        Atomics.wait(this.control, sIdx, 1, 100);
      }
    }

    // Phase 2: Parallel Bloom + Convolution
    this.paramF32[0] = aspect;
    this.paramF32[1] = bloomFactor;

    for (let i = 0; i < this.numWorkers; i++) {
      const startY = i * bandHeight;
      const endY = Math.min(h, (i + 1) * bandHeight);
      const sIdx = i * 8;
      Atomics.store(this.control, sIdx + 1, startY);
      Atomics.store(this.control, sIdx + 2, endY);
      Atomics.store(this.control, sIdx + 4, this.paramI32[0]);
      Atomics.store(this.control, sIdx + 5, this.paramI32[1]);

      Atomics.store(this.control, sIdx, 1);
      Atomics.store(this.control, sIdx + 3, 2); // command = 2 (Convolution)
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

  terminate() {
    for (let i = 0; i < this.workers.length; i++) {
      const sIdx = i * 8;
      Atomics.store(this.control, sIdx + 3, 99);
      Atomics.notify(this.control, sIdx + 3, 1);
      this.workers[i].terminate();
    }
  }
}

// 1. Verify Numerical Parity
console.log('Testing numerical parity between Reference and ThreadPool:');
const pool = new ZDefocusThreadPool(4);

// Warmup
pool.execute(inputBuf, depthBuf, focusPlane, dof, maxDefocus, aspect, bloom);

const ref = computeReference();
const opt = pool.execute(inputBuf, depthBuf, focusPlane, dof, maxDefocus, aspect, bloom);

let maxDiff = 0;
let sumDiff = 0;
let sumSqDiff = 0;
const len = ref.data.length;

for (let i = 0; i < len; i++) {
  const d = Math.abs(ref.data[i] - opt.data[i]);
  if (d > maxDiff) maxDiff = d;
  sumDiff += d;
  sumSqDiff += d * d;
}
const mae = sumDiff / len;
const rmse = Math.sqrt(sumSqDiff / len);

console.log(`   - Max Diff: ${maxDiff.toExponential(4)}`);
console.log(`   - MAE:      ${mae.toExponential(4)}`);
console.log(`   - RMSE:     ${rmse.toExponential(4)}`);

// 2. 5-run benchmark
console.log('\nRunning 5-run comparative benchmark (1080p, 24 Poisson samples):');
const refTimes = [];
const optTimes = [];

for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  computeReference();
  refTimes.push(performance.now() - t0);

  const t1 = performance.now();
  pool.execute(inputBuf, depthBuf, focusPlane, dof, maxDefocus, aspect, bloom);
  optTimes.push(performance.now() - t1);
}

const avgRef = refTimes.reduce((a, b) => a + b, 0) / 5;
const avgOpt = optTimes.reduce((a, b) => a + b, 0) / 5;

console.log(`   - Single-Thread Reference Mean: ${avgRef.toFixed(2)} ms`);
console.log(`   - Multi-Threaded Engine Mean:   ${avgOpt.toFixed(2)} ms`);
console.log(`   - Speedup Ratio:                ${(avgRef / avgOpt).toFixed(2)}x speedup!`);

pool.terminate();

