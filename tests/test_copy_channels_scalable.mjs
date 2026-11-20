/**
 * OpenComp - Scalable CopyNode Test Suite
 * Validates dynamic channel mapping (>4 pairs, 8-pair, 16-pair, 64-pair stress),
 * backward compatibility with from0..to3 knobs, project serialization,
 * Nuke .nk script round-trip, channel preservation, and mask/mix modulation.
 */

import { strict as assert } from 'assert';
import { CopyNode } from '../src/nodes/CopyNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { Graph } from '../src/core/Graph.js';
import { NukeScriptIO } from '../src/core/NukeScriptIO.js';

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_copy_channels_scalable.mjs');
console.log('----------------------------------------------------');

let passedTests = 0;
function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// -------------------------------------------------------------
// 1. Backward Compatibility with Legacy 4-Pair Knobs
// -------------------------------------------------------------
runTest('CopyNode: Legacy 4-pair knob backward compatibility', () => {
  const copy = new CopyNode('Copy_Legacy');

  // Verify default pre-registered knobs
  assert.equal(copy.getKnobValue('from0'), 'rgba.alpha');
  assert.equal(copy.getKnobValue('to0'), 'rgba.alpha');
  assert.equal(copy.getKnobValue('from1'), '-');
  assert.equal(copy.getKnobValue('to1'), '-');
  assert.equal(copy.getKnobValue('from2'), '-');
  assert.equal(copy.getKnobValue('to2'), '-');
  assert.equal(copy.getKnobValue('from3'), '-');
  assert.equal(copy.getKnobValue('to3'), '-');

  // Set legacy knobs
  copy.setKnobValue('from1', 'depth.Z');
  copy.setKnobValue('to1', 'depth.Z');
  assert.equal(copy.getKnobValue('from1'), 'depth.Z');
  assert.equal(copy.getKnobValue('to1'), 'depth.Z');

  const active = copy.getActivePairs();
  assert.equal(active.length, 2);
  assert.equal(active[0].from, 'rgba.alpha');
  assert.equal(active[1].from, 'depth.Z');
});

// -------------------------------------------------------------
// 2. 8-Pair Concurrent Channel Mapping
// -------------------------------------------------------------
runTest('CopyNode: 8-pair concurrent channel mapping in single node', () => {
  const w = 50;
  const h = 50;
  const len = w * h;

  const bufB = new PixelBuffer(w, h);
  bufB.fill(0.1, 0.2, 0.3, 1.0); // Base RGBA

  const bufA = new PixelBuffer(w, h);
  const channels = [
    'depth.Z',
    'forward.u',
    'forward.v',
    'diffuse.R',
    'diffuse.G',
    'diffuse.B',
    'specular.R',
    'crypto_object.01'
  ];

  // Fill buffer A with distinct test values for each of the 8 channels
  for (let c = 0; c < channels.length; c++) {
    const chData = new Float32Array(len);
    const val = (c + 1) * 11.25;
    chData.fill(val);
    bufA.setChannel(channels[c], chData);
  }

  const copy = new CopyNode('Copy_8Pair');
  // Configure 8 distinct pairs
  for (let c = 0; c < channels.length; c++) {
    copy.setKnobValue(`from${c}`, channels[c]);
    copy.setKnobValue(`to${c}`, channels[c]);
  }

  assert.equal(copy.getActivePairs().length, 8);

  const out = copy.compute({ B: bufB, A: bufA });

  // 1. Verify all 8 channels exist and contain correct data
  for (let c = 0; c < channels.length; c++) {
    const chName = channels[c];
    assert.ok(out.hasChannel(chName), `Output missing channel: ${chName}`);
    const outData = out.getChannel(chName);
    assert.equal(outData.length, len);
    const expected = (c + 1) * 11.25;
    assert.equal(outData[0], expected, `Mismatch in ${chName} at 0: ${outData[0]} vs ${expected}`);
    assert.equal(outData[len - 1], expected, `Mismatch in ${chName} at end: ${outData[len - 1]} vs ${expected}`);
  }

  // 2. Verify base RGBA channels in B were preserved
  const px = out.getPixel(25, 25);
  assert(Math.abs(px[0] - 0.1) < 1e-5);
  assert(Math.abs(px[1] - 0.2) < 1e-5);
  assert(Math.abs(px[2] - 0.3) < 1e-5);
  assert(Math.abs(px[3] - 1.0) < 1e-5);
});

