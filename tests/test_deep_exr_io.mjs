/**
 * OpenComp - Workstream 5.4 Test Suite
 * Validates Deep OpenEXR File I/O Subsystem:
 * 1. Deep EXR Serialization (DeepScanLine with ZIPS compression)
 * 2. Deep EXR Inspection via Python OpenEXR 3.5.2
 * 3. Deep EXR Ingestion & Multi-Sample Readback
 * 4. Floating-Point Sample Precision & Sample Count Preservation
 * 5. DeepReadNode and DeepWriteNode DAG Execution
 */

import { DeepPixelBuffer } from '../src/core/deep/DeepPixelBuffer.js';
import { DeepEXRBridgeClient } from '../src/core/deep/DeepEXRBridgeClient.js';
import { DeepReadNode } from '../src/nodes/DeepReadNode.js';
import { DeepWriteNode } from '../src/nodes/DeepWriteNode.js';
import fs from 'node:fs';
import path from 'node:path';

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
  console.log('🎯 RUNNING: tests/test_deep_exr_io.mjs (Workstream 5.4)');
  console.log('================================================================\n');

  const testExrPath = path.resolve('tests/output/test_volumetric_deep.exr');
  const testDir = path.dirname(testExrPath);
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // -------------------------------------------------------------
  // Test 1: Construct and Serialize Authentic Deep EXR
  // -------------------------------------------------------------
  console.log('▶ Test 1: Deep EXR Serialization (DeepScanLine) ...');
  {
    const W = 3, H = 2;
    const pixelLists = new Array(W * H);
    // (0, 0): 2 samples
    pixelLists[0] = [
      { zFront: 2.5, zBack: 2.5, r: 1.0, g: 0.0, b: 0.0, a: 0.6 },
      { zFront: 7.0, zBack: 8.5, r: 0.0, g: 1.0, b: 0.0, a: 0.4 }
    ];
    // (1, 0): 0 samples (empty)
    pixelLists[1] = [];
    // (2, 0): 3 samples
    pixelLists[2] = [
      { zFront: 1.2, zBack: 1.2, r: 0.2, g: 0.2, b: 0.2, a: 0.1 },
      { zFront: 4.0, zBack: 4.0, r: 0.8, g: 0.8, b: 0.0, a: 0.9 },
      { zFront: 15.0, zBack: 15.0, r: 0.0, g: 0.0, b: 1.0, a: 1.0 }
    ];
    // Row 1: single samples
    pixelLists[3] = [{ zFront: 5.0, zBack: 5.0, r: 0.5, g: 0.5, b: 0.5, a: 1.0 }];
    pixelLists[4] = [{ zFront: 6.0, zBack: 6.0, r: 0.6, g: 0.6, b: 0.6, a: 1.0 }];
    pixelLists[5] = [{ zFront: 7.0, zBack: 7.0, r: 0.7, g: 0.7, b: 0.7, a: 1.0 }];

    const origDeep = DeepPixelBuffer.fromSampleLists(W, H, pixelLists);
    assert(origDeep.totalSamples === 8, 'Original deep buffer has 8 samples');

    // Write to disk
    const writeRes = DeepEXRBridgeClient.writeDeepEXR(origDeep, testExrPath, 'ZIPS');
    assert(writeRes.status === 'ok', 'Deep EXR file successfully written to disk');
    assert(fs.existsSync(testExrPath), 'Generated file exists on filesystem');
  }

  // -------------------------------------------------------------
  // Test 2: Independent Deep EXR Header Inspection
  // -------------------------------------------------------------
  console.log('\n▶ Test 2: Deep EXR Header & Part Inspection ...');
  {
    const info = DeepEXRBridgeClient.inspect(testExrPath);

    assert(info.status === 'ok', 'Inspection status is ok');
    assert(info.isDeep === true, 'File is confirmed as Deep EXR');
    assert(info.width === 3 && info.height === 2, 'Dimensions match 3x2');
    assert(info.totalSamples === 8, `Total sample count matches 8 (got ${info.totalSamples})`);
    assert(info.maxSamplesPerPixel === 3, 'Max samples per pixel is 3');
    assert(info.channels.includes('Z') && info.channels.includes('R') && info.channels.includes('A'),
      'Required channels (Z, R, A) present in EXR header');
  }

  // -------------------------------------------------------------
  // Test 3: Deep EXR Readback & Float32 Precision Parity
  // -------------------------------------------------------------
  console.log('\n▶ Test 3: Deep EXR Ingestion & Numerical Parity ...');
  {
    const readDeep = DeepEXRBridgeClient.readDeepEXR(testExrPath);

    assert(readDeep instanceof DeepPixelBuffer, 'Ingested file creates DeepPixelBuffer');
    assert(readDeep.width === 3 && readDeep.height === 2, 'Ingested dimensions match 3x2');
    assert(readDeep.totalSamples === 8, 'Ingested total samples equals 8');

    // Verify samples at pixel (0, 0)
    assert(readDeep.getSampleCount(0, 0) === 2, 'Pixel (0, 0) has 2 samples');
    const s0 = readDeep.getSample(0, 0, 0);
    const s1 = readDeep.getSample(0, 0, 1);

    assert(Math.abs(s0.zFront - 2.5) < 1e-5, `Sample 0 zFront is 2.5 (got ${s0.zFront})`);
    assert(Math.abs(s0.r - 1.0) < 1e-5, `Sample 0 Red is 1.0 (got ${s0.r})`);
    assert(Math.abs(s0.a - 0.6) < 1e-5, `Sample 0 Alpha is 0.6 (got ${s0.a})`);

    assert(Math.abs(s1.zFront - 7.0) < 1e-5, `Sample 1 zFront is 7.0 (got ${s1.zFront})`);
    assert(Math.abs(s1.zBack - 8.5) < 1e-5, `Sample 1 zBack is 8.5 (got ${s1.zBack})`);
    assert(Math.abs(s1.g - 1.0) < 1e-5, `Sample 1 Green is 1.0 (got ${s1.g})`);

    // Verify empty pixel (1, 0)
    assert(readDeep.getSampleCount(1, 0) === 0, 'Pixel (1, 0) correctly has 0 samples');

    // Verify pixel (2, 0) with 3 samples
    assert(readDeep.getSampleCount(2, 0) === 3, 'Pixel (2, 0) has 3 samples');
    const s2_2 = readDeep.getSample(2, 0, 2);
    assert(Math.abs(s2_2.zFront - 15.0) < 1e-5, 'Sample 2 at (2, 0) has zFront=15.0');
    assert(Math.abs(s2_2.b - 1.0) < 1e-5, 'Sample 2 at (2, 0) has Blue=1.0');
  }

  // -------------------------------------------------------------
  // Test 4: DeepReadNode and DeepWriteNode DAG Execution
  // -------------------------------------------------------------
  console.log('\n▶ Test 4: DeepReadNode & DeepWriteNode Execution ...');
  {
    const readNode = new DeepReadNode('deepRead1');
    readNode.setKnobValue('file', testExrPath);
    const loadedDeep = readNode.compute([]);

    assert(loadedDeep instanceof DeepPixelBuffer, 'DeepReadNode loads DeepPixelBuffer');
    assert(loadedDeep.totalSamples === 8, 'DeepReadNode preserves sample count');

    const copyExrPath = path.resolve('tests/output/test_volumetric_deep_copy.exr');
    const writeNode = new DeepWriteNode('deepWrite1');
    writeNode.setKnobValue('file', copyExrPath);
    writeNode.setKnobValue('compression', 'ZIPS');
    const writtenDeep = writeNode.compute([loadedDeep]);

    assert(writtenDeep === loadedDeep, 'DeepWriteNode passes through deep stream');
    assert(fs.existsSync(copyExrPath), 'DeepWriteNode created second EXR file');

    // Verify copied file
    const copyInfo = DeepEXRBridgeClient.inspect(copyExrPath);
    assert(copyInfo.totalSamples === 8, 'Copied Deep EXR preserves all 8 samples');

    // Clean up temporary test files
    try {
      fs.unlinkSync(testExrPath);
      fs.unlinkSync(copyExrPath);
    } catch (_) {}
  }

  console.log('\n================================================================');
  console.log(`✅ ALL DEEP EXR I/O TESTS PASSED (${passed}/${passed + failed})`);
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});

