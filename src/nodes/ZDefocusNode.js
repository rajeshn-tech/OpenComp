/**
 * OpenComp - ZDefocus Node
 * Depth-of-field optical defocus driven by 32-bit floating-point Z-depth map.
 * Simulates physical lens aperture, circle of confusion (CoC), and anamorphic bokeh.
 * Optimized with high-performance multi-threaded CPU parallel execution & SIMD-friendly inner paths.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer, TiledPixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

let WorkerClass = null;
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  try {
    const wt = await import('node:worker_threads');
    WorkerClass = wt.Worker;
  } catch (e) {
    WorkerClass = null;
  }
}

/**
 * Worker thread routine for parallel ZDefocus execution
 */
const ZDEFOCUS_WORKER_CODE = `
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

// Signal worker ready
Atomics.store(control, statusIdx, 1);

while (true) {
  Atomics.wait(control, statusIdx + 3, 0);
  const cmd = Atomics.load(control, statusIdx + 3);
  Atomics.store(control, statusIdx + 3, 0); // Consume command immediately
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

  // Phase 1a: CoC Map
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

  // Phase 1b: Bloom Map
  if (hasBloom) {
    for (let i = startIdx; i < endIdx; i++) {
      const sp4 = i * 4;
      const luma = srcData[sp4] * 0.2126 + srcData[sp4 + 1] * 0.7152 + srcData[sp4 + 2] * 0.0722;
      bloomMap[i] = 1.0 + Math.max(0.0, luma - 0.7) * bloomFactor;
    }
  }

  // Signal Phase 1 Complete
  Atomics.store(control, statusIdx, 2);
  Atomics.notify(control, statusIdx, 1);

  // Wait for Phase 2 command
  Atomics.wait(control, statusIdx + 3, 0);
  const cmd2 = Atomics.load(control, statusIdx + 3);
  Atomics.store(control, statusIdx + 3, 0); // Consume command 2 immediately
  if (cmd2 === 0 || cmd2 === 99) break;

  // Precompute Poisson disc
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
  Atomics.notify(control, statusIdx, 1);
}
`;

/**
 * Singleton persistent multi-threaded pool for CPU optical defocus
 */
export class ZDefocusThreadPool {
  constructor(numWorkers = 4) {
    this.numWorkers = numWorkers;
    this.allocatedCapacity = 0;
    this.workers = [];
    this.ready = false;
  }

  ensureCapacity(width, height) {
    const requiredPixels = width * height;
    if (this.allocatedCapacity >= requiredPixels && this.ready) return;

    this.allocatedCapacity = Math.max(requiredPixels, 1920 * 1080);
    const byteLenRGBA = this.allocatedCapacity * 4 * 4;
    const byteLenScalar = this.allocatedCapacity * 4;

    this.sharedControl = new SharedArrayBuffer(this.numWorkers * 8 * 4);
    this.control = new Int32Array(this.sharedControl);

    this.sharedOut = new SharedArrayBuffer(byteLenRGBA);
    this.sharedSrc = new SharedArrayBuffer(byteLenRGBA);
    this.sharedDepth = new SharedArrayBuffer(byteLenRGBA);
    this.sharedCoC = new SharedArrayBuffer(byteLenScalar);
    this.sharedBloom = new SharedArrayBuffer(byteLenScalar);
    this.sharedParams = new SharedArrayBuffer(16 * 4); // 16 floats

    this.sharedOutF32 = new Float32Array(this.sharedOut);
    this.sharedSrcF32 = new Float32Array(this.sharedSrc);
    this.sharedDepthF32 = new Float32Array(this.sharedDepth);
    this.paramF32 = new Float32Array(this.sharedParams);

    this.restartWorkers();
  }

