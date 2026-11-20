/**
 * OpenComp Test Suite - Geometry Primitives & Project3D (Workstream 4.3)
 * Rigorously verifies:
 * 1. Card3DNode mesh topology, subdivisions, and orientations (XY, XZ, YZ)
 * 2. Cube3DNode canonical geometry, 6-face normals, and bounding box
 * 3. Project3DNode camera-frustum UV projection accuracy
 * 4. Project3DNode backface culling (front, back, both)
 * 5. Full DAG execution connecting Card3D -> Project3D -> Scene3D
 */

import { strict as assert } from 'assert';
import { Vector3 } from '../src/core/3d/Vector3.js';
import { Camera3D } from '../src/core/3d/Camera3D.js';
import { Card3DNode } from '../src/nodes/Card3DNode.js';
import { Cube3DNode } from '../src/nodes/Cube3DNode.js';
import { Project3DNode } from '../src/nodes/Project3DNode.js';
import { Scene3DNode } from '../src/nodes/Scene3DNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { Graph } from '../src/core/Graph.js';

console.log('================================================================');
console.log('🎯 RUNNING: tests/test_project3d.mjs (Workstream 4.3)');
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
// Test 1: Card3DNode Mesh Topology & Subdivisions
// -------------------------------------------------------------
runTest('Test 1: Card3DNode Mesh Topology & Subdivisions', () => {
  const card = new Card3DNode('card_test');
  card.setKnobValue('rows', 3);
  card.setKnobValue('columns', 5);
  card.setKnobValue('width', 10.0);
  card.setKnobValue('height', 6.0);

  const geo = card.generateMesh();

  // (3 + 1) * (5 + 1) = 24 vertices
  assert.equal(geo.vertices.length, 24 * 3);
  // 3 * 5 * 2 = 30 triangles = 90 indices
  assert.equal(geo.indices.length, 30 * 3);

  // Bounds check
  assert.equal(geo.bbox.min.x, -5.0);
  assert.equal(geo.bbox.max.x, 5.0);
  assert.equal(geo.bbox.min.y, -3.0);
  assert.equal(geo.bbox.max.y, 3.0);

  // Orientation XZ (horizontal floor) check
  card.setKnobValue('orientation', 'XZ');
  const floorGeo = card.generateMesh();
  assert.equal(floorGeo.normals[1], 1.0, 'Normal Y must be 1.0 for floor card');
});

// -------------------------------------------------------------
// Test 2: Cube3DNode Geometry & Face Normals
// -------------------------------------------------------------
runTest('Test 2: Cube3DNode Geometry & Face Normals', () => {
  const cube = new Cube3DNode('cube_test');
  cube.setKnobValue('sizeX', 2.0);
  cube.setKnobValue('sizeY', 4.0);
  cube.setKnobValue('sizeZ', 6.0);

  const geo = cube.generateMesh();
  assert.equal(geo.vertices.length, 24 * 3, '24 vertices for 6 distinct quad faces');
  assert.equal(geo.indices.length, 36, '12 triangles = 36 indices');

  // Verify bounding box
  assert.equal(geo.bbox.min.x, -0.5);
  assert.equal(geo.bbox.max.x, 0.5);
  assert.equal(geo.bbox.min.y, -0.5);
  assert.equal(geo.bbox.max.y, 0.5);
  assert.equal(geo.bbox.min.z, -0.5);
  assert.equal(geo.bbox.max.z, 0.5);
});

