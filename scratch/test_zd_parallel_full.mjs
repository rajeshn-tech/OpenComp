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

const numWorkers = 4;
const workerFile = path.join(workspace, 'scratch/zd_worker_full.mjs');

fs.writeFileSync(workerFile, `
import { parentPort, workerData } from 'worker_threads';

const { w, h, numSamples, offDX, offDY, sharedControl, sharedOut, sharedSrc, sharedDepth, sharedCoC, sharedBloom } = workerData;

const control = new Int32Array(sharedControl);
const outData = new Float32Array(sharedOut);
const srcData = new Float32Array(sharedSrc);
const depthData = new Float32Array(sharedDepth);
const cocMap = new Float32Array(sharedCoC);
const bloomMap = sharedBloom ? new Float32Array(sharedBloom) : null;

const workerIdx = workerData.workerIdx;
const statusIdx = workerIdx * 8; // status, startY, endY, command, focusPlaneF32, halfDofF32, normFactorF32, bloomFactorF32

// Signal ready
Atomics.store(control, statusIdx, 1);

const sampleShiftsX = new Int32Array(numSamples);
const sampleShiftsY = new Int32Array(numSamples);
const sampleLinearOffset = new Int32Array(numSamples);

// Reusable float view for parameters
const paramBuf = new SharedArrayBuffer(16);
const paramF32 = new Float32Array(paramBuf);
const paramI32 = new Int32Array(paramBuf);

while (true) {
  Atomics.wait(control, statusIdx + 3, 0); // wait for command !== 0
  const cmd = Atomics.load(control, statusIdx + 3);
  if (cmd === 0 || cmd === 2) break; // exit

  const startY = Atomics.load(control, statusIdx + 1);
  const endY = Atomics.load(control, statusIdx + 2);

  // Command 1: Compute CoC and Bloom for [startY, endY]
  if (cmd === 1) {
    paramI32[0] = Atomics.load(control, statusIdx + 4);
    paramI32[1] = Atomics.load(control, statusIdx + 5);
    paramI32[2] = Atomics.load(control, statusIdx + 6);
    paramI32[3] = Atomics.load(control, statusIdx + 7);

    const fp = paramF32[0];
    const hd = paramF32[1];
    const invNorm = paramF32[2];
    const bf = paramF32[3];
    const maxDef = hd * 2.0; // dummy or passed
    const normFactor = 1.0 / invNorm;
    const maxDefocusVal = 14.0; // passed in param

    const startIdx = startY * w;
    const endIdx = endY * w;

    // 1. CoC Map
    for (let i = startIdx; i < endIdx; i++) {
      const z = depthData[i * 4];
      const delta = Math.abs(z - fp) - hd;
      if (delta <= 0) {
        cocMap[i] = 0;
      } else {
        const cocNorm = delta < normFactor ? delta * invNorm : 1.0;
        cocMap[i] = cocNorm * 14.0;
      }
    }

    // 2. Bloom Map
    if (bloomMap && bf > 0.0001) {
      for (let i = startIdx; i < endIdx; i++) {
        const sp4 = i * 4;
        const luma = srcData[sp4] * 0.2126 + srcData[sp4 + 1] * 0.7152 + srcData[sp4 + 2] * 0.0722;
        bloomMap[i] = 1.0 + Math.max(0.0, luma - 0.7) * bf;
      }
    }

    // Signal done phase 1
    Atomics.store(control, statusIdx, 2);
    Atomics.store(control, statusIdx + 3, 0);
    Atomics.notify(control, statusIdx, 1);
    continue;
  }

  // Command 3: Convolution for [startY, endY]
  if (cmd === 3) {
    let lastCoC = -999.0;
    let maxShiftX = 0;
    let maxShiftY = 0;
    const hasBloom = bloomMap !== null;

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
    Atomics.store(control, statusIdx + 3, 0);
    Atomics.notify(control, statusIdx, 1);
    continue;
  }
}
`);

// Setup
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

const sharedControl = new SharedArrayBuffer(numWorkers * 8 * 4);
const control = new Int32Array(sharedControl);