  restartWorkers() {
    for (const wrk of this.workers) {
      try { wrk.terminate(); } catch (_) {}
    }
    this.workers = [];

    const numSamples = 24;
    for (let i = 0; i < this.numWorkers; i++) {
      const wrk = new WorkerClass(ZDEFOCUS_WORKER_CODE, {
        eval: true,
        workerData: {
          numSamples,
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
      wrk.unref(); // Do not prevent process exit
      wrk.on('error', () => { this.ready = false; });
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

    // Phase 1: CoC calculation across workers
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
      let waitCount = 0;
      while (Atomics.load(this.control, sIdx) !== 2) {
        Atomics.wait(this.control, sIdx, 1, 100);
        waitCount++;
        if (waitCount > 100) {
          this.restartWorkers();
          throw new Error(`ZDefocus worker thread ${i} timed out in Phase 1`);
        }
      }
    }

    // Phase 2: Highlight bloom + Convolution across workers
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
      let waitCount = 0;
      while (Atomics.load(this.control, sIdx) !== 2) {
        Atomics.wait(this.control, sIdx, 1, 100);
        waitCount++;
        if (waitCount > 100) {
          this.restartWorkers();
          throw new Error(`ZDefocus worker thread ${i} timed out in Phase 2`);
        }
      }
    }

    const outBuf = new PixelBuffer(w, h);
    outBuf.data.set(this.sharedOutF32.subarray(0, w * h * 4));
    return outBuf;
  }
}

let globalThreadPool = null;

export class ZDefocusNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'ZDefocus', 'Filter', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input Image');
    this.addInput('depth', 'depth', 'Depth Map (Z)');

    this.addKnob('focusPlane', 'Focus Plane (Z)', 'number', 0.5, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('depthOfField', 'Depth of Field', 'number', 0.1, { min: 0.0, max: 0.5, step: 0.01 });
    this.addKnob('maxDefocus', 'Max Blur Radius', 'number', 12.0, { min: 0.0, max: 64.0, step: 1.0 });
    this.addKnob('aspectRatio', 'Bokeh Aspect Ratio', 'number', 1.0, { min: 0.5, max: 3.0, step: 0.1 });
    this.addKnob('bloom', 'Highlight Bloom', 'number', 0.2, { min: 0.0, max: 2.0, step: 0.05 });
  }

  /**
   * Determine output dynamic BBox: expands input by bokeh aperture radius
   * @param {Object.<string, PixelBuffer>} inputs 
   * @param {Object} [context={}] 
   * @returns {BBox}
   */
  getBBox(inputs, context = {}) {
    const inputBuf = inputs['in'] || inputs['input'];
    if (!inputBuf) return new BBox(0, 0, 0, 0);

    const box = inputBuf.bbox ? inputBuf.bbox.clone() : BBox.fromFormat(inputBuf.width, inputBuf.height);
    const depthBuf = inputs['depth'];
    const maxDefocus = Math.max(0.0, Number(this.getKnobValue('maxDefocus', context)) ?? 12.0);
    const aspect = Math.max(0.1, Number(this.getKnobValue('aspectRatio', context)) ?? 1.0);

    if (maxDefocus <= 0.01 || !depthBuf) return box;

    const padX = Math.ceil(maxDefocus * aspect);
    const padY = Math.ceil(maxDefocus);
    return box.expanded(padX, padY);
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    const depthBuf = inputs['depth'];
    const focusPlane = Number(this.getKnobValue('focusPlane', context)) ?? 0.5;
    const dof = Number(this.getKnobValue('depthOfField', context)) ?? 0.1;
    const maxDefocus = Math.max(0, Number(this.getKnobValue('maxDefocus', context)) ?? 12.0);
    const aspect = Math.max(0.1, Number(this.getKnobValue('aspectRatio', context)) ?? 1.0);
    const bloom = Math.max(0, Number(this.getKnobValue('bloom', context)) ?? 0.2);

    if (maxDefocus <= 0.001 || !depthBuf) {
      return inputBuf.clone();
    }

    const w = inputBuf.width;
    const h = inputBuf.height;

    // 1. Tiled Buffer Execution
    if (inputBuf.isTiled) {
      const outBuf = new TiledPixelBuffer(w, h, inputBuf.tileSize);
      const halfDof = dof * 0.5;
      const normFactor = Math.max(0.01, 1.0 - halfDof);
      const invNormFactor = 1.0 / normFactor;
      const R = Math.ceil(maxDefocus) + 2;

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

      const sampleShiftsX = new Int32Array(numSamples);
      const sampleShiftsY = new Int32Array(numSamples);
      const bloomFactor = bloom * 2.0;
      const hasBloom = bloomFactor > 0.0001;

      for (let row = 0; row < outBuf.rows; row++) {
        const startY = row * outBuf.tileSize;
        for (let col = 0; col < outBuf.cols; col++) {
          const tile = outBuf.tiles[row][col];
          const startX = col * outBuf.tileSize;
          const tW = tile.width;
          const tH = tile.height;
          const dst = tile.data;

          const apronW = tW + 2 * R;
          const apronH = tH + 2 * R;
          const apronLen = apronW * apronH;
          const srcApron = inputBuf.getRegion(startX - R, startY - R, apronW, apronH, true);
          const depthApron = depthBuf.getRegion(startX - R, startY - R, apronW, apronH, true);
          const srcD = srcApron.data;
          const depthD = depthApron.data;

          const apronCoC = new Float32Array(apronLen);
          for (let i = 0; i < apronLen; i++) {
            const z = depthD[i * 4];
            const delta = Math.abs(z - focusPlane) - halfDof;
            if (delta <= 0.0) {
              apronCoC[i] = 0.0;
            } else {
              apronCoC[i] = (delta < normFactor ? delta * invNormFactor : 1.0) * maxDefocus;
            }
          }

          let apronBloom = null;
          if (hasBloom) {
            apronBloom = new Float32Array(apronLen);
            for (let i = 0; i < apronLen; i++) {
              const sp4 = i * 4;
              const lum = 0.2126 * srcD[sp4] + 0.7152 * srcD[sp4 + 1] + 0.0722 * srcD[sp4 + 2];
              apronBloom[i] = 1.0 + Math.max(0.0, lum - 0.7) * bloomFactor;
            }
          }

          let lastCoC = -999.0;
          for (let ty = 0; ty < tH; ty++) {
            const ay = ty + R;
            const globalY = startY + ty;
            for (let tx = 0; tx < tW; tx++) {
              const ax = tx + R;
              const globalX = startX + tx;
              const aIdx = ay * apronW + ax;
              const centerCoC = apronCoC[aIdx];
              const outP4 = (ty * tW + tx) * 4;

              if (centerCoC < 0.5) {
                const sp4 = aIdx * 4;
                dst[outP4]     = srcD[sp4];
                dst[outP4 + 1] = srcD[sp4 + 1];
                dst[outP4 + 2] = srcD[sp4 + 2];
                dst[outP4 + 3] = srcD[sp4 + 3];
                continue;
              }

              if (centerCoC !== lastCoC) {
                lastCoC = centerCoC;
                for (let s = 0; s < numSamples; s++) {
                  sampleShiftsX[s] = Math.round(offDX[s] * centerCoC);
                  sampleShiftsY[s] = Math.round(offDY[s] * centerCoC);
                }
              }

              const invCenterCoC = 1.0 / centerCoC;
              let accR = 0, accG = 0, accB = 0, accA = 0;
              let totalWeight = 0;

              for (let s = 0; s < numSamples; s++) {
                const shiftX = sampleShiftsX[s];
                const shiftY = sampleShiftsY[s];
                const gx = globalX + shiftX;
                const gy = globalY + shiftY;

                if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
                  const asx = ax + shiftX;
                  const asy = ay + shiftY;

                  if (asx >= 0 && asx < apronW && asy >= 0 && asy < apronH) {
                    const sIdx = asy * apronW + asx;
                    const sCoC = apronCoC[sIdx];
                    const sp4 = sIdx * 4;

                    const cocWeight = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, 1.0 - (centerCoC - sCoC) * invCenterCoC);
                    const bloomWeight = hasBloom ? apronBloom[sIdx] : 1.0;
                    const w_s = cocWeight * bloomWeight;

                    accR += srcD[sp4] * w_s;
                    accG += srcD[sp4 + 1] * w_s;
                    accB += srcD[sp4 + 2] * w_s;
                    accA += srcD[sp4 + 3] * w_s;
                    totalWeight += w_s;
                  }
                }
              }

              if (totalWeight > 0) {
                const invTotal = 1.0 / totalWeight;
                dst[outP4]     = accR * invTotal;
                dst[outP4 + 1] = accG * invTotal;
                dst[outP4 + 2] = accB * invTotal;
                dst[outP4 + 3] = accA * invTotal;
              } else {
                const sp4 = aIdx * 4;
                dst[outP4]     = srcD[sp4];
                dst[outP4 + 1] = srcD[sp4 + 1];
                dst[outP4 + 2] = srcD[sp4 + 2];
                dst[outP4 + 3] = srcD[sp4 + 3];
              }
            }
          }
        }
      }
      outBuf.bbox = this.getBBox(inputs, context);
      outBuf.copyChannelsFrom(inputBuf);
      if (inputBuf.metadata) {
        outBuf.metadata = { ...inputBuf.metadata };
      }
      return outBuf;
    }

