import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { GradeNode } = await import('file:///' + path.join(workspace, 'src/nodes/GradeNode.js').replace(/\\/g, '/'));
const { Graph } = await import('file:///' + path.join(workspace, 'src/core/Graph.js').replace(/\\/g, '/'));
const { createNode } = await import('file:///' + path.join(workspace, 'src/core/NodeRegistry.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));
const { PixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));

console.log('======================================================================');
console.log('⚡ INDEPENDENT BENCHMARK VERIFICATION: GRADE NODES & FULL 15-NODE DAG');
console.log('======================================================================\n');

// Original unoptimized compute function for direct before/after comparison
function originalGradeCompute(inputBuf, knobs) {
  const bp = Number(knobs.blackpoint ?? 0.0);
  const wp = Math.max(0.0001, Number(knobs.whitepoint ?? 1.0));
  const lift = Number(knobs.lift ?? 0.0);
  const gain = Number(knobs.gain ?? 1.0);
  const mult = Number(knobs.multiply ?? 1.0);
  const offset = Number(knobs.offset ?? 0.0);
  const gamma = Math.max(0.0001, Number(knobs.gamma ?? 1.0));
  const blackClamp = !!knobs.blackClamp;
  const whiteClamp = !!knobs.whiteClamp;

  const denom = (wp - bp) === 0 ? 0.00001 : (wp - bp);
  const A = mult * (gain - lift) / denom;
  const B = offset + lift - A * bp;
  const invGamma = 1.0 / gamma;
  const isLinearGamma = Math.abs(gamma - 1.0) < 1e-5;

  const out = new PixelBuffer(inputBuf.width, inputBuf.height);
  const src = inputBuf.data;
  const dst = out.data;
  const len = src.length;

  if (isLinearGamma) {
    for (let i = 0; i < len; i += 4) {
      let r = A * src[i] + B;
      let g = A * src[i + 1] + B;
      let b = A * src[i + 2] + B;
      if (blackClamp) { if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0; }
      if (whiteClamp) { if (r > 1) r = 1; if (g > 1) g = 1; if (b > 1) b = 1; }
      dst[i] = r; dst[i+1] = g; dst[i+2] = b; dst[i+3] = src[i+3];
    }
  } else {
    for (let i = 0; i < len; i += 4) {
      let r = A * src[i] + B;
      let g = A * src[i + 1] + B;
      let b = A * src[i + 2] + B;
      if (r > 0) r = Math.pow(r, invGamma); else if (blackClamp) r = 0;
      if (g > 0) g = Math.pow(g, invGamma); else if (blackClamp) g = 0;
      if (b > 0) b = Math.pow(b, invGamma); else if (blackClamp) g = 0;
      if (whiteClamp) { if (r > 1) r = 1; if (g > 1) g = 1; if (b > 1) b = 1; }
      dst[i] = r; dst[i+1] = g; dst[i+2] = b; dst[i+3] = src[i+3];
    }
  }
  return out;
}

const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const plateBuf = ImageIO.readEXR(fs.readFileSync(bgPath));
console.log(`Plate loaded: 1920x1080 (8,294,400 floats)\n`);

const gradeConfigs = [
  { name: 'Grade_Atmosphere', knobs: { lift: 0.04, gain: 1.02, gamma: 0.98, blackClamp: true, whiteClamp: false } },
  { name: 'Grade_FilmMaster', knobs: { lift: 0.015, gain: 1.05, gamma: 1.05, blackClamp: true, whiteClamp: false } },
  { name: 'Grade_Rim',        knobs: { gain: 1.25, gamma: 1.06, blackClamp: true, whiteClamp: false } },
  { name: 'Linear Grade',     knobs: { lift: 0.1, gain: 1.5, gamma: 1.0, blackClamp: true, whiteClamp: false } }
];

console.log('1. Individual Grade Nodes (5 Runs Each, Identical Warmup & Inputs):');
console.log('-----------------------------------------------------------------------------------------');
console.log('Node Name            | Original (mean) | Optimized (mean)| Speedup | Min (Opt)   | Max (Opt)');
console.log('-----------------------------------------------------------------------------------------');

for (const cfg of gradeConfigs) {
  const node = new GradeNode(cfg.name);
  for (const [k, v] of Object.entries(cfg.knobs)) node.setKnobValue(k, v);

  // Warmup both
  originalGradeCompute(plateBuf, cfg.knobs);
  node.compute({ in: plateBuf });

  const origTimes = [];
  const optTimes = [];
  const RUNS = 5;

  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    originalGradeCompute(plateBuf, cfg.knobs);
    origTimes.push(performance.now() - t0);

    const t1 = performance.now();
    node.compute({ in: plateBuf });
    optTimes.push(performance.now() - t1);
  }

  const meanOrig = origTimes.reduce((a, b) => a + b, 0) / RUNS;
  const meanOpt = optTimes.reduce((a, b) => a + b, 0) / RUNS;
  const minOpt = Math.min(...optTimes);
  const maxOpt = Math.max(...optTimes);
  const speedup = meanOrig / meanOpt;

  console.log(`${cfg.name.padEnd(20)} | ${meanOrig.toFixed(2).padStart(12)} ms | ${meanOpt.toFixed(2).padStart(12)} ms | ${speedup.toFixed(2).padStart(6)}x | ${minOpt.toFixed(2).padStart(8)} ms | ${maxOpt.toFixed(2).padStart(8)} ms`);
}
console.log('-----------------------------------------------------------------------------------------\n');

