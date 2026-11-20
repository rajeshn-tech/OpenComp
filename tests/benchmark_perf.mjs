/**
 * OpenComp - Production Performance & Throughput Benchmark Suite
 * Evaluates execution speeds on 1080p (2K) and 4K UHD complex node trees.
 * Measures latency, frames per second (FPS), and Megapixels per second (MP/s).
 */

import { performance } from 'perf_hooks';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';

console.log('====================================================');
console.log('⚡ OPENCOMP PERFORMANCE & COMPUTE BENCHMARK SUITE');
console.log('====================================================\n');

function buildComplexGraph(format = '1920x1080') {
  const graph = new Graph();

  // 1. Background Constant
  const bg = createNode('Constant', 'BG_Plate');
  bg.setKnobValue('format', format);
  bg.setKnobValue('colorR', 0.15);
  bg.setKnobValue('colorG', 0.25);
  bg.setKnobValue('colorB', 0.35);

  // 2. Foreground Ramp
  const ramp = createNode('Ramp', 'FG_Ramp');
  ramp.setKnobValue('type', 'smooth');

  // 3. Grade
  const grade = createNode('Grade', 'Grade_Beauty');
  grade.setKnobValue('gain', 1.25);
  grade.setKnobValue('gamma', 0.9);
  grade.setKnobValue('lift', 0.02);

  // 4. Blur
  const blur = createNode('Blur', 'Blur_Diffusion');
  blur.setKnobValue('size', 8.0);

  // 5. Premult
  const premult = createNode('Premult', 'Premult_Matte');

  // 6. Merge Over
  const merge = createNode('Merge', 'Merge_Composite');
  merge.setKnobValue('operation', 'over');
  merge.setKnobValue('mix', 0.95);

  // 7. Colorspace
  const cs = createNode('Colorspace', 'Colorspace_Delivery');
  cs.setKnobValue('in_colorspace', 'linear');
  cs.setKnobValue('out_colorspace', 'srgb');

  // 8. Viewer
  const viewer = createNode('Viewer', 'Viewer_Master');

  graph.addNode(bg);
  graph.addNode(ramp);
  graph.addNode(grade);
  graph.addNode(blur);
  graph.addNode(premult);
  graph.addNode(merge);
  graph.addNode(cs);
  graph.addNode(viewer);

  // Connections
  graph.connect('FG_Ramp', 'out', 'Grade_Beauty', 'in');
  graph.connect('Grade_Beauty', 'out', 'Blur_Diffusion', 'in');
  graph.connect('Blur_Diffusion', 'out', 'Premult_Matte', 'in');
  graph.connect('BG_Plate', 'out', 'Merge_Composite', 'B');
  graph.connect('Premult_Matte', 'out', 'Merge_Composite', 'A');
  graph.connect('Merge_Composite', 'out', 'Colorspace_Delivery', 'in');
  graph.connect('Colorspace_Delivery', 'out', 'Viewer_Master', '1');

  return { graph, viewerId: 'Viewer_Master' };
}

function runBenchmark(title, formatStr, pixels, iterations = 3) {
  console.log(`▶ Benchmarking ${title} (${formatStr}, ${(pixels / 1e6).toFixed(2)} MP)...`);
  const { graph, viewerId } = buildComplexGraph(formatStr);

  const times = [];

  // Warmup run
  graph.evaluate(viewerId);

  for (let i = 0; i < iterations; i++) {
    // Invalidate caches to force complete pull-through evaluation
    for (const n of graph.getAllNodes()) {
      n.markDirty();
    }

    const t0 = performance.now();
    const result = graph.evaluate(viewerId);
    const t1 = performance.now();

    if (!result) throw new Error('Evaluation produced null output buffer');
    times.push(t1 - t0);
  }

  const meanTimeMs = times.reduce((a, b) => a + b, 0) / times.length;
  const fps = 1000.0 / meanTimeMs;
  const mpPerSec = (pixels / 1e6) * fps;

  console.log(`  - Mean Execution Time: ${meanTimeMs.toFixed(2)} ms`);
  console.log(`  - Frame Rate:         ${fps.toFixed(2)} FPS`);
  console.log(`  - Processing Speed:    ${mpPerSec.toFixed(2)} Megapixels/sec`);
  console.log('');

  return { meanTimeMs, fps, mpPerSec };
}

// 1. HD 1080p Benchmark (1920 x 1080 = 2.0736 MP)
const res1080p = runBenchmark('HD 1080p (8-Node Production Graph)', '1920x1080', 1920 * 1080, 5);

// 2. 720p Real-Time Preview Benchmark (1280 x 720 = 0.9216 MP)
const res720p = runBenchmark('720p Proxy / Preview (8-Node Production Graph)', '1280x720', 1280 * 720, 5);

// 3. 4K UHD Benchmark (3840 x 2160 = 8.2944 MP)
const res4K = runBenchmark('4K UHD Cinema Master (8-Node Production Graph)', '3840x2160', 3840 * 2160, 2);

console.log('====================================================');
console.log('🏁 BENCHMARK COMPLETE: OpenComp Core Processing Engine');
console.log('====================================================');

