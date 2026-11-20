/**
 * OpenComp - Department 2: PAINT Verification & Test Suite
 * Validates manual cleanup and paint tools: soft brush, spatial clone stamping,
 * clean-plate reveal, local blur brush, eraser, and non-destructive stroke storage.
 */

import { strict as assert } from 'assert';
import { PaintStroke, PaintPoint } from '../src/core/PaintStroke.js';
import { PaintNode } from '../src/nodes/PaintNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_paint_department.mjs');
console.log('====================================================\n');

let passedTests = 0;

function runTest(name, fn) {
  try {
    process.stdout.write(`▶ ${name}... `);
    fn();
    console.log(`✅ PASSED`);
    passedTests++;
  } catch (err) {
    console.log(`❌ FAILED`);
    console.error(err);
    process.exit(1);
  }
}

// 1. Solid Color Soft Brush Stamping
runTest('Solid Color Soft Radial Brush Stamping', () => {
  const buf = new PixelBuffer(100, 100);
  buf.data.fill(0.0); // Black canvas

  const stroke = new PaintStroke('brush');
  stroke.color = [1.0, 0.0, 0.0, 1.0]; // Red
  stroke.size = 20.0;
  stroke.hardness = 0.5;
  stroke.opacity = 1.0;
  stroke.addPoint(50, 50, 1.0);

  stroke.render(buf, null, null);

  // Center (50, 50) must be pure red [1.0, 0.0, 0.0, 1.0]
  const centerIdx = (50 * 100 + 50) * 4;
  assert.equal(buf.data[centerIdx], 1.0);
  assert.equal(buf.data[centerIdx + 1], 0.0);
  assert.equal(buf.data[centerIdx + 2], 0.0);

  // Edge at radius 8 (within feather) should be partially red
  const edgeIdx = (50 * 100 + 58) * 4;
  assert(buf.data[edgeIdx] > 0.0 && buf.data[edgeIdx] <= 1.0);

  // Far pixel (10, 10) must remain black
  const farIdx = (10 * 100 + 10) * 4;
  assert.equal(buf.data[farIdx], 0.0);
});

// 2. Spatial Clone Stamp (Wire / Rig Cleanup)
runTest('Spatial Clone Stamp (Texture Offset Copying)', () => {
  const buf = new PixelBuffer(100, 100);
  // Source area at (20, 50): pure white texture
  for (let y = 40; y <= 60; y++) {
    for (let x = 10; x <= 30; x++) {
      const idx = (y * 100 + x) * 4;
      buf.data[idx] = 1.0;
      buf.data[idx + 1] = 1.0;
      buf.data[idx + 2] = 1.0;
      buf.data[idx + 3] = 1.0;
    }
  }

  // Clone stroke: paint over (70, 50) sampling from (20, 50) => dx = 70 - 20 = 50, dy = 0
  const clone = new PaintStroke('clone');
  clone.size = 14.0;
  clone.hardness = 1.0;
  clone.cloneOffset = { dx: 50, dy: 0 };
  clone.addPoint(70, 50, 1.0);

  const baseCopy = buf.clone();
  clone.render(buf, baseCopy, null);

  // Target destination (70, 50) should now have cloned texture (white = 1.0)
  const targetIdx = (50 * 100 + 70) * 4;
  assert.equal(buf.data[targetIdx], 1.0);
  assert.equal(buf.data[targetIdx + 1], 1.0);
  assert.equal(buf.data[targetIdx + 2], 1.0);
});

// 3. Clean Plate Reveal Brush
runTest('Clean Plate Reveal Brush', () => {
  const currentPlate = new PixelBuffer(100, 100);
  currentPlate.data.fill(0.2); // Dark gray scene with artifact

  const cleanPlate = new PixelBuffer(100, 100);
  cleanPlate.data.fill(0.9); // Clean plate without artifact

  const reveal = new PaintStroke('reveal');
  reveal.size = 16.0;
  reveal.hardness = 1.0;
  reveal.opacity = 1.0;
  reveal.addPoint(30, 30, 1.0);

  reveal.render(currentPlate, null, cleanPlate);

  const idx = (30 * 100 + 30) * 4;
  assert.equal(Math.abs(currentPlate.data[idx] - 0.9) < 1e-4, true);

  // Untouched area remains 0.2
  const unIdx = (80 * 100 + 80) * 4;
  assert.equal(Math.abs(currentPlate.data[unIdx] - 0.2) < 1e-4, true);
});

// 4. Local Blur Brush
runTest('Local Interactive Blur Brush', () => {
  const buf = new PixelBuffer(100, 100);
  buf.data.fill(0.0);
  // Put high contrast 1.0 impulse at (50, 50)
  buf.data[(50 * 100 + 50) * 4] = 1.0;

  const blurStroke = new PaintStroke('blur');
  blurStroke.size = 10.0;
  blurStroke.opacity = 1.0;
  blurStroke.addPoint(50, 50, 1.0);

  blurStroke.render(buf, null, null);

  // Center impulse should be softened/diffused to surrounding pixels
  const centerVal = buf.data[(50 * 100 + 50) * 4];
  assert(centerVal < 1.0, 'Impulse should be diffused');
  assert(buf.data[(50 * 100 + 51) * 4] > 0.0, 'Adjacent pixel should receive diffused energy');
});

// 5. PaintNode DAG Evaluation and Stroke Persistence
runTest('PaintNode DAG Evaluation and Serialization Roundtrip', () => {
  const paintNode = new PaintNode('Paint_Clean');
  const stroke = new PaintStroke('brush');
  stroke.color = [0.0, 1.0, 0.0, 1.0]; // Green
  stroke.size = 10.0;
  stroke.addPoint(15, 15);
  paintNode.addStroke(stroke);

  const plate = new PixelBuffer(50, 50);
  plate.data.fill(0.1);

  const out = paintNode.compute({ in: plate }, { frame: 1 });
  assert(out !== null);
  assert.equal(out.width, 50);

  const idx = (15 * 50 + 15) * 4;
  assert.equal(out.data[idx + 1], 1.0); // Green channel painted

  // Test serialization
  const data = paintNode.serialize();
  assert(data.strokes && data.strokes.length === 1);
  assert.equal(data.strokes[0].type, 'brush');

  const restored = new PaintNode('Paint_Restored');
  restored.deserialize(data);
  assert.equal(restored.strokes.length, 1);
  assert.equal(restored.strokes[0].type, 'brush');
  assert.equal(restored.strokes[0].points.length, 1);
});

console.log(`\n🎉 test_paint_department.mjs PASSED: All ${passedTests} tests succeeded!\n`);

