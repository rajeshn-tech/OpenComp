import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { Graph } = await import('file:///' + path.join(workspace, 'src/core/Graph.js').replace(/\\/g, '/'));
const { createNode } = await import('file:///' + path.join(workspace, 'src/core/NodeRegistry.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));
const { ZDefocusNode } = await import('file:///' + path.join(workspace, 'src/nodes/ZDefocusNode.js').replace(/\\/g, '/'));

console.log('======================================================================');
console.log('🔬 STEP 1: RECONCILING ZDEFOCUS BENCHMARK BASELINE');
console.log('======================================================================\n');

// 1. Standalone Direct Compute Benchmark (Isolating Node Engine)
const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const depthPath = path.join(workspace, 'demo/vfx_showcase/depth/depth_pass.0001.exr');
const inputBuf = ImageIO.readEXR(fs.readFileSync(bgPath));
const depthBuf = ImageIO.readEXR(fs.readFileSync(depthPath));

const nodeDirect = new ZDefocusNode('ZD_Baseline');
nodeDirect.setKnobValue('focusPlane', 0.5);
nodeDirect.setKnobValue('depthOfField', 0.12);
nodeDirect.setKnobValue('maxDefocus', 14.0);
nodeDirect.setKnobValue('aspectRatio', 1.0);
nodeDirect.setKnobValue('bloom', 0.25);

console.log('A. Standalone Direct Compute (Cold vs Warm):');
const standaloneRuns = [];
for (let i = 0; i < 5; i++) {
  const memBefore = process.memoryUsage();
  const t0 = performance.now();
  const res = nodeDirect.compute({ in: inputBuf, depth: depthBuf }, { frame: 1 });
  const dt = performance.now() - t0;
  const memAfter = process.memoryUsage();
  standaloneRuns.push(dt);
  console.log(`   - Standalone Run ${i + 1}: ${dt.toFixed(2)} ms | Heap: ${(memAfter.heapUsed / (1024*1024)).toFixed(2)} MB`);
}

// 2. Full DAG In-Context Evaluation (Uncached Viewer_Master)
const projectPath = path.join(workspace, 'demo/vfx_showcase/cinematic_vfx_shot.opencomp');
const projectData = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

const graph = new Graph();
graph.deserialize(projectData, createNode);

for (const n of graph.getAllNodes().filter(n => n.type === 'Read')) {
  const pattern = n.getKnobValue('file');
  if (pattern) {
    const f1Path = path.join(workspace, ImageIO.resolveSequenceFrame(pattern, 1));
    n.setSequenceFrame(1, ImageIO.readEXR(fs.readFileSync(f1Path)));
  }
}

const zdNode = graph.getNode('ZDefocus_BG');
const zdExclusiveTimes = [];
const origCompute = zdNode.compute.bind(zdNode);
zdNode.compute = function(inputs, context) {
  const t0 = performance.now();
  const r = origCompute(inputs, context);
  const dt = performance.now() - t0;
  zdExclusiveTimes.push(dt);
  return r;
};

console.log('\nB. Full DAG In-Context Uncached Evaluation (5 Iterations):');
const dagRuns = [];
const rssSnapshots = [];
const heapSnapshots = [];
const extSnapshots = [];

for (let i = 0; i < 5; i++) {
  // Clear all caches
  for (const n of graph.getAllNodes()) {
    n.cachedBuffer = null;
    n.isDirty = true;
  }
  const t0 = performance.now();
  graph.evaluate('Viewer_Master', { frame: 1 });
  const dt = performance.now() - t0;
  const mem = process.memoryUsage();
  dagRuns.push(dt);
  rssSnapshots.push(mem.rss / (1024 * 1024));
  heapSnapshots.push(mem.heapUsed / (1024 * 1024));
  extSnapshots.push(mem.external / (1024 * 1024));
  console.log(`   - DAG Run ${i + 1}: Total DAG = ${dt.toFixed(2)} ms | ZDefocus Exclusive = ${zdExclusiveTimes[i].toFixed(2)} ms | RSS: ${(mem.rss / (1024*1024)).toFixed(2)} MB`);
}

const sortedZD = [...zdExclusiveTimes].sort((a, b) => a - b);
const meanZD = zdExclusiveTimes.reduce((a, b) => a + b, 0) / zdExclusiveTimes.length;
const medianZD = sortedZD[Math.floor(sortedZD.length / 2)];

console.log('\nC. Reconciled Baseline Telemetry for ZDefocus_BG (1080p, 24 samples, Poisson-disc):');
console.log(`   - Mean Exclusive Time:   ${meanZD.toFixed(2)} ms`);
console.log(`   - Median Exclusive Time: ${medianZD.toFixed(2)} ms`);
console.log(`   - Min Exclusive Time:    ${sortedZD[0].toFixed(2)} ms`);
console.log(`   - Max Exclusive Time:    ${sortedZD[sortedZD.length - 1].toFixed(2)} ms`);
console.log(`   - Peak Process RSS:      ${Math.max(...rssSnapshots).toFixed(2)} MB`);
console.log(`   - Peak Heap Used:        ${Math.max(...heapSnapshots).toFixed(2)} MB`);
console.log(`   - Peak ArrayBuffer:      ${Math.max(...extSnapshots).toFixed(2)} MB`);