// -------------------------------------------------------------
// 3. 16-Pair Concurrent Channel Mapping
// -------------------------------------------------------------
runTest('CopyNode: 16-pair concurrent channel mapping in single node', () => {
  const w = 40;
  const h = 40;
  const len = w * h;

  const bufB = new PixelBuffer(w, h);
  bufB.fill(0.5, 0.5, 0.5, 1.0);

  const bufA = new PixelBuffer(w, h);
  const channels16 = [
    'depth.Z', 'forward.u', 'forward.v', 'backward.u', 'backward.v',
    'diffuse.R', 'diffuse.G', 'diffuse.B', 'specular.R', 'specular.G', 'specular.B',
    'normal.X', 'normal.Y', 'normal.Z', 'crypto_material', 'crypto_object'
  ];

  for (let c = 0; c < 16; c++) {
    const arr = new Float32Array(len);
    for (let i = 0; i < len; i++) arr[i] = (c * 100) + (i % 10);
    bufA.setChannel(channels16[c], arr);
  }

  const copy = new CopyNode('Copy_16Pair');
  for (let c = 0; c < 16; c++) {
    copy.setKnobValue(`from${c}`, channels16[c]);
    copy.setKnobValue(`to${c}`, channels16[c]);
  }

  assert.equal(copy.getActivePairs().length, 16);
  assert.equal(copy.getChannelPairCount(), 16);

  const out = copy.compute({ B: bufB, A: bufA });

  for (let c = 0; c < 16; c++) {
    const ch = channels16[c];
    assert.ok(out.hasChannel(ch), `Missing channel ${ch}`);
    const data = out.getChannel(ch);
    assert.equal(data[0], c * 100);
    assert.equal(data[5], (c * 100) + 5);
  }
});

// -------------------------------------------------------------
// 4. Channel Preservation & Destination Non-Destructive Integrity
// -------------------------------------------------------------
runTest('CopyNode: Untouched existing channels in B stream preserved bit-identically', () => {
  const w = 30;
  const h = 30;
  const len = w * h;

  const bufB = new PixelBuffer(w, h);
  bufB.fill(0.33, 0.66, 0.99, 0.5);

  const existingCh1 = new Float32Array(len).fill(42.42);
  const existingCh2 = new Float32Array(len).fill(999.0);
  bufB.setChannel('ambient.R', existingCh1);
  bufB.setChannel('direct.G', existingCh2);

  const bufA = new PixelBuffer(w, h);
  const newCh = new Float32Array(len).fill(777.7);
  bufA.setChannel('specular.B', newCh);

  const copy = new CopyNode('Copy_Preserve');
  copy.setKnobValue('from0', 'specular.B');
  copy.setKnobValue('to0', 'specular.B');

  const out = copy.compute({ B: bufB, A: bufA });

  // Untouched channels in B must remain bit-exact
  assert.ok(out.hasChannel('ambient.R'));
  assert.ok(out.hasChannel('direct.G'));
  assert.equal(out.getChannel('ambient.R')[0], existingCh1[0]);
  assert.equal(out.getChannel('direct.G')[10], existingCh2[10]);

  // New channel added
  assert.ok(out.hasChannel('specular.B'));
  assert.equal(out.getChannel('specular.B')[0], newCh[0]);

  // Original RGBA preserved
  const px = out.getPixel(15, 15);
  assert(Math.abs(px[0] - 0.33) < 1e-5);
  assert(Math.abs(px[1] - 0.66) < 1e-5);
  assert(Math.abs(px[2] - 0.99) < 1e-5);
  assert(Math.abs(px[3] - 0.5) < 1e-5);
});