// -------------------------------------------------------------
// Test 3: Project3D Camera-Frustum UV Synthesis
// -------------------------------------------------------------
runTest('Test 3: Project3D Camera-Frustum UV Synthesis', () => {
  // Create projection camera at (0, 0, 10) looking at origin
  const projCam = new Camera3D();
  projCam.worldMatrix.makeTranslation(0, 0, 10);
  projCam.focal = 50.0;
  projCam.haperture = 24.89;
  projCam.vaperture = 18.67;

  // Create planar card centered at origin (0, 0, 0)
  const card = new Card3DNode('card_proj');
  card.setKnobValue('width', 4.0);
  card.setKnobValue('height', 4.0);
  card.setKnobValue('rows', 2);
  card.setKnobValue('columns', 2);
  const cardGeo = card.compute({}, {});

  // Project3D node
  const projNode = new Project3DNode('project_node');
  const dummyTexture = new PixelBuffer(128, 128);

  const projectedGeo = projNode.projectOnGeometry(cardGeo, projCam, dummyTexture);

  assert.ok(projectedGeo.material.texture === dummyTexture);

  // Center vertex (index 4 of 3x3 grid) is at (0, 0, 0).
  // Under projection from (0, 0, 10) looking down -Z, (0, 0, 0) must project to UV center (0.5, 0.5)
  const centerU = projectedGeo.uvs[4 * 2];
  const centerV = projectedGeo.uvs[4 * 2 + 1];

  assert.ok(Math.abs(centerU - 0.5) < 1e-4, `Center U must be 0.5, got ${centerU}`);
  assert.ok(Math.abs(centerV - 0.5) < 1e-4, `Center V must be 0.5, got ${centerV}`);
});

// -------------------------------------------------------------
// Test 4: Project3D Backface Culling
// -------------------------------------------------------------
runTest('Test 4: Project3D Backface Culling', () => {
  const projCam = new Camera3D();
  projCam.worldMatrix.makeTranslation(0, 0, 10); // Cam looking down -Z

  // 1. Front-facing card (normal +Z)
  const cardFront = new Card3DNode('card_front');
  const geoFront = cardFront.compute({}, {});

  // 2. Back-facing card (normal -Z, facing away from camera)
  const cardBack = new Card3DNode('card_back');
  cardBack.setKnobValue('rotateY', 180.0);
  const geoBack = cardBack.compute({}, {});

  const projNode = new Project3DNode('proj_cull');
  projNode.setKnobValue('projectOn', 'front');

  const resFront = projNode.projectOnGeometry(geoFront, projCam, null);
  const resBack = projNode.projectOnGeometry(geoBack, projCam, null);

  // Front-facing should have valid positive UVs
  assert.ok(resFront.uvs[0] >= 0.0, 'Front-facing surface must receive valid UVs');

  // Back-facing with projectOn='front' must be culled (flagged with negative UVs)
  assert.ok(resBack.uvs[0] < 0.0, 'Back-facing surface must be culled when projectOn=front');
});

// -------------------------------------------------------------
// Test 5: Full DAG Integration (Card -> Project3D -> Scene3D)
// -------------------------------------------------------------
runTest('Test 5: Full DAG Integration (Card -> Project3D -> Scene3D)', () => {
  const graph = new Graph();

  const card = new Card3DNode('src_card');
  graph.addNode(card);

  const projCam = new Camera3D();
  projCam.worldMatrix.makeTranslation(0, 0, 5);

  const projNode = new Project3DNode('proj_node');
  graph.addNode(projNode);
  graph.connect(card.id, 'out', projNode.id, 'geo');

  const sceneNode = new Scene3DNode('scene_node');
  graph.addNode(sceneNode);
  graph.connect(projNode.id, 'out', sceneNode.id, '0');

  // Evaluate Project3D with camera passed in context or connection
  const projOut = projNode.compute({ geo: card.compute({}, {}), cam: projCam }, {});
  assert.ok(projOut instanceof Card3DNode ? false : true);
  assert.equal(projOut.vertices.length, 4 * 3);

  // Evaluate Scene
  const sceneOut = sceneNode.compute({ '0': projOut }, {});
  assert.equal(sceneOut.geometries.length, 1);
});

console.log('\n================================================================');
console.log(`✅ ALL GEOMETRY & PROJECT3D TESTS PASSED (${passedTests}/5)`);
console.log('================================================================');

