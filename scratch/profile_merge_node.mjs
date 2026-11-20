import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { MergeNode } = await import('file:///' + path.join(workspace, 'src/nodes/MergeNode.js').replace(/\\/g, '/'));
const { PixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const charPath = path.join(workspace, 'demo/vfx_showcase/source/character_plate.0001.exr');

const bufB = ImageIO.readEXR(fs.readFileSync(bgPath));
const bufA = ImageIO.readEXR(fs.readFileSync(charPath));

const merge = new MergeNode('merge_test');
merge.setKnobValue('operation', 'over');

// Warmup
merge.compute({ B: bufB, A: bufA });

// Measure breakdown
const RUNS = 10;
const totalTimes = [];
const allocTimes = [];
const copyChanTimes = [];
const mergeOpTimes = [];

for (let r = 0; r < RUNS; r++) {
  const t0 = performance.now();

  // 1. Alloc
  const tA0 = performance.now();
  const out = new PixelBuffer(bufB.width, bufB.height);
  const tA1 = performance.now();
  allocTimes.push(tA1 - tA0);

  // 2. copyChannelsFrom
  const tC0 = performance.now();
  out.copyChannelsFrom(bufB);
  out.copyChannelsFrom(bufA);
  const tC1 = performance.now();
  copyChanTimes.push(tC1 - tC0);

  // 3. _applyMerge
  const tM0 = performance.now();
  merge._applyMerge(bufA.data, bufB.data, out.data, null, out.data.length, { op: 'over', globalMix: 1.0 });
  const tM1 = performance.now();
  mergeOpTimes.push(tM1 - tM0);

  const tTotal = performance.now() - t0;
  totalTimes.push(tTotal);
}

const avg = arr => (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2);
console.log('Merge Node Breakdown (1080p, 10 runs):');
console.log(`  - Total compute time:       ${avg(totalTimes)} ms`);
console.log(`  - PixelBuffer allocation:   ${avg(allocTimes)} ms`);
console.log(`  - copyChannelsFrom (A + B): ${avg(copyChanTimes)} ms`);
console.log(`  - _applyMerge arithmetic:   ${avg(mergeOpTimes)} ms`);

