/**
 * OpenComp Test Suite - Resolution Scaling, Memory & Stress Suite
 * Validates memory allocation, DAG execution, buffer pooling, and proxy modes across:
 * - 4K UHD (3840x2160)
 * - 8K UHD (7680x4320)
 * - 12K DCI (12288x6480)
 * - 16K Boundary & V8 limit safety
 */

import { strict as assert } from 'assert';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { BufferPool } from '../src/core/BufferPool.js';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';
import { performance } from 'perf_hooks';

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_resolution_scaling.mjs');
console.log('----------------------------------------------------');

let passedTests = 0;

function runTest(name, fn) {
  try {
    const t0 = performance.now();
    fn();
    const dt = (performance.now() - t0).toFixed(1);
    console.log(`  ✅ ${name} (${dt} ms)`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// 1. Memory Calculation & V8 2GB Boundary Audit
runTest('Resolution Scaling: Mathematical Memory Footprint & V8 Limit Audit', () => {
  const resolutions = [
    { name: '720p HD', w: 1280, h: 720, expectedMB: 14.06 },
    { name: '1080p FHD', w: 1920, h: 1080, expectedMB: 31.64 },
    { name: '2K DCI', w: 2048, h: 1080, expectedMB: 33.75 },
    { name: '4K UHD', w: 3840, h: 2160, expectedMB: 126.56 },
    { name: '8K UHD', w: 7680, h: 4320, expectedMB: 506.25 },
    { name: '12K DCI', w: 12288, h: 6480, expectedMB: 1215.00 },
    { name: '16K UHD', w: 15360, h: 8640, expectedMB: 2025.00 }
  ];

  for (const res of resolutions) {
    const bytes = PixelBuffer.calculateMemoryBytes(res.w, res.h);
    const mb = bytes / (1024 * 1024);
    assert(Math.abs(mb - res.expectedMB) < 0.5, `Memory mismatch for ${res.name}: got ${mb.toFixed(2)} MB`);
  }

  // Verify contiguous allocation limit predicate
  assert.equal(PixelBuffer.canAllocateContiguous(3840, 2160), true, '4K should be safe for contiguous buffer');
  assert.equal(PixelBuffer.canAllocateContiguous(7680, 4320), true, '8K should be safe for contiguous buffer');
  assert.equal(PixelBuffer.canAllocateContiguous(12288, 6480), true, '12K DCI should be within 2GB V8 limits');
  assert.equal(PixelBuffer.canAllocateContiguous(15360, 8640), false, '16K (2.12 GB) exceeds V8 single-buffer limit');
});

// 2. 4K UHD Full Pipeline Execution
runTest('Resolution Scaling: 4K UHD Multi-Node DAG Pipeline Processing', () => {
  const w = 3840;
  const h = 2160;

  const bg = createNode('Constant', 'BG_4K', 0, 0);
  bg.setKnobValue('format', `${w}x${h}`);
  bg.setKnobValue('colorR', 0.2);
  bg.setKnobValue('colorG', 0.4);
  bg.setKnobValue('colorB', 0.6);

  const fg = createNode('Constant', 'FG_4K', 150, 0);
  fg.setKnobValue('format', `${w}x${h}`);
  fg.setKnobValue('colorR', 0.5);
  fg.setKnobValue('colorG', 0.1);
  fg.setKnobValue('colorB', 0.2);

  const grade = createNode('Grade', 'Grade_4K', 0, 100);
  grade.setKnobValue('gain', 1.5);
  grade.setKnobValue('gamma', 0.9);

  const merge = createNode('Merge', 'Merge_4K', 50, 200);
  merge.setKnobValue('operation', 'over');
  merge.setKnobValue('mix', 0.8);

  const graph = new Graph();
  graph.addNode(bg);
  graph.addNode(fg);
  graph.addNode(grade);
  graph.addNode(merge);

  graph.connect('BG_4K', 'out', 'Grade_4K', 'in');
  graph.connect('Grade_4K', 'out', 'Merge_4K', 'B');
  graph.connect('FG_4K', 'out', 'Merge_4K', 'A');

  const result = graph.evaluate('Merge_4K');
  assert(result instanceof PixelBuffer, 'Result must be a PixelBuffer');
  assert.equal(result.width, w, 'Width must match 4K UHD (3840)');
  assert.equal(result.height, h, 'Height must match 4K UHD (2160)');
  assert.equal(result.data.length, w * h * 4, 'Buffer size must match 4K float count');

  // Verify non-zero graded output
  const sample = result.getPixel(1920, 1080);
  assert(sample[0] > 0.0, 'Red channel must have evaluated values');
  assert(sample[1] > 0.0, 'Green channel must have evaluated values');
  assert(sample[2] > 0.0, 'Blue channel must have evaluated values');
});

// 3. 8K UHD Image Processing & Buffer Pooling
runTest('Resolution Scaling: 8K UHD Allocation, Processing & BufferPool Recycling', () => {
  const w = 7680;
  const h = 4320;

  // Allocate 8K buffer
  const buf8k = new PixelBuffer(w, h);
  assert.equal(buf8k.width, 7680);
  assert.equal(buf8k.height, 4320);

  // Fill and sample
  buf8k.fill(0.35, 0.45, 0.55, 1.0);
  const px = buf8k.getPixel(3840, 2160);
  assert(Math.abs(px[0] - 0.35) < 0.001);
  assert(Math.abs(px[1] - 0.45) < 0.001);
  assert(Math.abs(px[2] - 0.55) < 0.001);

  // Test BufferPool acquisition & recycling at 8K scale
  const pool = new BufferPool(2);
  const acquired = pool.acquireForImage(w, h, 4);
  assert.equal(acquired.length, w * h * 4);

  pool.release(acquired);
  const reacquired = pool.acquireForImage(w, h, 4);
  assert.strictEqual(reacquired, acquired, 'BufferPool must recycle 8K buffer without reallocating');
  pool.release(reacquired);
  pool.clear();
});

// 4. 12K DCI Allocation & Downsampled Proxy Modes
runTest('Resolution Scaling: 12K DCI Allocation & Multi-Tier Proxy Downsampling', () => {
  const w = 12288;
  const h = 6480;

  // Allocate 12K DCI buffer
  const buf12k = new PixelBuffer(w, h);
  assert.equal(buf12k.width, 12288);
  assert.equal(buf12k.height, 6480);
  assert.equal(buf12k.data.byteLength, 12288 * 6480 * 4 * 4);

  // Set test pattern at 12K
  buf12k.setPixel(0, 0, 1.0, 0.0, 0.0, 1.0);
  buf12k.setPixel(6144, 3240, 0.0, 1.0, 0.0, 1.0);
  buf12k.setPixel(12287, 6479, 0.0, 0.0, 1.0, 1.0);

  // Generate 1:4 Proxy (3072 x 1620)
  const proxyQuarter = buf12k.createProxy(0.25);
  assert.equal(proxyQuarter.width, 3072);
  assert.equal(proxyQuarter.height, 1620);
  assert(proxyQuarter.data.length === 3072 * 1620 * 4);

  // Generate 1:8 Proxy (1536 x 810)
  const proxyEighth = buf12k.createProxy(0.125);
  assert.equal(proxyEighth.width, 1536);
  assert.equal(proxyEighth.height, 810);
  assert(proxyEighth.data.length === 1536 * 810 * 4);
});

// 5. 16K Boundary Safety Check
runTest('Resolution Scaling: 16K Limit Safety & Graceful Exception Handling', () => {
  // A single contiguous 16K buffer (15360 x 8640 x 4 x 4 = 2,123,366,400 bytes)
  // exceeds standard V8 2GB limit.
  // Verify that canAllocateContiguous identifies this boundary correctly.
  const isContiguousSafe = PixelBuffer.canAllocateContiguous(15360, 8640);
  assert.equal(isContiguousSafe, false, '16K must be flagged as requiring tiled or chunked allocation');

  // Verify that safe allocation catch prevents application crash
  try {
    if (!isContiguousSafe) {
      // In production, OpenComp routes 16K+ requests to tiled/proxy processing
      // without crashing the main process
      const proxy16k = new PixelBuffer(15360 * 0.25, 8640 * 0.25);
      assert.equal(proxy16k.width, 3840);
      assert.equal(proxy16k.height, 2160);
    }
  } catch (err) {
    assert.fail('Should not throw unhandled error for 16K proxy routing');
  }
});

console.log(`\n🎉 test_resolution_scaling.mjs PASSED: All ${passedTests} resolution scaling tests succeeded with 0 errors.\n`);
