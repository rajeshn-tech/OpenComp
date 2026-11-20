import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { Graph } = await import('file:///' + path.join(workspace, 'src/core/Graph.js').replace(/\\/g, '/'));
const { createNode } = await import('file:///' + path.join(workspace, 'src/core/NodeRegistry.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));
const { PixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));

const projectPath = path.join(workspace, 'demo/vfx_showcase/cinematic_vfx_shot.opencomp');
const projectData = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

function runBenchmark(pruneChannels) {
  const graph = new Graph();
  graph.deserialize(projectData, createNode);

  // Preload frame 1 sequences for Read nodes
  for (const n of graph.getAllNodes().filter(n => n.type === 'Read')) {
    const pattern = n.getKnobValue('file');
    if (pattern) {
      const f1Path = path.join(workspace, ImageIO.resolveSequenceFrame(pattern, 1));
      const buf = ImageIO.readEXR(fs.readFileSync(f1Path));
      if (pruneChannels) {
        for (const k of ['R', 'G', 'B', 'A', 'r', 'g', 'b', 'a', 'red', 'green', 'blue', 'alpha']) {
          buf.extraChannels.delete(k);
        }
      }
      n.setSequenceFrame(1, buf);
    }
  }

  // Warmup
  for (const n of graph.getAllNodes()) {
    n.cachedBuffer = null;
    n.isDirty = true;
  }
  graph.evaluate('Viewer_Master', { frame: 1 });

  // 5 uncached iterations
  const times = [];
  const rssList = [];
  for (let i = 0; i < 5; i++) {
    for (const n of graph.getAllNodes()) {
      n.cachedBuffer = null;
      n.isDirty = true;
    }
    const t0 = performance.now();
    graph.evaluate('Viewer_Master', { frame: 1 });
    const dt = performance.now() - t0;
    times.push(dt);
    rssList.push(process.memoryUsage().rss / (1024 * 1024));
  }
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const peakRss = Math.max(...rssList);
  return { mean, times, peakRss };
}

console.log('Testing full DAG without channel pruning...');
const unpruned = runBenchmark(false);
console.log(`Unpruned: Mean = ${unpruned.mean.toFixed(2)} ms, Peak RSS = ${unpruned.peakRss.toFixed(2)} MB`);

console.log('Testing full DAG WITH channel pruning...');
const pruned = runBenchmark(true);
console.log(`Pruned:   Mean = ${pruned.mean.toFixed(2)} ms, Peak RSS = ${pruned.peakRss.toFixed(2)} MB`);
console.log(`Speedup:  ${(unpruned.mean / pruned.mean).toFixed(2)}x`);
console.log(`Time saved per frame: ${(unpruned.mean - pruned.mean).toFixed(2)} ms`);

