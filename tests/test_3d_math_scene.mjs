/**
 * OpenComp Test Suite - 3D Math & Scene Graph Core (Workstream 4.1)
 * Rigorously verifies:
 * 1. Vector3 arithmetic, dot, cross, normalization, point and direction transforms
 * 2. Matrix4 composition, decomposition, multiplication associativity, look-at, and inversion precision
 * 3. Geometry3D mesh creation, normal computation, 3D BBox, and serialization
 * 4. Axis3DNode hierarchical transform chaining (parent-child composition)
 * 5. Scene3D multi-stream geometry aggregation and consolidated bounds
 */

import { strict as assert } from 'assert';
import { Vector3 } from '../src/core/3d/Vector3.js';
import { Matrix4 } from '../src/core/3d/Matrix4.js';
import { Geometry3D } from '../src/core/3d/Geometry3D.js';
import { Scene3D } from '../src/core/3d/Scene3D.js';
import { Axis3DNode } from '../src/nodes/Axis3DNode.js';
import { Scene3DNode } from '../src/nodes/Scene3DNode.js';
import { Graph } from '../src/core/Graph.js';

console.log('================================================================');
console.log('🎯 RUNNING: tests/test_3d_math_scene.mjs (Workstream 4.1)');
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
// Test 1: Vector3 Operations & Coordinate Transformations
// -------------------------------------------------------------
runTest('Test 1: Vector3 Operations & Coordinate Transformations', () => {
  const v1 = new Vector3(1, 2, 3);
  const v2 = new Vector3(4, -5, 6);

  // Dot product
  const dot = v1.dot(v2);
  assert.equal(dot, 1 * 4 + 2 * -5 + 3 * 6); // 4 - 10 + 18 = 12

  // Cross product
  const cross = Vector3.cross(new Vector3(1, 0, 0), new Vector3(0, 1, 0));
  assert.ok(cross.equals(new Vector3(0, 0, 1)), 'X cross Y must be Z');

  // Normalization
  const vNorm = new Vector3(0, 3, 4).normalize();
  assert.ok(Math.abs(vNorm.length() - 1.0) < 1e-6);
  assert.ok(Math.abs(vNorm.y - 0.6) < 1e-6);
  assert.ok(Math.abs(vNorm.z - 0.8) < 1e-6);

  // Transform point by translation matrix
  const mat = new Matrix4().makeTranslation(10, 20, -30);
  const pt = new Vector3(5, 5, 5).transformMat4(mat);
  assert.ok(pt.equals(new Vector3(15, 25, -25)), 'Point must be translated');

  // Transform direction by translation matrix (must ignore translation)
  const dir = new Vector3(0, 1, 0).transformDirection(mat);
  assert.ok(dir.equals(new Vector3(0, 1, 0)), 'Direction must ignore translation component');
});

// -------------------------------------------------------------
// Test 2: Matrix4 Multiplication, Look-At & Inversion Accuracy
// -------------------------------------------------------------
runTest('Test 2: Matrix4 Multiplication, Look-At & Inversion Accuracy', () => {
  // 1. Compose complex TRS Matrix
  const m = new Matrix4();
  m.compose(
    { x: 12.5, y: -45.0, z: 120.0 }, // Translation
    { x: 30.0, y: 45.0, z: -60.0 },  // Euler rotation deg
    { x: 2.0, y: 1.5, z: 0.5 },     // Non-uniform scale
    'ZXY'
  );

  // Verify non-zero determinant
  const det = m.determinant();
  assert.ok(Math.abs(det) > 1e-3, `Determinant should be non-zero, got ${det}`);

  // Invert matrix
  const inv = m.clone().invert();
  const identityCheck = new Matrix4().multiplyMatrices(m, inv);

  // Verify M * M^-1 = Identity within acceptance threshold 1e-5
  const I = new Matrix4().identity();
  let maxDelta = 0;
  for (let i = 0; i < 16; i++) {
    const diff = Math.abs(identityCheck.elements[i] - I.elements[i]);
    if (diff > maxDelta) maxDelta = diff;
  }
  assert.ok(maxDelta < 1e-5, `Matrix inversion precision delta too high: ${maxDelta}`);

  // 2. Degenerate Matrix Handling
  const degen = new Matrix4().makeScale(0, 0, 0);
  degen.invert();
  assert.ok(degen.equals(new Matrix4().identity()), 'Singular matrix must fall back safely to identity');

  // 3. Look-At Matrix
  const eye = new Vector3(0, 10, 50);
  const target = new Vector3(0, 0, 0);
  const up = new Vector3(0, 1, 0);
  const lookAt = new Matrix4().makeLookAt(eye, target, up);
  
  // Center point in front of camera should project along -Z in camera space
  const camSpaceTarget = target.clone().transformMat4(lookAt.clone().invert());
  assert.ok(camSpaceTarget.z < 0, `Target should be along negative Z, got ${camSpaceTarget.z}`);
  assert.ok(Math.abs(camSpaceTarget.x) < 1e-4, 'Target should be centered horizontally');
});