// 2. Full 15-node VFX Showcase DAG Execution
const projectPath = path.join(workspace, 'demo/vfx_showcase/cinematic_vfx_shot.opencomp');
const projectData = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

const graph = new Graph();
graph.deserialize(projectData, createNode);

// Preload frame 1 for read nodes
for (const n of graph.getAllNodes().filter(n => n.type === 'Read')) {
  const pattern = n.getKnobValue('file');
  if (pattern) {
    const f1Path = path.join(workspace, ImageIO.resolveSequenceFrame(pattern, 1));
    n.setSequenceFrame(1, ImageIO.readEXR(fs.readFileSync(f1Path)));
  }
}

const order = graph.getTopologicalOrder();

function executeGraphUncached() {
  // STRICT CACHE PURGE: Every node cache invalidated
  for (const n of graph.getAllNodes()) {
    n.cachedBuffer = null;
    n.isDirty = true;
  }
  const timings = {};
  for (const id of order) {
    const node = graph.getNode(id);
    const inputs = {};
    for (const input of node.inputs) {
      if (input.connection) {
        inputs[input.id] = graph.getNode(input.connection.nodeId).cachedBuffer;
      }
    }
    const t0 = performance.now();
    const out = node.compute(inputs, { frame: 1 });
    const dt = performance.now() - t0;
    timings[id] = dt;
    node.cachedBuffer = out;
    node.isDirty = false;
  }
  const total = Object.values(timings).reduce((a, b) => a + b, 0);
  return { total, timings };
}

// Warmup 1 run
executeGraphUncached();

console.log('2. Full 15-Node VFX Showcase DAG Execution (Cache Purged Every Run):');
const dagRuns = [];
const memSnapshots = [];

for (let r = 0; r < 3; r++) {
  const memBefore = process.memoryUsage().heapUsed / (1024 * 1024);
  const result = executeGraphUncached();
  const memAfter = process.memoryUsage().heapUsed / (1024 * 1024);
  dagRuns.push(result);
  memSnapshots.push({ before: memBefore, after: memAfter, delta: memAfter - memBefore });
  console.log(`   - Run ${r + 1}: ${result.total.toFixed(2)} ms (Heap: ${memBefore.toFixed(2)} -> ${memAfter.toFixed(2)} MB, Delta: ${memSnapshots[r].delta.toFixed(2)} MB)`);
}

const avgDAGTime = dagRuns.reduce((a, b) => a + b.total, 0) / dagRuns.length;
const effectiveFPS = 1000 / avgDAGTime;

console.log(`\n   - Mean Uncached 15-Node DAG Time: ${avgDAGTime.toFixed(2)} ms`);
console.log(`   - Effective Uncached Render FPS:  ${effectiveFPS.toFixed(2)} FPS`);
console.log(`   - Milestone 0 Pre-Optimization:   ~5,379.42 ms (~0.19 FPS)`);
console.log(`   - Milestone 1 (ZDefocus):         ~2,268.65 ms (~0.44 FPS)`);
console.log(`   - Milestone 2 Speedup vs M0:      ${(5379.42 / avgDAGTime).toFixed(2)}x faster`);
console.log(`   - Milestone 2 Speedup vs M1:      ${(2268.65 / avgDAGTime).toFixed(2)}x faster\n`);

console.log('3. Mean Per-Node Execution Breakdown (from Run 3):');
const entries = Object.entries(dagRuns[2].timings).map(([id, time]) => ({
  id,
  type: graph.getNode(id).type,
  time
})).sort((a, b) => b.time - a.time);

for (const item of entries) {
  console.log(`   - ${item.id.padEnd(22)} (${item.type.padEnd(12)}): ${item.time.toFixed(2).padStart(8)} ms`);
}