    // 2. Contiguous Buffer Execution
    const resampledDepth = (depthBuf.width === w && depthBuf.height === h) 
      ? depthBuf 
      : depthBuf.resample(w, h);

    // Multi-Threaded Acceleration for large resolutions (720p, 1080p, 2K, 4K)
    const pixelCount = w * h;
    if (WorkerClass && pixelCount >= 500000) {
      try {
        if (!globalThreadPool) {
          globalThreadPool = new ZDefocusThreadPool(4);
        }
        const outBuf = globalThreadPool.execute(inputBuf, resampledDepth, focusPlane, dof, maxDefocus, aspect, bloom);
        outBuf.bbox = this.getBBox(inputs, context);
        outBuf.copyChannelsFrom(inputBuf);
        if (inputBuf.metadata) {
          outBuf.metadata = { ...inputBuf.metadata };
        }
        return outBuf;
      } catch (err) {
        // Graceful fallback to single-threaded if worker initialization fails
      }
    }

    // Single-Threaded Optimized Path (used for smaller images or environment fallback)
    const outBuf = new PixelBuffer(w, h);
    const outData = outBuf.data;
    const srcData = inputBuf.data;
    const depthData = resampledDepth.data;

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

    outBuf.bbox = this.getBBox(inputs, context);
    outBuf.copyChannelsFrom(inputBuf);
    if (inputBuf.metadata) {
      outBuf.metadata = { ...inputBuf.metadata };
    }
    return outBuf;
  }
}
