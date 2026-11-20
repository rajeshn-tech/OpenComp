/**
 * OpenComp - Department 1: ROTO Verification & Test Suite
 * Validates manual rotoscoping tools: Bezier splines, point-level tangents,
 * edge feathering, subpixel anti-aliasing, boolean shape operations, and animated keyframes.
 */

import { strict as assert } from 'assert';
import { RotoShape, RotoControlPoint } from '../src/core/RotoSpline.js';
import { RotoNode } from '../src/nodes/RotoNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_roto_department.mjs');
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

// 1. Control Point Tangents & Animation
runTest('Roto Control Point Tangents & Multi-Frame Animation', () => {
  const pt = new RotoControlPoint(100, 100);
  pt.setKey(1, 100, 100, -10, 0, 10, 0, 5.0);
  pt.setKey(11, 200, 300, -20, 0, 20, 0, 15.0);

  const f1 = pt.getAtFrame(1);
  assert.equal(f1.x, 100);
  assert.equal(f1.y, 100);
  assert.equal(f1.feather, 5.0);

  const f11 = pt.getAtFrame(11);
  assert.equal(f11.x, 200);
  assert.equal(f11.y, 300);
  assert.equal(f11.feather, 15.0);

  // Interpolated frame 6
  const f6 = pt.getAtFrame(6);
  assert.equal(f6.x, 150);
  assert.equal(f6.y, 200);
  assert.equal(f6.feather, 10.0);
});

// 2. Bezier Spline Sampling
runTest('Cubic Bezier Spline Boundary Sampling', () => {
  const shape = new RotoShape('Character_Head', 'bezier');
  // Create a 4-point closed box with smooth tangents
  shape.addPoint(50, 50, 0, -10, 0, 10, 1);
  shape.addPoint(150, 50, -10, 0, 10, 0, 1);
  shape.addPoint(150, 150, 0, -10, 0, 10, 1);
  shape.addPoint(50, 150, 10, 0, -10, 0, 1);

  const sampled = shape.sampleCurve(1, 8);
  assert(sampled.length > 20, 'Dense perimeter should have > 20 sampled vertices');
  assert(sampled[0].x !== undefined);
  assert(sampled[0].y !== undefined);
});

// 3. Scanline Rasterization Accuracy (Inside vs Outside)
runTest('Subpixel Scanline Polygon Rasterization', () => {
  const shape = new RotoShape('Matte_Box', 'polygon');
  shape.addPoint(20, 20);
  shape.addPoint(80, 20);
  shape.addPoint(80, 80);
  shape.addPoint(20, 80);

  const alpha = new Float32Array(100 * 100);
  shape.rasterize(alpha, 100, 100, 1);

  // Inside center (50, 50) must be 1.0
  assert.equal(alpha[50 * 100 + 50], 1.0);
  // Outside (10, 10) must be 0.0
  assert.equal(alpha[10 * 100 + 10], 0.0);
  // Outside (95, 95) must be 0.0
  assert.equal(alpha[95 * 100 + 95], 0.0);
});

// 4. Feather Edge Falloff
runTest('Soft Edge Distance Feather Falloff', () => {
  const shape = new RotoShape('Feathered_Circle', 'bezier');
  shape.feather = 10.0;
  shape.addPoint(50, 20, -15, 0, 15, 0);
  shape.addPoint(80, 50, 0, -15, 0, 15);
  shape.addPoint(50, 80, 15, 0, -15, 0);
  shape.addPoint(20, 50, 0, 15, 0, -15);

  const alpha = new Float32Array(100 * 100);
  shape.rasterize(alpha, 100, 100, 1);

  const centerVal = alpha[50 * 100 + 50];
  assert(centerVal >= 0.95, 'Center must be fully solid opaque');

  // Edge near radius
  const edgeVal = alpha[50 * 100 + 20];
  assert(edgeVal > 0.0 && edgeVal < 1.0, 'Feather edge must have continuous falloff');

  // Far outside
  const farVal = alpha[50 * 100 + 2];
  assert.equal(farVal, 0.0);
});

// 5. Multi-Shape Boolean Combinations (Subtract & Intersect)
runTest('Multi-Shape Boolean Subtract and Intersect', () => {
  // Shape A: Outer box (20,20 to 80,80)
  const shapeA = new RotoShape('Outer_Box', 'polygon');
  shapeA.blendMode = 'add';
  shapeA.addPoint(20, 20);
  shapeA.addPoint(80, 20);
  shapeA.addPoint(80, 80);
  shapeA.addPoint(20, 80);

  // Shape B: Inner hole cutout (35,35 to 65,65)
  const shapeB = new RotoShape('Hole_Cutout', 'polygon');
  shapeB.blendMode = 'subtract';
  shapeB.addPoint(35, 35);
  shapeB.addPoint(65, 35);
  shapeB.addPoint(65, 65);
  shapeB.addPoint(35, 65);

  const alpha = new Float32Array(100 * 100);
  shapeA.rasterize(alpha, 100, 100, 1);
  shapeB.rasterize(alpha, 100, 100, 1);

  // Rim pixel (25, 25) should be 1.0
  assert.equal(alpha[25 * 100 + 25], 1.0);
  // Cutout center (50, 50) should be 0.0
  assert.equal(alpha[50 * 100 + 50], 0.0);
});

// 6. RotoNode DAG Integration & Serialization
runTest('RotoNode DAG Evaluation and Serialization Roundtrip', () => {
  const roto = new RotoNode('Roto_Char');
  const s = new RotoShape('Arm_Spline', 'bezier');
  s.addPoint(10, 10);
  s.addPoint(40, 10);
  s.addPoint(40, 40);
  s.addPoint(10, 40);
  roto.addShape(s);

  const inputPlate = new PixelBuffer(100, 100);
  inputPlate.data.fill(0.5); // 50% gray plate

  const out = roto.compute({ in: inputPlate }, { frame: 1 });
  assert(out !== null);
  assert.equal(out.width, 100);
  assert.equal(out.height, 100);

  // Inside matte: alpha = 1.0, RGB preserved
  const idxIn = (25 * 100 + 25) * 4;
  assert.equal(out.data[idxIn], 0.5);
  assert.equal(out.data[idxIn + 3], 1.0);

  // Outside matte: alpha = 0.0
  const idxOut = (5 * 100 + 5) * 4;
  assert.equal(out.data[idxOut + 3], 0.0);

  // Serialize / Deserialize
  const data = roto.serialize();
  assert(data.shapes && data.shapes.length === 1);
  assert.equal(data.shapes[0].name, 'Arm_Spline');

  const restored = new RotoNode('Roto_Restored');
  restored.deserialize(data);
  assert.equal(restored.shapes.length, 1);
  assert.equal(restored.shapes[0].name, 'Arm_Spline');
  assert.equal(restored.shapes[0].points.length, 4);
});

console.log(`\n🎉 test_roto_department.mjs PASSED: All ${passedTests} tests succeeded!\n`);

