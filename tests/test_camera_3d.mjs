/**
 * OpenComp Test Suite - Camera3D & Optics Engine (Workstream 4.2)
 * Rigorously verifies:
 * 1. Physical optics calculations (focal length, apertures, FOV)
 * 2. Perspective projection matrix and center optical axis alignment
 * 3. Screen space quadrant projection behavior
 * 4. Camera ray casting (unproject / getRay)
 * 5. Camera3DNode DAG evaluation, axis parenting, and serialization
 */

import { strict as assert } from 'assert';
import { Vector3 } from '../src/core/3d/Vector3.js';
import { Matrix4 } from '../src/core/3d/Matrix4.js';
import { Camera3D } from '../src/core/3d/Camera3D.js';
import { Camera3DNode } from '../src/nodes/Camera3DNode.js';
import { Axis3DNode } from '../src/nodes/Axis3DNode.js';
import { Graph } from '../src/core/Graph.js';

console.log('================================================================');
console.log('🎯 RUNNING: tests/test_camera_3d.mjs (Workstream 4.2)');
console.log('================================================================\n');

let passedTests = 0;

function runTest(name, fn) {
  try {
    process.stdout.write(`▶ ${name} ... `);
    fn();
    console.log('✔ PASS');
    passedTests++;
  } catch (err) {
    console.log('❌ FAIL');
    console.error(err);
    process.exit(1);
  }
}

// -------------------------------------------------------------
// Test 1: Physical Optics & FOV Derivation
// -------------------------------------------------------------
runTest('Test 1: Physical Optics & FOV Derivation', () => {
  const cam = new Camera3D();
  cam.focal = 50.0;
  cam.haperture = 24.89; // Super 35 width
  cam.vaperture = 18.67; // Super 35 height

  // Analytical FOV: 2 * atan(h / (2 * f))
  const expectedHRad = 2.0 * Math.atan(24.89 / (2.0 * 50.0));
  const expectedHDeg = (expectedHRad * 180.0) / Math.PI;

  const actualHDeg = cam.getHorizontalFov(true);
  const actualHRad = cam.getHorizontalFov(false);

  assert.ok(Math.abs(actualHRad - expectedHRad) < 1e-6);
  assert.ok(Math.abs(actualHDeg - expectedHDeg) < 1e-4);
  assert.ok(actualHDeg > 27.0 && actualHDeg < 29.0, `Expected ~27.9 deg, got ${actualHDeg}`);
});

// -------------------------------------------------------------
// Test 2: Center Optical Axis Perspective Projection
// -------------------------------------------------------------
runTest('Test 2: Center Optical Axis Perspective Projection', () => {
  const cam = new Camera3D();
  cam.worldMatrix.makeTranslation(0, 0, 10); // Cam at z = 10 looking at -Z

  const width = 1920;
  const height = 1080;

  // Target point directly on optical axis (x=0, y=0, z=0, 10 units in front of cam)
  const centerTarget = new Vector3(0, 0, 0);
  const proj = cam.project(centerTarget, width, height);

  assert.ok(proj.inFront, 'Point should be in front of camera');
  assert.ok(Math.abs(proj.x - width * 0.5) < 0.001, `X must project to screen center ${width * 0.5}, got ${proj.x}`);
  assert.ok(Math.abs(proj.y - height * 0.5) < 0.001, `Y must project to screen center ${height * 0.5}, got ${proj.y}`);
});

// -------------------------------------------------------------
// Test 3: Off-Axis Quadrant Perspective Projections
// -------------------------------------------------------------
runTest('Test 3: Off-Axis Quadrant Perspective Projections', () => {
  const cam = new Camera3D();
  cam.worldMatrix.makeTranslation(0, 0, 10);

  const W = 1920, H = 1080;

  // Top-Right point in front of camera (+X, +Y, z=0)
  const pTR = new Vector3(2, 2, 0);
  const projTR = cam.project(pTR, W, H);
  assert.ok(projTR.x > W * 0.5, 'Right point must project to right half of screen');
  assert.ok(projTR.y < H * 0.5, 'Upper point must project to top half of screen (Y-down screen space)');

  // Bottom-Left point (-X, -Y, z=0)
  const pBL = new Vector3(-2, -2, 0);
  const projBL = cam.project(pBL, W, H);
  assert.ok(projBL.x < W * 0.5, 'Left point must project to left half of screen');
  assert.ok(projBL.y > H * 0.5, 'Lower point must project to bottom half of screen');

  // Point behind camera (z = 20)
  const pBehind = new Vector3(0, 0, 20);
  const projBehind = cam.project(pBehind, W, H);
  assert.equal(projBehind.inFront, false, 'Point behind camera must flag inFront = false');
});

// -------------------------------------------------------------
// Test 4: Camera Ray Casting (getRay)
// -------------------------------------------------------------
runTest('Test 4: Camera Ray Casting (getRay)', () => {
  const cam = new Camera3D();
  cam.worldMatrix.makeTranslation(0, 0, 10); // Cam at (0, 0, 10)

  const W = 1920, H = 1080;
  const ray = cam.getRay(W * 0.5, H * 0.5, W, H);

  // Center ray direction must point strictly along -Z: (0, 0, -1)
  assert.ok(Math.abs(ray.direction.x) < 1e-4);
  assert.ok(Math.abs(ray.direction.y) < 1e-4);
  assert.ok(Math.abs(ray.direction.z - (-1.0)) < 1e-4, `Ray direction Z must be -1, got ${ray.direction.z}`);
});

// -------------------------------------------------------------
// Test 5: Camera3DNode DAG Evaluation & Parent Axis Chaining
// -------------------------------------------------------------
runTest('Test 5: Camera3DNode DAG Evaluation & Parent Axis Chaining', () => {
  const graph = new Graph();

  // Parent Axis: rotated 90 deg around Y
  const axis = new Axis3DNode('cam_parent_axis');
  axis.setKnobValue('rotateY', 90.0);
  graph.addNode(axis);

  // Camera: translated +10 Z relative to parent
  const camNode = new Camera3DNode('cam_node');
  camNode.setKnobValue('translateZ', 10.0);
  graph.addNode(camNode);

  // Connect parent axis -> camera
  graph.connect(axis.id, 'out', camNode.id, 'axis');

  // Evaluate camera
  const out = graph.evaluate(camNode.id, 1);
  assert.ok(out.isCamera);
  assert.ok(out.camera instanceof Camera3D);

  // Point at camera origin (0, 0, 0 in cam space) transformed to world space:
  // (0, 0, 10) rotated 90 deg around Y should land at (10, 0, 0)
  const worldOrigin = new Vector3(0, 0, 0).transformMat4(out.worldMatrix);
  assert.ok(Math.abs(worldOrigin.x - 10.0) < 1e-4, `Expected X=10, got ${worldOrigin.x}`);
  assert.ok(Math.abs(worldOrigin.y) < 1e-4);
  assert.ok(Math.abs(worldOrigin.z) < 1e-4, `Expected Z=0, got ${worldOrigin.z}`);

  // Test Camera Serialization
  const s = out.camera.serialize();
  const restored = Camera3D.deserialize(s);
  assert.equal(restored.focal, 50.0);
  assert.equal(restored.haperture, 24.89);
});

console.log('\n================================================================');
console.log(`✅ ALL CAMERA 3D TESTS PASSED (${passedTests}/5)`);
console.log('================================================================');