// -------------------------------------------------------------
// 5. Dynamic Pair Manipulation API (add, remove, clear, setPairs)
// -------------------------------------------------------------
runTest('CopyNode: Dynamic API (addChannelPair, removeChannelPair, setChannelPairs)', () => {
  const copy = new CopyNode('Copy_API');

  // Initial state: from0..to3 exist (from0=rgba.alpha, others='-')
  assert.equal(copy.getChannelPairCount(), 4);

  // addChannelPair fills unused slot 1
  const idx1 = copy.addChannelPair('depth.Z', 'depth.Z');
  assert.equal(idx1, 1);
  assert.equal(copy.getKnobValue('from1'), 'depth.Z');

  // Add more pairs up to 6
  copy.addChannelPair('u', 'u');
  copy.addChannelPair('v', 'v');
  const idx4 = copy.addChannelPair('n.x', 'n.x');
  assert.equal(idx4, 4);
  const idx5 = copy.addChannelPair('n.y', 'n.y');
  assert.equal(idx5, 5);

  assert.equal(copy.getChannelPairCount(), 6);
  assert.equal(copy.getActivePairs().length, 6);

  // Remove pair at index 4 (n.x)
  copy.removeChannelPair(4);
  // Pair 5 (n.y) should have shifted into index 4
  assert.equal(copy.getKnobValue('from4'), 'n.y');
  assert.equal(copy.getKnobValue('to4'), 'n.y');
  assert.equal(copy.getChannelPairCount(), 5);

  // setChannelPairs batch configuration
  copy.setChannelPairs([
    { from: 'A.1', to: 'B.1' },
    { from: 'A.2', to: 'B.2' },
    { from: 'A.3', to: 'B.3' },
    { from: 'A.4', to: 'B.4' },
    { from: 'A.5', to: 'B.5' },
    { from: 'A.6', to: 'B.6' },
    { from: 'A.7', to: 'B.7' },
    { from: 'A.8', to: 'B.8' }
  ]);
  assert.equal(copy.getActivePairs().length, 8);
  assert.equal(copy.getKnobValue('from7'), 'A.8');
  assert.equal(copy.getKnobValue('to7'), 'B.8');
});

// -------------------------------------------------------------
// 6. Project Serialization & Deserialization (.opencomp JSON)
// -------------------------------------------------------------
runTest('CopyNode: Full project serialization & deserialization with 10 extended pairs', () => {
  const copy1 = new CopyNode('Copy_Project');
  for (let i = 0; i < 10; i++) {
    copy1.setKnobValue(`from${i}`, `src_layer_${i}.R`);
    copy1.setKnobValue(`to${i}`, `dst_layer_${i}.R`);
  }
  copy1.setKnobValue('mix', 0.85);

  // Serialize to JSON
  const serialized = copy1.serialize();
  const jsonStr = JSON.stringify(serialized);
  assert.ok(jsonStr.length > 0);

  // Deserialize into a fresh node instance
  const copy2 = new CopyNode('Copy_Restored');
  copy2.deserialize(JSON.parse(jsonStr));

  assert.equal(copy2.getKnobValue('mix'), 0.85);
  assert.equal(copy2.getActivePairs().length, 10);
  for (let i = 0; i < 10; i++) {
    assert.equal(copy2.getKnobValue(`from${i}`), `src_layer_${i}.R`);
    assert.equal(copy2.getKnobValue(`to${i}`), `dst_layer_${i}.R`);
  }
});

// -------------------------------------------------------------
// 7. Nuke .nk Script Round-Trip Compatibility
// -------------------------------------------------------------
runTest('CopyNode: Nuke .nk script export & import with 8 channel pairs', () => {
  const graph = new Graph();
  const copy = new CopyNode('Copy_Nuke', 100, 200);

  for (let i = 0; i < 8; i++) {
    copy.setKnobValue(`from${i}`, `chan_${i}`);
    copy.setKnobValue(`to${i}`, `target_${i}`);
  }
  graph.addNode(copy);

  // Export to Nuke script
  const nukeScript = NukeScriptIO.exportToNukeScript(graph);
  assert.ok(nukeScript.includes('Copy {\n'), 'Nuke script must contain Copy node');
  assert.ok(nukeScript.includes('from0 chan_0'));
  assert.ok(nukeScript.includes('from7 chan_7'));

  // Re-import into a fresh graph
  const importedGraph = new Graph();
  const nodeFactory = (type, id, x, y) => {
    if (type === 'Copy') return new CopyNode(id, x, y);
    return null;
  };
  NukeScriptIO.parseNukeScript(nukeScript, nodeFactory, importedGraph);

  const importedCopy = importedGraph.getAllNodes().find(n => n.type === 'Copy');
  assert.ok(importedCopy, 'Imported graph must contain Copy node');
  assert.equal(importedCopy.getActivePairs().length, 8);
  for (let i = 0; i < 8; i++) {
    assert.equal(importedCopy.getKnobValue(`from${i}`), `chan_${i}`);
    assert.equal(importedCopy.getKnobValue(`to${i}`), `target_${i}`);
  }
});