const sharedOut = new SharedArrayBuffer(w * h * 4 * 4);
const sharedSrc = new SharedArrayBuffer(w * h * 4 * 4);
const sharedDepth = new SharedArrayBuffer(w * h * 4 * 4);
const sharedCoC = new SharedArrayBuffer(w * h * 4);
const sharedBloom = hasBloom ? new SharedArrayBuffer(w * h * 4) : null;

const workers = [];
for (let i = 0; i < numWorkers; i++) {
  const worker = new Worker(workerFile, {
    workerData: {
      w, h, numSamples, offDX, offDY,
      sharedControl, sharedOut, sharedSrc, sharedDepth, sharedCoC, sharedBloom,
      workerIdx: i
    }
  });
  workers.push(worker);
}

for (let i = 0; i < numWorkers; i++) {
  while (Atomics.load(control, i * 8) !== 1) {}
}

const sharedSrcF32 = new Float32Array(sharedSrc);
const sharedDepthF32 = new Float32Array(sharedDepth);
const sharedOutF32 = new Float32Array(sharedOut);

const paramBuf = new SharedArrayBuffer(16);
const paramF32 = new Float32Array(paramBuf);
const paramI32 = new Int32Array(paramBuf);

function computeFullParallel() {
  // Transfer inputs
  sharedSrcF32.set(inputBuf.data);
  sharedDepthF32.set(depthBuf.data);

  const halfDof = dof * 0.5;
  const normFactor = Math.max(0.01, 1.0 - halfDof);
  const invNormFactor = 1.0 / normFactor;

  paramF32[0] = focusPlane;
  paramF32[1] = halfDof;
  paramF32[2] = invNormFactor;
  paramF32[3] = bloomFactor;

  const bandHeight = Math.ceil(h / numWorkers);

  // Phase 1: CoC + Bloom in parallel
  for (let i = 0; i < numWorkers; i++) {
    const startY = i * bandHeight;
    const endY = Math.min(h, (i + 1) * bandHeight);
    const sIdx = i * 8;
    Atomics.store(control, sIdx + 1, startY);
    Atomics.store(control, sIdx + 2, endY);
    Atomics.store(control, sIdx + 4, paramI32[0]);
    Atomics.store(control, sIdx + 5, paramI32[1]);
    Atomics.store(control, sIdx + 6, paramI32[2]);
    Atomics.store(control, sIdx + 7, paramI32[3]);

    Atomics.store(control, sIdx, 1);
    Atomics.store(control, sIdx + 3, 1); // cmd = 1
    Atomics.notify(control, sIdx + 3, 1);
  }

  for (let i = 0; i < numWorkers; i++) {
    const sIdx = i * 8;
    while (Atomics.load(control, sIdx) !== 2) {
      Atomics.wait(control, sIdx, 1, 100);
    }
  }

  // Phase 2: Convolution in parallel
  for (let i = 0; i < numWorkers; i++) {
    const startY = i * bandHeight;
    const endY = Math.min(h, (i + 1) * bandHeight);
    const sIdx = i * 8;
    Atomics.store(control, sIdx + 1, startY);
    Atomics.store(control, sIdx + 2, endY);

    Atomics.store(control, sIdx, 1);
    Atomics.store(control, sIdx + 3, 3); // cmd = 3
    Atomics.notify(control, sIdx + 3, 1);
  }

  for (let i = 0; i < numWorkers; i++) {
    const sIdx = i * 8;
    while (Atomics.load(control, sIdx) !== 2) {
      Atomics.wait(control, sIdx, 1, 100);
    }
  }

  const outBuf = new PixelBuffer(w, h);
  outBuf.data.set(sharedOutF32);
  return outBuf;
}

// Warmup
computeFullParallel();

console.log('Running 5 iterations Full-Parallel benchmark:');
const times = [];
for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  computeFullParallel();
  const dt = performance.now() - t0;
  times.push(dt);
  console.log(`Run ${i + 1}: ${dt.toFixed(2)} ms`);
}
const mean = times.reduce((a, b) => a + b, 0) / 5;
console.log(`Full-Parallel Mean: ${mean.toFixed(2)} ms (vs 465 ms baseline: ${(465 / mean).toFixed(2)}x speedup)`);

// Clean up
for (let i = 0; i < numWorkers; i++) {
  const sIdx = i * 8;
  Atomics.store(control, sIdx + 3, 2);
  Atomics.notify(control, sIdx + 3, 1);
  await workers[i].terminate();
}

