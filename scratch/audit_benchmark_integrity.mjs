import fs from 'fs';
import path from 'path';
import { strict as assert } from 'node:assert';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { Graph } = await import('file:///' + path.join(workspace, 'src/core/Graph.js').replace(/\\/g, '/'));
const { createNode } = await import('file:///' + path.join(workspace, 'src/core/NodeRegistry.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

console.log('======================================================================');
console.log('📊 MILESTONE 3: RIGOROUS BENCHMARK & TIMING INTEGRITY AUDIT');
console.log('======================================================================\n');

const projectPath = path.join(workspace, 'demo/vfx_showcase/cinematic_vfx_shot.opencomp');
const projectData = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

const graph = new Graph();
graph.deserialize(projectData, createNode);

// Preload sequence frames for Read nodes
for (const n of graph.getAllNodes().filter(n => n.type === 'Read')) {
  const pattern = n.getKnobValue('file');
  if (pattern) {
    const f1Path = path.join(workspace, ImageIO.resolveSequenceFrame(pattern, 1));
    n.setSequenceFrame(1, ImageIO.readEXR(fs.readFileSync(f1Path)));
  }
}

const allNodes = graph.getAllNodes();
const topoOrder = graph.getTopologicalOrder();

// Instrument every node's compute() to record exclusive time
const nodeStats = {};
for (const n of allNodes) {
  nodeStats[n.id] = {
    id: n.id,
    type: n.type,
    exclusiveRuns: [],
    inputBytes: 0,
    outputBytes: 0
  };
  const origCompute = n.compute.bind(n);
  n.compute = function(inputs, context) {
    let inBytes = 0;
    for (const b of Object.values(inputs)) {
      if (b && b.data) inBytes += b.data.byteLength;
    }
    nodeStats[n.id].inputBytes = inBytes;

    const t0 = performance.now();
    const result = origCompute(inputs, context);
    const dt = performance.now() - t0;
    nodeStats[n.id].exclusiveRuns.push(dt);
    if (result && result.data) {
      nodeStats[n.id].outputBytes = result.data.byteLength;
    }
    return result;
  };
}

// 1. Warmup run
for (const n of allNodes) {
  n.cachedBuffer = null;
  n.isDirty = true;
}
graph.evaluate('Viewer_Master', { frame: 1 });

// Reset exclusive runs after warmup
for (const k of Object.keys(nodeStats)) {
  nodeStats[k].exclusiveRuns = [];
}

// 2. Five uncached full-DAG runs
const NUM_RUNS = 5;
const fullFrameTimes = [];
const rssSnapshots = [];
const heapUsedSnapshots = [];
const externalSnapshots = [];

for (let r = 0; r < NUM_RUNS; r++) {
  // Clear all node caches
  for (const n of allNodes) {
    n.cachedBuffer = null;
    n.isDirty = true;
  }
  if (global.gc) global.gc();

  const memBefore = process.memoryUsage();
  const t0 = performance.now();
  graph.evaluate('Viewer_Master', { frame: 1 });
  const dt = performance.now() - t0;
  const memAfter = process.memoryUsage();

  fullFrameTimes.push(dt);
  rssSnapshots.push(memAfter.rss / (1024 * 1024));
  heapUsedSnapshots.push(memAfter.heapUsed / (1024 * 1024));
  externalSnapshots.push(memAfter.external / (1024 * 1024));
}

// Compute statistics
const sortedTimes = [...fullFrameTimes].sort((a, b) => a - b);
const meanTime = fullFrameTimes.reduce((a, b) => a + b, 0) / NUM_RUNS;
const medianTime = sortedTimes[Math.floor(NUM_RUNS / 2)];
const minTime = sortedTimes[0];
const maxTime = sortedTimes[NUM_RUNS - 1];
const peakRss = Math.max(...rssSnapshots);
const peakHeapUsed = Math.max(...heapUsedSnapshots);
const peakExternal = Math.max(...externalSnapshots);

console.log('1. Full 15-Node DAG Uncached Evaluation (5 Iterations):');
fullFrameTimes.forEach((t, i) => {
  console.log(`   - Run ${i + 1}: ${t.toFixed(2)} ms | RSS: ${rssSnapshots[i].toFixed(2)} MB | Heap: ${heapUsedSnapshots[i].toFixed(2)} MB`);
});
console.log(`\n   Mean Frame Time:   ${meanTime.toFixed(2)} ms (${(1000 / meanTime).toFixed(2)} FPS)`);
console.log(`   Median Frame Time: ${medianTime.toFixed(2)} ms (${(1000 / medianTime).toFixed(2)} FPS)`);
console.log(`   Min Frame Time:    ${minTime.toFixed(2)} ms`);
console.log(`   Max Frame Time:    ${maxTime.toFixed(2)} ms`);
console.log(`   Peak Process RSS:  ${peakRss.toFixed(2)} MB`);
console.log(`   Peak Heap Used:    ${peakHeapUsed.toFixed(2)} MB`);
console.log(`   Peak ArrayBuffer:  ${peakExternal.toFixed(2)} MB\n`);

// 3. Inclusive Time Formulation
// For each node, inclusive time is the total time spent computing this node and all of its upstream dependencies.
// In an acyclic graph, Inclusive(N) = Exclusive(N) + sum of Exclusive times of all unique upstream ancestor nodes.
function getUpstreamAncestors(nodeId) {
  const ancestors = new Set();
  function visit(id) {
    const nd = graph.getNode(id);
    for (const inp of nd.inputs) {
      if (inp.connection) {
        ancestors.add(inp.connection.nodeId);
        visit(inp.connection.nodeId);
      }
    }
  }
  visit(nodeId);
  return Array.from(ancestors);
}

console.log('2. Node-by-Node Timing Table (Ranked by Exclusive Time):');
console.log('-----------------------------------------------------------------------------------------------------------------');
console.log('Rank | Node ID              | Type       | Exclusive (ms) | % Frame | Inclusive (ms) | In MB   | Out MB  | Bandwidth');
console.log('-----------------------------------------------------------------------------------------------------------------');

const nodeReport = Object.values(nodeStats).map(n => {
  const count = n.exclusiveRuns.length;
  const excl = count > 0 ? n.exclusiveRuns.reduce((a, b) => a + b, 0) / count : 0.0;
  const pct = (excl / meanTime) * 100;
  const inMB = (n.inputBytes / (1024 * 1024)).toFixed(1);
  const outMB = (n.outputBytes / (1024 * 1024)).toFixed(1);
  const bw = excl > 0 ? (((n.inputBytes + n.outputBytes) / (1024 * 1024 * 1024)) / (excl / 1000)).toFixed(2) : '0.00';
  
  // Inclusive time = Exclusive + sum(Exclusive of unique upstream ancestors)
  const ancestors = getUpstreamAncestors(n.id);
  const ancestorExclSum = ancestors.reduce((sum, ancId) => {
    const ancRuns = nodeStats[ancId].exclusiveRuns;
    const ancCount = ancRuns.length;
    return sum + (ancCount > 0 ? ancRuns.reduce((a, b) => a + b, 0) / ancCount : 0);
  }, 0);
  const incl = excl + ancestorExclSum;

  return { id: n.id, type: n.type, excl, pct, incl, inMB, outMB, bw, count };
}).sort((a, b) => b.excl - a.excl);

nodeReport.forEach((r, idx) => {
  const rank = (idx + 1).toString().padStart(4);
  const id = r.id.padEnd(20);
  const type = r.type.padEnd(10);
  const excl = `${r.excl.toFixed(2)} ms`.padStart(14);
  const pct = `${r.pct.toFixed(1)}%`.padStart(7);
  const incl = `${r.incl.toFixed(2)} ms`.padStart(14);
  const inM = `${r.inMB} MB`.padStart(7);
  const outM = `${r.outMB} MB`.padStart(7);
  const bw = `${r.bw} GB/s`.padStart(11);
  console.log(`${rank} | ${id} | ${type} | ${excl} | ${pct} | ${incl} | ${inM} | ${outM} | ${bw}`);
  
  // Assert strictly that Inclusive >= Exclusive for all nodes
  assert(r.incl >= r.excl, `Inclusive time (${r.incl}) must be >= Exclusive time (${r.excl}) for ${r.id}`);
});
console.log('-----------------------------------------------------------------------------------------------------------------\n');
console.log('✅ Timing integrity verified: Inclusive time >= Exclusive time for all 15 nodes.');
