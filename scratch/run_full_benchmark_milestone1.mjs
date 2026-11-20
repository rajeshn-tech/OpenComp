import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { ZDefocusNode } = await import('file:///' + path.join(workspace, 'src/nodes/ZDefocusNode.js').replace(/\\/g, '/'));
const { Graph } = await import('file:///' + path.join(workspace, 'src/core/Graph.js').replace(/\\/g, '/'));
const { createNode } = await import('file:///' + path.join(workspace, 'src/core/NodeRegistry.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

console.log('====================================================');
console.log('⚡ MILESTONE 1 BENCHMARK: ZDEFOCUS & FULL SHOWCASE DAG');
console.log('====================================================\n');

// 1. ZDefocus Alone on 1080p Plate
const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const depthPath = path.join(workspace, 'demo/vfx_showcase/depth/depth_pass.0001.exr');

const inputBuf = ImageIO.readEXR(fs.readFileSync(bgPath));
const depthBuf = ImageIO.readEXR(fs.readFileSync(depthPath));

const zdNode = new ZDefocusNode('ZD_bench');
zdNode.setKnobValue('focusPlane', 0.5);
zdNode.setKnobValue('depthOfField', 0.12);
zdNode.setKnobValue('maxDefocus', 14.0);
zdNode.setKnobValue('aspectRatio', 1.0);
zdNode.setKnobValue('bloom', 0.25);

// Warmup
zdNode.compute({ in: inputBuf, depth: depthBuf }, { frame: 1 });

const memBeforeZD = process.memoryUsage();
const tZD0 = performance.now();
const zdOut = zdNode.compute({ in: inputBuf, depth: depthBuf }, { frame: 1 });
const tZD1 = performance.now();
const memAfterZD = process.memoryUsage();
const zdTime = tZD1 - tZD0;

console.log(`1. ZDefocus Node Alone (1920x1080, 24 samples, Poisson-disc):`);
console.log(`   - Optimized Compute Time: ${zdTime.toFixed(2)} ms`);
console.log(`   - Reference Pre-Optimization: ~5,450.15 ms (warmed) / ~7,008.77 ms (unwarmed)`);
console.log(`   - Speedup Factor: ${(5450.15 / zdTime).toFixed(2)}x faster!`);
console.log(`   - Heap Used Before: ${(memBeforeZD.heapUsed / (1024 * 1024)).toFixed(2)} MB`);
console.log(`   - Heap Used After:  ${(memAfterZD.heapUsed / (1024 * 1024)).toFixed(2)} MB`);
console.log(`   - Heap Delta:       ${((memAfterZD.heapUsed - memBeforeZD.heapUsed) / (1024 * 1024)).toFixed(2)} MB\n`);

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

// Invalidate cache
for (const n of graph.getAllNodes()) {
  n.cachedBuffer = null;
  n.isDirty = true;
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

console.log(`2. Full 15-node VFX Showcase DAG Execution:`);
const memBeforeDAG = process.memoryUsage();
const uncachedResult = executeGraph(true);
const memAfterDAG = process.memoryUsage();

console.log(`   - Uncached Full 15-Node DAG Time: ${uncachedResult.total.toFixed(2)} ms`);
console.log(`   - Pre-Optimization DAG Time:      ~5,379.42 ms`);
console.log(`   - Full DAG Speedup:               ${(5379.42 / uncachedResult.total).toFixed(2)}x faster!`);
console.log(`   - Uncached Effective Frame Rate:  ${(1000 / uncachedResult.total).toFixed(2)} FPS`);

// Cached playback test
const cachedRuns = 100;
const tCache0 = performance.now();
for (let c = 0; c < cachedRuns; c++) {
  executeGraph(false);
}
const tCache1 = performance.now();
const avgCacheTime = (tCache1 - tCache0) / cachedRuns;
const cachedFPS = 1000 / avgCacheTime;
console.log(`   - Cached Evaluation Time:         ${avgCacheTime.toFixed(4)} ms`);
console.log(`   - Cached Playback Throughput:     ${cachedFPS.toFixed(1)} FPS`);
console.log(`   - Heap Used DAG:                  ${(memAfterDAG.heapUsed / (1024 * 1024)).toFixed(2)} MB\n`);

console.log(`3. Per-Node DAG Execution Breakdown (15 Nodes):`);
const entries = Object.entries(uncachedResult.timings).map(([id, time]) => ({
  id,
  type: graph.getNode(id).type,
  time
})).sort((a, b) => b.time - a.time);

for (const item of entries) {
  console.log(`   - ${item.id.padEnd(22)} (${item.type.padEnd(12)}): ${item.time.toFixed(2).padStart(8)} ms`);
}