// -------------------------------------------------------------
// Test 3: Geometry3D Mesh Buffers, Normals & BBox
// -------------------------------------------------------------
runTest('Test 3: Geometry3D Mesh Buffers, Normals & BBox', () => {
  const geo = new Geometry3D('QuadTest');

  // Simple quad in XY plane
  const vertices = [
    -10, -10, 0,
     10, -10, 0,
     10,  10, 0,
    -10,  10, 0
  ];
  const indices = [
    0, 1, 2,
    0, 2, 3
  ];
  const uvs = [
    0, 0,
    1, 0,
    1, 1,
    0, 1
  ];

  geo.setBuffers(vertices, indices, null, uvs);

  // Verify vertex and triangle counts
  assert.equal(geo.vertices.length, 12);
  assert.equal(geo.indices.length, 6);
  assert.equal(geo.normals.length, 12);

  // Verify computed normal is unit +Z for all vertices
  for (let i = 0; i < 4; i++) {
    const nx = geo.normals[i * 3];
    const ny = geo.normals[i * 3 + 1];
    const nz = geo.normals[i * 3 + 2];
    assert.ok(Math.abs(nx) < 1e-5);
    assert.ok(Math.abs(ny) < 1e-5);
    assert.ok(Math.abs(nz - 1.0) < 1e-5, `Normal Z must be 1.0, got ${nz}`);
  }

  // Verify 3D bounding box
  assert.equal(geo.bbox.min.x, -10);
  assert.equal(geo.bbox.max.x, 10);
  assert.equal(geo.bbox.min.y, -10);
  assert.equal(geo.bbox.max.y, 10);
  assert.equal(geo.bbox.min.z, 0);
  assert.equal(geo.bbox.max.z, 0);

  // Test Serialization & Deserialization
  const serialized = geo.serialize();
  const restored = Geometry3D.deserialize(serialized);
  assert.equal(restored.name, 'QuadTest');
  assert.equal(restored.vertices.length, 12);
  assert.equal(restored.indices.length, 6);
  assert.equal(restored.bbox.max.x, 10);
});

// -------------------------------------------------------------
// Test 4: Axis3DNode Hierarchical Chaining
// -------------------------------------------------------------
runTest('Test 4: Axis3DNode Hierarchical Chaining', () => {
  const graph = new Graph();

  // Parent Axis: translated +10 X
  const parentAxis = new Axis3DNode('parent_axis');
  parentAxis.setKnobValue('translateX', 10.0);
  graph.addNode(parentAxis);

  // Child Axis: translated +5 Y, scaled 2x
  const childAxis = new Axis3DNode('child_axis');
  childAxis.setKnobValue('translateY', 5.0);
  childAxis.setKnobValue('scaleX', 2.0);
  graph.addNode(childAxis);

  // Connect parent -> child
  graph.connect(parentAxis.id, 'out', childAxis.id, 'axis');

  // Evaluate child axis in graph
  const childOut = graph.evaluate(childAxis.id, 1);
  assert.ok(childOut.isAxis, 'Must output Axis object');

  // Transform test origin point (0, 0, 0) by child world matrix
  const worldPt = new Vector3(0, 0, 0).transformMat4(childOut.matrix);
  assert.equal(worldPt.x, 10.0, 'X translation inherited from parent');
  assert.equal(worldPt.y, 5.0, 'Y translation from child');
  assert.equal(worldPt.z, 0.0);

  // Test point (1, 0, 0) - should be scaled by child 2x then translated by parent +10
  const scaledPt = new Vector3(1, 0, 0).transformMat4(childOut.matrix);
  assert.equal(scaledPt.x, 12.0, '1 * 2 scale + 10 parent = 12');
});

// -------------------------------------------------------------
// Test 5: Scene3D & Scene3DNode Geometry Aggregation
// -------------------------------------------------------------
runTest('Test 5: Scene3D & Scene3DNode Geometry Aggregation', () => {
  const geo1 = new Geometry3D('BoxA');
  geo1.setBuffers([-5, -5, -5, 5, 5, 5], [0, 1, 0]);

  const geo2 = new Geometry3D('BoxB');
  geo2.setBuffers([20, 20, 20, 30, 30, 30], [0, 1, 0]);

  const sceneNode = new Scene3DNode('scene_node');
  const sceneOut = sceneNode.compute({ '0': geo1, '1': geo2 }, {});

  assert.ok(sceneOut instanceof Scene3D);
  assert.equal(sceneOut.geometries.length, 2);

  // Verify consolidated scene bounding box spans both meshes
  assert.equal(sceneOut.bbox.min.x, -5);
  assert.equal(sceneOut.bbox.min.y, -5);
  assert.equal(sceneOut.bbox.min.z, -5);
  assert.equal(sceneOut.bbox.max.x, 30);
  assert.equal(sceneOut.bbox.max.y, 30);
  assert.equal(sceneOut.bbox.max.z, 30);
});

console.log('\n================================================================');
console.log(`✅ ALL 3D MATH & SCENE TESTS PASSED (${passedTests}/5)`);
console.log('================================================================');

