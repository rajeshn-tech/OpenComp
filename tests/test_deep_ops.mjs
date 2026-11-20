/**
 * OpenComp - Workstream 5.3 Test Suite
 * Validates Volumetric Deep Operations:
 * 1. DeepMerge: Interleaved depth sorting across streams A and B
 * 2. DeepMerge: Transmittance-based occlusion culling (dropHidden)
 * 3. DeepHoldout: Volumetric 3D occlusion attenuation without edge fringing
 * 4. DeepCrop: Spatial near/far clipping and volumetric slab slicing
 */

import { DeepPixelBuffer } from '../src/core/deep/DeepPixelBuffer.js';
import { DeepMergeNode } from '../src/nodes/DeepMergeNode.js';
import { DeepHoldoutNode } from '../src/nodes/DeepHoldoutNode.js';
import { DeepCropNode } from '../src/nodes/DeepCropNode.js';
import { DeepToImageNode } from '../src/nodes/DeepToImageNode.js';

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
  console.log('🎯 RUNNING: tests/test_deep_ops.mjs (Workstream 5.3)');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test 1: DeepMerge Interleaved Depth Sorting
  // -------------------------------------------------------------
  console.log('▶ Test 1: DeepMerge Interleaved Depth Sorting ...');
  {
    // Stream A: samples at z = 3.0 (Red), z = 9.0 (Yellow)
    const listA = [[
      { zFront: 3.0, zBack: 3.0, r: 0.5, g: 0.0, b: 0.0, a: 0.5 },
      { zFront: 9.0, zBack: 9.0, r: 0.2, g: 0.2, b: 0.0, a: 0.2 }
    ]];
    const bufA = DeepPixelBuffer.fromSampleLists(1, 1, listA);

    // Stream B: samples at z = 1.0 (Cyan), z = 6.0 (Magenta)
    const listB = [[
      { zFront: 1.0, zBack: 1.0, r: 0.0, g: 0.3, b: 0.3, a: 0.3 },
      { zFront: 6.0, zBack: 6.0, r: 0.4, g: 0.0, b: 0.4, a: 0.4 }
    ]];
    const bufB = DeepPixelBuffer.fromSampleLists(1, 1, listB);

    const mergeNode = new DeepMergeNode('merge1');
    mergeNode.setKnobValue('dropHidden', false);
    const merged = mergeNode.compute([bufB, bufA]);

    assert(merged instanceof DeepPixelBuffer, 'DeepMerge produces DeepPixelBuffer');
    assert(merged.getSampleCount(0, 0) === 4, 'Merged pixel has 4 samples');

    const s = merged.getSamples(0, 0);
    assert(s[0].zFront === 1.0, 'Sample 0 is z=1.0 (from stream B)');
    assert(s[1].zFront === 3.0, 'Sample 1 is z=3.0 (from stream A)');
    assert(s[2].zFront === 6.0, 'Sample 2 is z=6.0 (from stream B)');
    assert(s[3].zFront === 9.0, 'Sample 3 is z=9.0 (from stream A)');
  }

  // -------------------------------------------------------------
  // Test 2: DeepMerge dropHidden Transmittance Culling
  // -------------------------------------------------------------
  console.log('\n▶ Test 2: DeepMerge dropHidden Transmittance Culling ...');
  {
    // Stream A: opaque solid card at z = 4.0 (A=1.0)
    const listA = [[
      { zFront: 4.0, zBack: 4.0, r: 1.0, g: 0.0, b: 0.0, a: 1.0 }
    ]];
    const bufA = DeepPixelBuffer.fromSampleLists(1, 1, listA);

    // Stream B: foreground smoke at z = 2.0 (A=0.5), background mountain at z = 12.0 (A=1.0)
    const listB = [[
      { zFront: 2.0, zBack: 2.0, r: 0.2, g: 0.2, b: 0.2, a: 0.5 },
      { zFront: 12.0, zBack: 12.0, r: 0.0, g: 0.0, b: 1.0, a: 1.0 }
    ]];
    const bufB = DeepPixelBuffer.fromSampleLists(1, 1, listB);

    const mergeNode = new DeepMergeNode('merge2');
    mergeNode.setKnobValue('dropHidden', true);
    const merged = mergeNode.compute([bufB, bufA]);

    // Expected: z=2.0 kept, z=4.0 kept (since T becomes 0.0 here). z=12.0 culled!
    assert(merged.getSampleCount(0, 0) === 2, `dropHidden reduced samples from 3 to 2 (got ${merged.getSampleCount(0, 0)})`);
    const s = merged.getSamples(0, 0);
    assert(s[0].zFront === 2.0, 'Sample 0 is at z=2.0');
    assert(s[1].zFront === 4.0, 'Sample 1 is at z=4.0');
  }

  // -------------------------------------------------------------
  // Test 3: DeepHoldout Volumetric 3D Occlusion Attenuation
  // -------------------------------------------------------------
  console.log('\n▶ Test 3: DeepHoldout Volumetric 3D Occlusion Attenuation ...');
  {
    // Primary beauty: background actor at z = 10.0 (Pure Blue, A=1.0)
    const listBeauty = [[
      { zFront: 10.0, zBack: 10.0, r: 0.0, g: 0.0, b: 1.0, a: 1.0 }
    ]];
    const bufBeauty = DeepPixelBuffer.fromSampleLists(1, 1, listBeauty);

    // Holdout geometry: pillar at z = 5.0 (A=0.75 opacity)
    const listHoldout = [[
      { zFront: 5.0, zBack: 5.0, r: 0.5, g: 0.5, b: 0.5, a: 0.75 }
    ]];
    const bufHoldout = DeepPixelBuffer.fromSampleLists(1, 1, listHoldout);

    const holdoutNode = new DeepHoldoutNode('holdout1');
    const heldOut = holdoutNode.compute([bufBeauty, bufHoldout]);

    const s = heldOut.getSamples(0, 0);
    assert(s.length === 1, 'Sample count is 1');
    // Transmittance through holdout is (1 - 0.75) = 0.25
    // Attenuated beauty sample should have b = 1.0 * 0.25 = 0.25, a = 1.0 * 0.25 = 0.25
    assert(Math.abs(s[0].b - 0.25) < 1e-5, `Attenuated Blue (${s[0].b.toFixed(4)}) equals 0.2500`);
    assert(Math.abs(s[0].a - 0.25) < 1e-5, `Attenuated Alpha (${s[0].a.toFixed(4)}) equals 0.2500`);
  }

  // -------------------------------------------------------------
  // Test 4: DeepCrop Depth Slicing & Volumetric Attenuation
  // -------------------------------------------------------------
  console.log('\n▶ Test 4: DeepCrop Depth Slicing & Volumetric Attenuation ...');
  {
    // Volumetric fog slab from z=2.0 to z=10.0 with A=0.8, R=0.8
    const listFog = [[
      { zFront: 2.0, zBack: 10.0, r: 0.8, g: 0.0, b: 0.0, a: 0.8 }
    ]];
    const bufFog = DeepPixelBuffer.fromSampleLists(1, 1, listFog);

    // Crop with near plane at z=4.0
    const cropNode = new DeepCropNode('crop1');
    cropNode.setKnobValue('useNear', true);
    cropNode.setKnobValue('znear', 4.0);
    cropNode.setKnobValue('sliceVolumetrics', true);

    const cropped = cropNode.compute([bufFog]);
    const s = cropped.getSamples(0, 0);

    assert(s.length === 1, 'Cropped buffer preserves sliced sample');
    assert(s[0].zFront === 4.0, `Sliced sample zFront clamped to znear=4.0 (got ${s[0].zFront})`);
    assert(s[0].zBack === 10.0, 'Sliced sample zBack preserved at 10.0');

    // Total thickness was 8.0 (2 to 10). Preserved thickness is 6.0 (4 to 10).
    // Fraction preserved = 6 / 8 = 0.75.
    // Expected new alpha = 1 - (1 - 0.8)^0.75 = 1 - (0.2)^0.75 ≈ 1 - 0.29907 = 0.70093
    const expectedAlpha = 1.0 - Math.pow(1.0 - 0.8, 0.75);
    assert(Math.abs(s[0].a - expectedAlpha) < 1e-4,
      `Sliced volumetric alpha (${s[0].a.toFixed(4)}) matches physical Beer-Lambert prediction (${expectedAlpha.toFixed(4)})`);
  }

  console.log('\n================================================================');
  console.log(`✅ ALL DEEP OPS TESTS PASSED (${passed}/${passed + failed})`);
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});

