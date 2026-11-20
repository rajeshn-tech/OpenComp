import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
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

// Single-thread reference
function computeSingleThread() {
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
        outData[p4]     = srcData[out4];
        outData[p4 + 1] = srcData[out4 + 1];
        outData[p4 + 2] = srcData[out4 + 2];
        outData[p4 + 3] = srcData[out4 + 3];
      }
    }
  }
  return outBuf;
}

// Multi-threaded 4-core worker pool
const numWorkers = 4;
const workerFile = path.join(workspace, 'scratch/zd_worker.mjs');

// Create worker script
fs.writeFileSync(workerFile, `
import { parentPort, workerData } from 'worker_threads';

const { w, h, numSamples, offDX, offDY, hasBloom, sharedControl, sharedOut, sharedSrc, sharedCoC, sharedBloom } = workerData;

const control = new Int32Array(sharedControl);
const outData = new Float32Array(sharedOut);
const srcData = new Float32Array(sharedSrc);
const cocMap = new Float32Array(sharedCoC);
const bloomMap = hasBloom ? new Float32Array(sharedBloom) : null;

const workerIdx = workerData.workerIdx;
const statusIdx = workerIdx * 4; // status, startY, endY, command

// Signal ready
Atomics.store(control, statusIdx, 1);

const sampleShiftsX = new Int32Array(numSamples);
const sampleShiftsY = new Int32Array(numSamples);
const sampleLinearOffset = new Int32Array(numSamples);

while (true) {
  Atomics.wait(control, statusIdx + 3, 0); // wait for command !== 0
  const cmd = Atomics.load(control, statusIdx + 3);
  if (cmd === 0 || cmd === 2) break; // exit

  const startY = Atomics.load(control, statusIdx + 1);
  const endY = Atomics.load(control, statusIdx + 2);

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

  // Done signal
  Atomics.store(control, statusIdx, 2);
  Atomics.store(control, statusIdx + 3, 0); // reset cmd
  Atomics.notify(control, statusIdx, 1);
}
`);

// Precompute Poisson disc
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

// Shared memory allocations
const sharedControl = new SharedArrayBuffer(numWorkers * 4 * 4); // 4 ints per worker
const control = new Int32Array(sharedControl);

const sharedOut = new SharedArrayBuffer(w * h * 4 * 4);
const sharedSrc = new SharedArrayBuffer(w * h * 4 * 4);
const sharedCoC = new SharedArrayBuffer(w * h * 4);
const sharedBloom = hasBloom ? new SharedArrayBuffer(w * h * 4) : null;

// Initialize workers
const workers = [];
for (let i = 0; i < numWorkers; i++) {
  const worker = new Worker(workerFile, {
    workerData: {
      w, h, numSamples, offDX, offDY, hasBloom,
      sharedControl, sharedOut, sharedSrc, sharedCoC, sharedBloom,
      workerIdx: i
    }
  });
  workers.push(worker);
}

// Wait for all workers to be ready
for (let i = 0; i < numWorkers; i++) {
  while (Atomics.load(control, i * 4) !== 1) {}
}

const sharedSrcF32 = new Float32Array(sharedSrc);
const sharedCoCF32 = new Float32Array(sharedCoC);
const sharedBloomF32 = hasBloom ? new Float32Array(sharedBloom) : null;
const sharedOutF32 = new Float32Array(sharedOut);

function computeParallel() {
  const srcData = inputBuf.data;
  const depthData = depthBuf.data;

  // Copy srcData to shared
  sharedSrcF32.set(srcData);

  // Compute CoC
  const halfDof = dof * 0.5;
  const normFactor = Math.max(0.01, 1.0 - halfDof);
  const invNormFactor = 1.0 / normFactor;

  for (let i = 0; i < w * h; i++) {
    const z = depthData[i * 4];
    const delta = Math.abs(z - focusPlane) - halfDof;
    if (delta <= 0) {
      sharedCoCF32[i] = 0;
    } else {
      const cocNorm = delta < normFactor ? delta * invNormFactor : 1.0;
      sharedCoCF32[i] = cocNorm * maxDefocus;
    }
  }

  // Compute Bloom
  if (hasBloom) {
    for (let i = 0; i < w * h; i++) {
      const sp4 = i * 4;
      const luma = srcData[sp4] * 0.2126 + srcData[sp4 + 1] * 0.7152 + srcData[sp4 + 2] * 0.0722;
      sharedBloomF32[i] = 1.0 + Math.max(0.0, luma - 0.7) * bloomFactor;
    }
  }

  // Dispatch work to 4 workers by scanline bands
  const bandHeight = Math.ceil(h / numWorkers);
  for (let i = 0; i < numWorkers; i++) {
    const startY = i * bandHeight;
    const endY = Math.min(h, (i + 1) * bandHeight);
    const statusIdx = i * 4;
    Atomics.store(control, statusIdx + 1, startY);
    Atomics.store(control, statusIdx + 2, endY);
    Atomics.store(control, statusIdx, 1); // state = running
    Atomics.store(control, statusIdx + 3, 1); // command = run
    Atomics.notify(control, statusIdx + 3, 1);
  }

  // Wait for all workers to complete
  for (let i = 0; i < numWorkers; i++) {
    const statusIdx = i * 4;
    while (Atomics.load(control, statusIdx) !== 2) {
      Atomics.wait(control, statusIdx, 1, 100);
    }
  }

  const outBuf = new PixelBuffer(w, h);
  outBuf.data.set(sharedOutF32);
  return outBuf;
}

// Parity Check
console.log('Testing numerical parity between SingleThread and 4-Worker Parallel:');
const ref = computeSingleThread();
const par = computeParallel();

let maxDiff = 0;
for (let i = 0; i < ref.data.length; i++) {
  const d = Math.abs(ref.data[i] - par.data[i]);
  if (d > maxDiff) maxDiff = d;
}
console.log(`Max Diff: ${maxDiff.toExponential(4)}`);

// Benchmarks
console.log('\nRunning 5 iterations comparison:');
const stTimes = [];
const parTimes = [];

for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  computeSingleThread();
  stTimes.push(performance.now() - t0);

  const t1 = performance.now();
  computeParallel();
  parTimes.push(performance.now() - t1);
}

const avgST = stTimes.reduce((a, b) => a + b, 0) / 5;
const avgPar = parTimes.reduce((a, b) => a + b, 0) / 5;

console.log(`Single-Thread Mean: ${avgST.toFixed(2)} ms`);
console.log(`4-Worker Mean:      ${avgPar.toFixed(2)} ms (${(avgST / avgPar).toFixed(2)}x speedup)`);

// Clean up workers
for (let i = 0; i < numWorkers; i++) {
  const statusIdx = i * 4;
  Atomics.store(control, statusIdx + 3, 2); // exit cmd
  Atomics.notify(control, statusIdx + 3, 1);
  await workers[i].terminate();
}
