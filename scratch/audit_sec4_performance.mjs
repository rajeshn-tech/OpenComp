import fs from 'node:fs';
import path from 'node:path';
import { ZDefocusNode, ZDefocusThreadPool } from '../src/nodes/ZDefocusNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { ImageIO } from '../src/core/ImageIO.js';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/core/NodeRegistry.js';

console.log('======================================================================');
console.log('📊 AUDIT SECTION 4: CONTROLLED UNCACHED BENCHMARKS (1080p & 4K UHD)');
console.log('======================================================================\n');

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const bgPath = path.resolve('demo/vfx_showcase/source/bg_plate.0001.exr');
const depthPath = path.resolve('demo/vfx_showcase/depth/depth_pass.0001.exr');

const input1080 = ImageIO.readEXR(fs.readFileSync(bgPath));
const depth1080 = ImageIO.readEXR(fs.readFileSync(depthPath));

const focusPlane = 0.5;
const dof = 0.12;
const maxDefocus = 14.0;
const aspect = 1.0;
const bloom = 0.25;

// Single-threaded reference function
function runSingleThreaded(inputBuf, depthBuf) {
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
        for (let s = 0; s < numSamples; s++) {
          const sIdx = centerIdx + sampleLinearOffset[s];
          const sCoC = cocMap[sIdx];
          const sp4 = sIdx * 4;

          const cocWeight = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, 1.0 - (centerCoC - sCoC) * invCenterCoC);
          const bloomWeight = hasBloom ? bloomMap[sIdx] : 1.0;
          const w_s = cocWeight * bloomWeight;

          accR += srcData[sp4] * w_s;
          accG += srcData[sp4 + 1] * w_s;
          accB += srcData[sp4 + 2] * w_s;
          accA += srcData[sp4 + 3] * w_s;
          totalWeight += w_s;
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

function runBenchmarkSeries(name, fn, iterations = 5) {
  // Warmup run
  fn();
  if (global.gc) global.gc();

  const times = [];
  const rssList = [];
  const heapList = [];
  const extList = [];

  for (let i = 0; i < iterations; i++) {
    if (global.gc) global.gc();
    const t0 = performance.now();
    fn();
    const dt = performance.now() - t0;
    const mem = process.memoryUsage();
    times.push(dt);
    rssList.push(mem.rss / (1024 * 1024));
    heapList.push(mem.heapUsed / (1024 * 1024));
    extList.push(mem.external / (1024 * 1024));
  }

  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / iterations;
  const median = sorted[Math.floor(iterations / 2)];
  const min = sorted[0];
  const max = sorted[iterations - 1];
  const peakRss = Math.max(...rssList);
  const peakHeap = Math.max(...heapList);
  const peakExt = Math.max(...extList);

  return { name, times, mean, median, min, max, peakRss, peakHeap, peakExt };
}

// 1. 1080p Single-Threaded
console.log('Running Benchmark 1: 1080p Single-Threaded (5 iterations)...');
const res1080Single = runBenchmarkSeries('1080p Single-Threaded', () => {
  runSingleThreaded(input1080, depth1080);
});

// 2. 1080p 4-Worker Parallel
console.log('Running Benchmark 2: 1080p 4-Worker Parallel (5 iterations)...');
const pool1080 = new ZDefocusThreadPool(4);
const res1080Parallel = runBenchmarkSeries('1080p 4-Worker Parallel', () => {
  pool1080.execute(input1080, depth1080, focusPlane, dof, maxDefocus, aspect, bloom);
});

// 3. 4K UHD Practical Workload Setup
console.log('Setting up 4K UHD (3840x2160) test plate...');
const W_4K = 3840, H_4K = 2160;
const input4K = new PixelBuffer(W_4K, H_4K);
const depth4K = new PixelBuffer(W_4K, H_4K);
// Scale up 1080p plate to 4K
for (let y = 0; y < H_4K; y++) {
  const srcY = Math.floor(y / 2);
  for (let x = 0; x < W_4K; x++) {
    const srcX = Math.floor(x / 2);
    const dstIdx = (y * W_4K + x) * 4;
    const srcIdx = (srcY * 1920 + srcX) * 4;
    input4K.data[dstIdx] = input1080.data[srcIdx];
    input4K.data[dstIdx + 1] = input1080.data[srcIdx + 1];
    input4K.data[dstIdx + 2] = input1080.data[srcIdx + 2];
    input4K.data[dstIdx + 3] = input1080.data[srcIdx + 3];
    depth4K.data[dstIdx] = depth1080.data[srcIdx];
  }
}

// 4. 4K UHD Single-Threaded (3 runs to maintain manageable runtime)
console.log('Running Benchmark 3: 4K UHD Single-Threaded (3 iterations)...');
const res4KSingle = runBenchmarkSeries('4K UHD Single-Threaded', () => {
  runSingleThreaded(input4K, depth4K);
}, 3);

// 5. 4K UHD 4-Worker Parallel
console.log('Running Benchmark 4: 4K UHD 4-Worker Parallel (5 iterations)...');
const pool4K = new ZDefocusThreadPool(4);
const res4KParallel = runBenchmarkSeries('4K UHD 4-Worker Parallel', () => {
  pool4K.execute(input4K, depth4K, focusPlane, dof, maxDefocus, aspect, bloom);
});

// 6. Full 15-Node DAG Uncached Evaluation
console.log('Running Benchmark 5: Full 15-Node DAG (5 uncached iterations)...');
const projectData = JSON.parse(fs.readFileSync(path.join(workspace, 'demo/vfx_showcase/cinematic_vfx_shot.opencomp'), 'utf8'));
const graph = new Graph();
graph.deserialize(projectData, createNode);

for (const n of graph.getAllNodes().filter(n => n.type === 'Read')) {
  const pattern = n.getKnobValue('file');
  if (pattern) {
    const f1Path = path.join(workspace, ImageIO.resolveSequenceFrame(pattern, 1));
    n.setSequenceFrame(1, ImageIO.readEXR(fs.readFileSync(f1Path)));
  }
}

const allNodes = graph.getAllNodes();
const resFullDAG = runBenchmarkSeries('Full 15-Node DAG 1080p', () => {
  for (const n of allNodes) {
    n.cachedBuffer = null;
    n.isDirty = true;
  }
  graph.evaluate('Viewer_Master', { frame: 1 });
});

// Print Tabulated Results
function printResultTable(title, r1, r2) {
  console.log(`\n======================================================================`);
  console.log(`📈 ${title}`);
  console.log(`======================================================================`);
  console.log(`Metric                     | Single-Threaded    | 4-Worker Parallel  | Speedup Ratio`);
  console.log(`-----------------------------------------------------------------------------------`);
  console.log(`Mean Frame Time            | ${(r1.mean.toFixed(2) + ' ms').padEnd(18)} | ${(r2.mean.toFixed(2) + ' ms').padEnd(18)} | ${(r1.mean / r2.mean).toFixed(2)}x`);
  console.log(`Median Frame Time          | ${(r1.median.toFixed(2) + ' ms').padEnd(18)} | ${(r2.median.toFixed(2) + ' ms').padEnd(18)} | ${(r1.median / r2.median).toFixed(2)}x`);
  console.log(`Min Frame Time             | ${(r1.min.toFixed(2) + ' ms').padEnd(18)} | ${(r2.min.toFixed(2) + ' ms').padEnd(18)} | ${(r1.min / r2.min).toFixed(2)}x`);
  console.log(`Max Frame Time             | ${(r1.max.toFixed(2) + ' ms').padEnd(18)} | ${(r2.max.toFixed(2) + ' ms').padEnd(18)} | ${(r1.max / r2.max).toFixed(2)}x`);
  console.log(`Peak Process RSS           | ${(r1.peakRss.toFixed(2) + ' MB').padEnd(18)} | ${(r2.peakRss.toFixed(2) + ' MB').padEnd(18)} | +${(r2.peakRss - r1.peakRss).toFixed(1)} MB`);
  console.log(`Peak V8 Heap Used          | ${(r1.peakHeap.toFixed(2) + ' MB').padEnd(18)} | ${(r2.peakHeap.toFixed(2) + ' MB').padEnd(18)} | ${(r2.peakHeap - r1.peakHeap).toFixed(1)} MB`);
  console.log(`Peak ArrayBuffer Memory    | ${(r1.peakExt.toFixed(2) + ' MB').padEnd(18)} | ${(r2.peakExt.toFixed(2) + ' MB').padEnd(18)} | +${(r2.peakExt - r1.peakExt).toFixed(1)} MB`);
  console.log(`Effective Throughput       | ${((1000 / r1.mean).toFixed(2) + ' FPS').padEnd(18)} | ${((1000 / r2.mean).toFixed(2) + ' FPS').padEnd(18)} | +${((1000 / r2.mean) - (1000 / r1.mean)).toFixed(2)} FPS`);
}

printResultTable('1080p Full Production Plate (1920x1080, 24 Poisson Samples)', res1080Single, res1080Parallel);
printResultTable('4K UHD Production Plate (3840x2160, 24 Poisson Samples)', res4KSingle, res4KParallel);

console.log(`\n======================================================================`);
console.log(`🎬 Full 15-Node Showcase DAG Uncached Evaluation (1080p)`);
console.log(`======================================================================`);
console.log(`Runs:                      ${resFullDAG.times.map(t => t.toFixed(1) + ' ms').join(', ')}`);
console.log(`Mean Frame Time:           ${resFullDAG.mean.toFixed(2)} ms (${(1000 / resFullDAG.mean).toFixed(2)} FPS)`);
console.log(`Median Frame Time:         ${resFullDAG.median.toFixed(2)} ms (${(1000 / resFullDAG.median).toFixed(2)} FPS)`);
console.log(`Min / Max Frame Time:      ${resFullDAG.min.toFixed(2)} ms / ${resFullDAG.max.toFixed(2)} ms`);
console.log(`Peak RSS / Heap / SAB:     ${resFullDAG.peakRss.toFixed(1)} MB / ${resFullDAG.peakHeap.toFixed(1)} MB / ${resFullDAG.peakExt.toFixed(1)} MB`);

// Clean up
for (const wrk of pool1080.workers) { try { wrk.terminate(); } catch (_) {} }
for (const wrk of pool4K.workers) { try { wrk.terminate(); } catch (_) {} }

