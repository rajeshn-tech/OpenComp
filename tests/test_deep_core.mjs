/**
 * OpenComp - Workstream 5.1 Test Suite
 * Validates Deep Core Architecture & DeepPixelBuffer:
 * 1. Prefix-sum offset table consistency and constant time O(1) sample access
 * 2. Multi-sample variable depth storage (0, 1, 3, 5 samples per pixel)
 * 3. In-place depth sorting (zFront ascending, tie-breaking by zBack)
 * 4. Deep cloning fidelity and memory isolation
 * 5. Dynamic 2D data bounding box calculation
 */

import { DeepPixelBuffer } from '../src/core/deep/DeepPixelBuffer.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    passed++;
    console.log(`  ✔ PASS: ${message}`);
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🎯 RUNNING: tests/test_deep_core.mjs (Workstream 5.1)');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test 1: Construction & Prefix-Sum Consistency
  // -------------------------------------------------------------
  console.log('▶ Test 1: DeepPixelBuffer Construction & Offsets ...');
  {
    const width = 4, height = 3;
    const buf = new DeepPixelBuffer(width, height);

    assert(buf.width === 4 && buf.height === 3, 'Dimensions correctly initialized');
    assert(buf.sampleOffsets.length === (4 * 3 + 1), 'sampleOffsets length equals W*H + 1');
    assert(buf.sampleOffsets[0] === 0, 'sampleOffsets[0] is 0');
    assert(buf.totalSamples === 0, 'Initial totalSamples is 0');

    // Test getSampleCount on empty buffer
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        assert(buf.getSampleCount(x, y) === 0, `Pixel (${x}, ${y}) has 0 samples`);
      }
    }
  }

  // -------------------------------------------------------------
  // Test 2: Multi-Sample Variable Depth Storage
  // -------------------------------------------------------------
  console.log('\n▶ Test 2: Variable Multi-Sample Storage (fromSampleLists) ...');
  {
    const width = 3, height = 2;
    // Pixel (0, 0): 2 samples (z=5.0, z=10.0)
    // Pixel (1, 0): 0 samples (empty sky/background)
    // Pixel (2, 0): 3 samples (volumetric fog: z1=2, z2=4; point: z1=6, z2=6; point: z1=15, z2=15)
    // Row 1: single samples
    const pixelLists = new Array(width * height);
    pixelLists[0] = [
      { zFront: 10.0, zBack: 10.0, r: 0.0, g: 1.0, b: 0.0, a: 1.0 },
      { zFront: 5.0, zBack: 5.0, r: 1.0, g: 0.0, b: 0.0, a: 0.8 }
    ];
    pixelLists[1] = []; // 0 samples
    pixelLists[2] = [
      { zFront: 15.0, zBack: 15.0, r: 0.2, g: 0.2, b: 0.8, a: 1.0 },
      { zFront: 2.0, zBack: 4.0, r: 0.5, g: 0.5, b: 0.5, a: 0.3 },
      { zFront: 6.0, zBack: 6.0, r: 1.0, g: 1.0, b: 0.0, a: 0.5 }
    ];
    pixelLists[3] = [{ zFront: 8.0, zBack: 8.0, r: 0.1, g: 0.1, b: 0.1, a: 1.0 }];
    pixelLists[4] = [{ zFront: 9.0, zBack: 9.0, r: 0.2, g: 0.2, b: 0.2, a: 1.0 }];
    pixelLists[5] = [{ zFront: 11.0, zBack: 11.0, r: 0.3, g: 0.3, b: 0.3, a: 1.0 }];

    const buf = DeepPixelBuffer.fromSampleLists(width, height, pixelLists);

    assert(buf.totalSamples === 8, `Total samples equals 8 (got ${buf.totalSamples})`);
    assert(buf.getSampleCount(0, 0) === 2, 'Pixel (0, 0) has 2 samples');
    assert(buf.getSampleCount(1, 0) === 0, 'Pixel (1, 0) has 0 samples');
    assert(buf.getSampleCount(2, 0) === 3, 'Pixel (2, 0) has 3 samples');
    assert(buf.getSampleCount(0, 1) === 1, 'Pixel (0, 1) has 1 sample');

    // Verify sample values at pixel (0, 0) after auto-sorting
    const s00_0 = buf.getSample(0, 0, 0);
    const s00_1 = buf.getSample(0, 0, 1);
    assert(s00_0.zFront === 5.0, 'First sample at (0, 0) is at z=5.0');
    assert(s00_0.r === 1.0 && Math.abs(s00_0.a - 0.8) < 1e-5, 'First sample at (0, 0) attributes match');
    assert(s00_1.zFront === 10.0, 'Second sample at (0, 0) is at z=10.0');
  }

  // -------------------------------------------------------------
  // Test 3: In-Place Depth Sorting & Tie-Breaking
  // -------------------------------------------------------------
  console.log('\n▶ Test 3: In-Place Depth Sorting & Tie-Breaking ...');
  {
    const width = 1, height = 1;
    const pixelLists = [[
      { zFront: 12.0, zBack: 14.0, r: 1, g: 0, b: 0, a: 0.5 },
      { zFront: 3.0, zBack: 5.0, r: 0, g: 1, b: 0, a: 0.2 },
      { zFront: 7.0, zBack: 8.0, r: 0, g: 0, b: 1, a: 0.4 },
      { zFront: 3.0, zBack: 4.0, r: 1, g: 1, b: 0, a: 0.1 }, // Tie in zFront with sample 1, but zBack is smaller (4.0 < 5.0)
      { zFront: 1.0, zBack: 1.0, r: 1, g: 1, b: 1, a: 1.0 }
    ]];

    const buf = DeepPixelBuffer.fromSampleLists(width, height, pixelLists);

    const sorted = buf.getSamples(0, 0);
    assert(sorted.length === 5, 'Retrieved 5 sorted samples');

    // Expected order:
    // 0: zFront=1.0, zBack=1.0
    // 1: zFront=3.0, zBack=4.0 (smaller zBack precedes)
    // 2: zFront=3.0, zBack=5.0
    // 3: zFront=7.0, zBack=8.0
    // 4: zFront=12.0, zBack=14.0
    assert(sorted[0].zFront === 1.0, `Sample 0 is zFront=1.0 (got ${sorted[0].zFront})`);
    assert(sorted[1].zFront === 3.0 && sorted[1].zBack === 4.0, `Sample 1 is zFront=3.0, zBack=4.0`);
    assert(sorted[2].zFront === 3.0 && sorted[2].zBack === 5.0, `Sample 2 is zFront=3.0, zBack=5.0`);
    assert(sorted[3].zFront === 7.0, `Sample 3 is zFront=7.0 (got ${sorted[3].zFront})`);
    assert(sorted[4].zFront === 12.0, `Sample 4 is zFront=12.0 (got ${sorted[4].zFront})`);
  }

  // -------------------------------------------------------------
  // Test 4: Deep Cloning Fidelity & Isolation
  // -------------------------------------------------------------
  console.log('\n▶ Test 4: Deep Cloning Fidelity & Memory Isolation ...');
  {
    const pixelLists = [
      [{ zFront: 4.0, zBack: 4.0, r: 1.0, g: 0.5, b: 0.0, a: 1.0 }],
      [{ zFront: 6.0, zBack: 8.0, r: 0.0, g: 0.5, b: 1.0, a: 0.5 }]
    ];
    const orig = DeepPixelBuffer.fromSampleLists(2, 1, pixelLists);
    orig.metadata = { project: 'TestScene', frame: 42 };

    const clone = orig.clone();

    assert(clone.width === orig.width && clone.height === orig.height, 'Clone matches dimensions');
    assert(clone.totalSamples === orig.totalSamples, 'Clone matches total sample count');
    assert(clone.metadata.frame === 42, 'Clone preserves metadata');

    // Mutate clone sampleData
    clone.sampleData[2] = 0.0; // change red to 0.0
    assert(orig.sampleData[2] === 1.0, 'Original sampleData is isolated from mutation in clone');
  }

  // -------------------------------------------------------------
  // Test 5: Dynamic 2D Data Bounding Box Calculation
  // -------------------------------------------------------------
  console.log('\n▶ Test 5: Dynamic 2D Bounding Box Calculation ...');
  {
    const width = 10, height = 10;
    const pixelLists = new Array(width * height);
    for (let i = 0; i < width * height; i++) pixelLists[i] = [];

    // Place non-zero opacity samples in rectangle [2, 3] to [7, 8]
    const p1 = 3 * width + 2; // (x=2, y=3)
    pixelLists[p1] = [{ zFront: 5.0, zBack: 5.0, r: 1, g: 0, b: 0, a: 0.8 }];

    const p2 = 8 * width + 7; // (x=7, y=8)
    pixelLists[p2] = [{ zFront: 8.0, zBack: 8.0, r: 0, g: 1, b: 0, a: 0.5 }];

    const buf = DeepPixelBuffer.fromSampleLists(width, height, pixelLists);
    const bbox = buf.bbox;

    assert(bbox.x === 2, `BBox minX is 2 (got ${bbox.x})`);
    assert(bbox.y === 3, `BBox minY is 3 (got ${bbox.y})`);
    assert(bbox.width === 6, `BBox width is 6 (x=2..7) (got ${bbox.width})`);
    assert(bbox.height === 6, `BBox height is 6 (y=3..8) (got ${bbox.height})`);
  }

  console.log('\n================================================================');
  console.log(`✅ ALL DEEP CORE TESTS PASSED (${passed}/${passed + failed})`);
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
