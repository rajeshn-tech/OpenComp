import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { GradeNode } = await import('file:///' + path.join(workspace, 'src/nodes/GradeNode.js').replace(/\\/g, '/'));
const { ZDefocusNode } = await import('file:///' + path.join(workspace, 'src/nodes/ZDefocusNode.js').replace(/\\/g, '/'));
const { Graph } = await import('file:///' + path.join(workspace, 'src/core/Graph.js').replace(/\\/g, '/'));
const { createNode } = await import('file:///' + path.join(workspace, 'src/core/NodeRegistry.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

console.log('======================================================================');
console.log('⚡ MILESTONE 2 BENCHMARK: GRADE NODE OPTIMIZATION & FULL SHOWCASE DAG');
console.log('======================================================================\n');

// 1. Grade Nodes Individually on 1080p Plate (1920x1080, 8.29M floats)
const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const plateBuf = ImageIO.readEXR(fs.readFileSync(bgPath));

const gradeNodes = [
  { name: 'Grade_Atmosphere', knobs: { lift: 0.04, gain: 1.02, gamma: 0.98, blackClamp: true, whiteClamp: false }, baseline: 364.20 },
  { name: 'Grade_FilmMaster', knobs: { lift: 0.015, gain: 1.05, gamma: 1.05, blackClamp: true, whiteClamp: false }, baseline: 338.89 },
  { name: 'Grade_Rim', knobs: { gain: 1.25, gamma: 1.06, blackClamp: true, whiteClamp: false }, baseline: 275.98 },
  { name: 'Linear Grade', knobs: { lift: 0.1, gain: 1.5, gamma: 1.0, blackClamp: true, whiteClamp: false }, baseline: 64.39 }
];

console.log('1. Individual Grade Nodes (1920x1080, Uncached CPU Evaluation):');
const gradeResults = {};
for (const g of gradeNodes) {
  const node = new GradeNode(g.name);
  for (const [k, v] of Object.entries(g.knobs)) {
    node.setKnobValue(k, v);
  }
  // Warmup 1 run
  node.compute({ in: plateBuf });

  const mem0 = process.memoryUsage();
  const t0 = performance.now();
  const out = node.compute({ in: plateBuf });
  const dt = performance.now() - t0;
  const mem1 = process.memoryUsage();

  gradeResults[g.name] = dt;
  const spd = g.baseline / dt;
  console.log(`   - ${g.name.padEnd(20)}: ${dt.toFixed(2).padStart(8)} ms | Baseline: ${g.baseline.toFixed(2).padStart(8)} ms | Speedup: ${spd.toFixed(2)}x faster`);
}

// 2. Full 15-node VFX Showcase DAG
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

function executeGraph(clearCache = false) {
  if (clearCache) {
    for (const n of graph.getAllNodes()) {
      n.cachedBuffer = null;
      n.isDirty = true;
    }
  }
  const timings = {};
  for (const id of order) {
    const node = graph.getNode(id);
    if (!node.isDirty && node.cachedBuffer) {
      timings[id] = 0;
      continue;
    }
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
executeGraph(true);

console.log(`\n2. Full 15-Node VFX Showcase DAG Execution (1920x1080):`);
const memBeforeDAG = process.memoryUsage();
const uncachedResult = executeGraph(true);
const memAfterDAG = process.memoryUsage();

console.log(`   - Uncached 15-Node DAG Time:       ${uncachedResult.total.toFixed(2)} ms`);
console.log(`   - Pre-Optimization DAG Time (M0):  ~5,379.42 ms`);
console.log(`   - Milestone 1 DAG Time:            ~2,268.65 ms`);
console.log(`   - Cumulative Speedup vs Baseline:  ${(5379.42 / uncachedResult.total).toFixed(2)}x faster!`);
console.log(`   - Speedup vs Milestone 1:          ${(2268.65 / uncachedResult.total).toFixed(2)}x faster`);
console.log(`   - Uncached Effective Frame Rate:   ${(1000 / uncachedResult.total).toFixed(2)} FPS`);

// Cached playback test
const cachedRuns = 100;
const tCache0 = performance.now();
for (let c = 0; c < cachedRuns; c++) {
  executeGraph(false);
}
const tCache1 = performance.now();
const avgCacheTime = (tCache1 - tCache0) / cachedRuns;
const cachedFPS = 1000 / avgCacheTime;
console.log(`   - Cached Evaluation Time:          ${avgCacheTime.toFixed(4)} ms`);
console.log(`   - Cached Playback Throughput:      ${cachedFPS.toFixed(1)} FPS`);
console.log(`   - Heap Used Before DAG:            ${(memBeforeDAG.heapUsed / (1024 * 1024)).toFixed(2)} MB`);
console.log(`   - Heap Used After DAG:             ${(memAfterDAG.heapUsed / (1024 * 1024)).toFixed(2)} MB\n`);

console.log(`3. Per-Node DAG Execution Breakdown (15 Nodes):`);
const entries = Object.entries(uncachedResult.timings).map(([id, time]) => ({
  id,
  type: graph.getNode(id).type,
  time
})).sort((a, b) => b.time - a.time);

for (const item of entries) {
  console.log(`   - ${item.id.padEnd(22)} (${item.type.padEnd(12)}): ${item.time.toFixed(2).padStart(8)} ms`);
}

