import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { Graph } = await import('file:///' + path.join(workspace, 'src/core/Graph.js').replace(/\\/g, '/'));
const { createNode } = await import('file:///' + path.join(workspace, 'src/core/NodeRegistry.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));
const { PixelBuffer, TiledPixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));

console.log('======================================================================');
console.log('🔍 MILESTONE 3: COMPREHENSIVE FULL DAG PROFILING & BOTTLENECK ANALYSIS');
console.log('======================================================================\n');

const projectPath = path.join(workspace, 'demo/vfx_showcase/cinematic_vfx_shot.opencomp');
const projectData = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

const graph = new Graph();
graph.deserialize(projectData, createNode);

// Preload frame 1 sequences for Read nodes
for (const n of graph.getAllNodes().filter(n => n.type === 'Read')) {
  const pattern = n.getKnobValue('file');
  if (pattern) {
    const f1Path = path.join(workspace, ImageIO.resolveSequenceFrame(pattern, 1));
    n.setSequenceFrame(1, ImageIO.readEXR(fs.readFileSync(f1Path)));
  }
}

const allNodes = graph.getAllNodes();
const topoOrder = graph.getTopologicalOrder();

console.log('1. Graph Topology & Evaluation Order:');
topoOrder.forEach((id, idx) => {
  const n = graph.getNode(id);
  const inputs = n.inputs.filter(i => i.connection).map(i => `${i.id}<-${i.connection.nodeId}`).join(', ');
  console.log(`   ${(idx + 1).toString().padStart(2)}. ${n.id.padEnd(20)} (${n.type.padEnd(10)}) | Inputs: ${inputs || 'none'}`);
});
console.log('');

// Instrument Graph & Nodes
// Track buffer allocations
let totalAllocBytes = 0;
let totalAllocCount = 0;
let totalCloneBytes = 0;
let totalCloneCount = 0;

const origPixelBufferConstructor = PixelBuffer;
// Monkey patch PixelBuffer constructor and clone to measure allocation and copy volume
const nodeMetrics = {};
for (const n of allNodes) {
  nodeMetrics[n.id] = {
    id: n.id,
    type: n.type,
    exclusiveTimes: [],
    inclusiveTimes: [],
    allocBytes: 0,
    allocCount: 0,
    cloneBytes: 0,
    cloneCount: 0,
    inputBytes: 0,
    outputBytes: 0,
    cacheHits: 0,
    cacheMisses: 0
  };
}

// Wrap compute method on each node
for (const n of allNodes) {
  const origCompute = n.compute.bind(n);
  n.compute = function(inputs, context) {
    const metrics = nodeMetrics[n.id];
    let inBytes = 0;
    for (const buf of Object.values(inputs)) {
      if (buf && buf.data) inBytes += buf.data.byteLength;
    }
    metrics.inputBytes = inBytes;

    const memBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const result = origCompute(inputs, context);
    const dt = performance.now() - t0;
    const memAfter = process.memoryUsage().heapUsed;

    metrics.exclusiveTimes.push(dt);
    if (result && result.data) {
      metrics.outputBytes = result.data.byteLength;
      metrics.allocBytes += result.data.byteLength;
      metrics.allocCount++;
    }
    return result;
  };
}

// Function to measure recursive inclusive evaluation
function measureInclusive(nodeId, context = {}) {
  const node = graph.getNode(nodeId);
  const t0 = performance.now();
  // Clear caches upstream
  function clearUpstream(id) {
    const nd = graph.getNode(id);
    nd.cachedBuffer = null;
    nd.isDirty = true;
    for (const inp of nd.inputs) {
      if (inp.connection) clearUpstream(inp.connection.nodeId);
    }
  }
  clearUpstream(nodeId);
  graph.evaluate(nodeId, context);
  const dt = performance.now() - t0;
  return dt;
}

// Run 5 full uncached DAG iterations
const ITERATIONS = 5;
const fullDagTimes = [];
const rssSnapshots = [];

// Warmup 1 run
for (const n of allNodes) {
  n.cachedBuffer = null;
  n.isDirty = true;
}
graph.evaluate('Viewer_Master', { frame: 1 });

// Reset metrics after warmup
for (const k of Object.keys(nodeMetrics)) {
  nodeMetrics[k].exclusiveTimes = [];
  nodeMetrics[k].allocBytes = 0;
  nodeMetrics[k].allocCount = 0;
}

console.log('2. Running 5 Full Uncached Evaluations of the Complete 15-Node DAG:');
for (let iter = 0; iter < ITERATIONS; iter++) {
  // Clear all caches completely
  for (const n of allNodes) {
    n.cachedBuffer = null;
    n.isDirty = true;
  }
  const rssBefore = process.memoryUsage().rss / (1024 * 1024);
  const t0 = performance.now();
  graph.evaluate('Viewer_Master', { frame: 1 });
  const dt = performance.now() - t0;
  const rssAfter = process.memoryUsage().rss / (1024 * 1024);

  fullDagTimes.push(dt);
  rssSnapshots.push(rssAfter);
  console.log(`   - Iteration ${iter + 1}: ${dt.toFixed(2)} ms | RSS: ${rssAfter.toFixed(2)} MB`);
}

const avgFullDag = fullDagTimes.reduce((a, b) => a + b, 0) / ITERATIONS;
console.log(`\n   Mean Full DAG Frame Time: ${avgFullDag.toFixed(2)} ms (${(1000 / avgFullDag).toFixed(2)} FPS)`);
console.log(`   Peak Process RSS:         ${Math.max(...rssSnapshots).toFixed(2)} MB\n`);

// Measure inclusive times for each node
for (const id of topoOrder) {
  const incTimes = [];
  for (let r = 0; r < 3; r++) {
    incTimes.push(measureInclusive(id, { frame: 1 }));
  }
  nodeMetrics[id].inclusiveTime = incTimes.reduce((a, b) => a + b, 0) / incTimes.length;
}

// Display Detailed Per-Node Profiling Table
console.log('3. Detailed Per-Node Instrumentation Table (Ranked by Exclusive Compute Time):');
console.log('-----------------------------------------------------------------------------------------------------------------------------');
console.log('Rank | Node ID              | Type       | Exclusive (ms) | % Frame | Inclusive (ms) | In MB   | Out MB  | Bandwidth (GB/s)');
console.log('-----------------------------------------------------------------------------------------------------------------------------');

const ranked = Object.values(nodeMetrics).map(m => {
  const exclMean = m.exclusiveTimes.reduce((a, b) => a + b, 0) / (m.exclusiveTimes.length || 1);
  const pct = (exclMean / avgFullDag) * 100;
  const inMB = (m.inputBytes / (1024 * 1024)).toFixed(1);
  const outMB = (m.outputBytes / (1024 * 1024)).toFixed(1);
  const totalIO = m.inputBytes + m.outputBytes;
  const bwGBs = exclMean > 0 ? ((totalIO / (1024 * 1024 * 1024)) / (exclMean / 1000)).toFixed(2) : '0.00';
  return { ...m, exclMean, pct, inMB, outMB, bwGBs };
}).sort((a, b) => b.exclMean - a.exclMean);

ranked.forEach((r, idx) => {
  const rankStr = (idx + 1).toString().padStart(4);
  const idStr = r.id.padEnd(20);
  const typeStr = r.type.padEnd(10);
  const exclStr = `${r.exclMean.toFixed(2)} ms`.padStart(14);
  const pctStr = `${r.pct.toFixed(1)}%`.padStart(7);
  const incStr = `${r.inclusiveTime.toFixed(2)} ms`.padStart(14);
  const inStr = `${r.inMB} MB`.padStart(7);
  const outStr = `${r.outMB} MB`.padStart(7);
  const bwStr = `${r.bwGBs} GB/s`.padStart(16);
  console.log(`${rankStr} | ${idStr} | ${typeStr} | ${exclStr} | ${pctStr} | ${incStr} | ${inStr} | ${outStr} | ${bwStr}`);
});
console.log('-----------------------------------------------------------------------------------------------------------------------------');