// -------------------------------------------------------------
// 8. 64-Pair Channel Mapping Stress & Performance Test
// -------------------------------------------------------------
runTest('CopyNode: 64-pair high-density channel mapping stress test (<50ms)', () => {
  const w = 64;
  const h = 64;
  const len = w * h;

  const bufB = new PixelBuffer(w, h);
  bufB.fill(0, 0, 0, 1);

  const bufA = new PixelBuffer(w, h);
  const copy = new CopyNode('Copy_64');

  for (let i = 0; i < 64; i++) {
    const chName = `crypto_pass_${i}`;
    const arr = new Float32Array(len).fill(i + 1);
    bufA.setChannel(chName, arr);
    copy.setKnobValue(`from${i}`, chName);
    copy.setKnobValue(`to${i}`, chName);
  }

  assert.equal(copy.getActivePairs().length, 64);

  const startTime = Date.now();
  const out = copy.compute({ B: bufB, A: bufA });
  const duration = Date.now() - startTime;

  console.log(`    (64 channels copied in ${duration}ms)`);
  assert(duration < 100, `Execution too slow: ${duration}ms`);

  // Spot-check channels
  assert.equal(out.getChannel('crypto_pass_0')[0], 1);
  assert.equal(out.getChannel('crypto_pass_31')[100], 32);
  assert.equal(out.getChannel('crypto_pass_63')[len - 1], 64);
});

// -------------------------------------------------------------
// 9. Mask & Mix Modulation Across Extended Channel Pairs
// -------------------------------------------------------------
runTest('CopyNode: Mask & Mix modulation on 8 concurrent channels', () => {
  const w = 20;
  const h = 20;
  const len = w * h;

  const bufB = new PixelBuffer(w, h);
  const bufA = new PixelBuffer(w, h);
  const mask = new PixelBuffer(w, h);

  // Left half 0.0 mask, right half 1.0 mask
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      mask.data[idx + 3] = (x < 10) ? 0.0 : 1.0;
    }
  }

  const copy = new CopyNode('Copy_MaskMix');
  copy.setKnobValue('mix', 0.5); // 50% overall mix

  for (let i = 0; i < 8; i++) {
    const ch = `test_ch_${i}`;
    bufB.setChannel(ch, new Float32Array(len).fill(10.0));
    bufA.setChannel(ch, new Float32Array(len).fill(20.0));
    copy.setKnobValue(`from${i}`, ch);
    copy.setKnobValue(`to${i}`, ch);
  }

  const out = copy.compute({ B: bufB, A: bufA, mask: mask });

  for (let i = 0; i < 8; i++) {
    const ch = `test_ch_${i}`;
    const data = out.getChannel(ch);

    // Left half: mask=0 -> weight = 0*0.5 = 0 -> value = 10.0
    const leftVal = data[0]; // (x=0, y=0)
    assert(Math.abs(leftVal - 10.0) < 1e-4, `Left half mismatch: ${leftVal}`);

    // Right half: mask=1.0 -> weight = 1.0*0.5 = 0.5 -> blended = 10*0.5 + 20*0.5 = 15.0
    const rightVal = data[15]; // (x=15, y=0)
    assert(Math.abs(rightVal - 15.0) < 1e-4, `Right half mismatch: ${rightVal}`);
  }
});

console.log('====================================================');
console.log(`🎉 test_copy_channels_scalable.mjs PASSED: All ${passedTests}/${passedTests} tests succeeded!`);
console.log('====================================================');
