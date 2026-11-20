/**
 * OpenComp - Phase 6.4: USD & Alembic Scene Exchange Automated Test Suite
 * Validates:
 * 1. OpenUSD Stage Ingestion (.usd, .usda ASCII, .usdc Crate binary)
 *    - Prim hierarchy traversal and metadata inspection
 *    - Mesh extraction (points, quad/n-gon triangulation, normals, UVs, bounding box)
 *    - Parity between ASCII USDA and binary USDC Crate formats
 *    - Unit scale normalization (metersPerUnit) and custom scale multiplier
 *    - Coordinate conversion (+Z to +Y up-axis rotation)
 *    - Animated camera extraction and sampling over time
 *    - Animated deforming wave mesh sampling over time
 *    - Point decimation stride (LOD downsampling)
 *    - Graceful error handling for malformed or missing USD files
 * 2. Alembic (.abc Ogawa binary) Archive Ingestion
 *    - Ogawa header validation and manifest inspection
 *    - Animated point cache reading at integer frames
 *    - Fractional sub-frame time sampling and linear blend interpolation
 *    - Camera optics extraction (focal length, aperture, clip planes)
 *    - Graceful error handling for malformed Alembic archives
 * 3. Unified Node Graph & ScanlineRender CPU Integration
 *    - USDReadNode in Graph with PipelineTokens path expansion
 *    - AlembicReadNode in Graph with sub-frame offset knob
 *    - Upstream scene stream merging (combining Scene3D inputs)
 *    - SoftwareRasterizer CPU rendering of ingested USD geometry & camera
 *    - Bidirectional Foundry Nuke (.nk) serialization and deserialization
 *    - Temporary bridge artifact cleanup and memory efficiency
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { USDBridgeClient } from '../src/core/3d/USDBridgeClient.js';
import { AlembicBridgeClient } from '../src/core/3d/AlembicBridgeClient.js';
import { Scene3D } from '../src/core/3d/Scene3D.js';
import { Geometry3D } from '../src/core/3d/Geometry3D.js';
import { Camera3D } from '../src/core/3d/Camera3D.js';
import { Graph } from '../src/core/Graph.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { NukeScriptIO } from '../src/core/NukeScriptIO.js';
import { NODE_REGISTRY, NODE_MENU, createNode } from '../src/nodes/index.js';
import { USDReadNode } from '../src/nodes/USDReadNode.js';
import { AlembicReadNode } from '../src/nodes/AlembicReadNode.js';
import { ScanlineRenderNode } from '../src/nodes/ScanlineRenderNode.js';
import { Cube3DNode } from '../src/nodes/Cube3DNode.js';

let passed = 0;
let failed = 0;

function check(title, fn) {
  try {
    process.stdout.write(`▶ ${title}... `);
    fn();
    passed++;
    console.log('✅ PASSED');
  } catch (err) {
    failed++;
    console.log('❌ FAILED');
    console.error(err);
  }
}

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_usd_alembic_scene_io.mjs (Phase 6.4)');
console.log('====================================================\n');

// ============================================================================
// SECTION 1: OpenUSD Stage Ingestion
// ============================================================================
console.log('--- SECTION 1: OpenUSD (.usd, .usda, .usdc) Stage Ingestion ---');

check('1.1 USD Stage Inspection (cube_static.usda)', () => {
  const meta = USDBridgeClient.inspect('tests/fixtures/cube_static.usda');
  assert.equal(meta.format, 'OpenUSD');
  assert.equal(meta.upAxis, 'Y');
  assert.equal(meta.metersPerUnit, 1.0);
  assert.ok(Array.isArray(meta.prims));
  
  const cubePrim = meta.prims.find(p => p.path === '/World/CubeMesh');
  assert.ok(cubePrim, 'Cube prim found at /World/CubeMesh');
  assert.equal(cubePrim.type, 'Mesh');
  assert.equal(cubePrim.pointCount, 8);
  assert.equal(cubePrim.faceCount, 6);
  assert.equal(cubePrim.triangleCount, 12);
  assert.equal(cubePrim.hasNormals, true);
  assert.equal(cubePrim.hasUVs, true);
});

check('1.2 USD Stage Mesh Extraction (cube_static.usda)', () => {
  const scene = USDBridgeClient.read('tests/fixtures/cube_static.usda', {
    primPath: '/World/CubeMesh'
  });
  assert.ok(scene instanceof Scene3D);
  assert.equal(scene.geometries.length, 1);

  const geom = scene.geometries[0];
  assert.equal(geom.name, 'CubeMesh');
  assert.equal(geom.primPath, '/World/CubeMesh');
  // 8 vertices * 3 coords = 24 floats
  assert.equal(geom.vertices.length, 24);
  // 6 quads triangulated into 12 triangles * 3 indices = 36 indices
  assert.equal(geom.indices.length, 36);
  // 8 normals * 3 coords = 24 floats
  assert.equal(geom.normals.length, 24);
  // 8 UVs * 2 coords = 16 floats
  assert.equal(geom.uvs.length, 16);

  // Check bounding box [-1, -1, -1] to [1, 1, 1]
  assert.ok(Math.abs(geom.bbox.min.x - (-1.0)) < 1e-4);
  assert.ok(Math.abs(geom.bbox.max.x - 1.0) < 1e-4);
  assert.ok(Math.abs(geom.bbox.min.y - (-1.0)) < 1e-4);
  assert.ok(Math.abs(geom.bbox.max.y - 1.0) < 1e-4);
  assert.ok(Math.abs(geom.bbox.min.z - (-1.0)) < 1e-4);
  assert.ok(Math.abs(geom.bbox.max.z - 1.0) < 1e-4);
});

check('1.3 Binary Crate USDC Parity (cube_static.usdc vs cube_static.usda)', () => {
  const sceneUSDA = USDBridgeClient.read('tests/fixtures/cube_static.usda');
  const sceneUSDC = USDBridgeClient.read('tests/fixtures/cube_static.usdc');

  assert.equal(sceneUSDC.geometries.length, sceneUSDA.geometries.length);
  const gA = sceneUSDA.geometries[0];
  const gC = sceneUSDC.geometries[0];

  assert.equal(gC.vertices.length, gA.vertices.length);
  assert.equal(gC.indices.length, gA.indices.length);
  assert.equal(gC.normals.length, gA.normals.length);
  assert.equal(gC.uvs.length, gA.uvs.length);

  for (let i = 0; i < gA.vertices.length; i++) {
    assert.ok(Math.abs(gA.vertices[i] - gC.vertices[i]) < 1e-5, `Vertex float mismatch at index ${i}`);
  }
  for (let i = 0; i < gA.indices.length; i++) {
    assert.equal(gA.indices[i], gC.indices[i], `Index mismatch at index ${i}`);
  }
});

check('1.4 Unit Scale Normalization (metersPerUnit = 0.01 in hierarchy_set.usda)', () => {
  const sceneAuto = USDBridgeClient.read('tests/fixtures/hierarchy_set.usda', {
    primPath: '/World/Buildings/BuildingA',
    scale: 0.01
  });
  const geom = sceneAuto.geometries[0];
  assert.ok(geom, 'BuildingA geometry read successfully');
  
  let maxCoord = -Infinity;
  for (let i = 0; i < geom.vertices.length; i++) {
    if (Math.abs(geom.vertices[i]) > maxCoord) maxCoord = Math.abs(geom.vertices[i]);
  }
  assert.ok(Math.abs(maxCoord - 2.0) < 1e-4, `Expected max dimension 2.0m, got ${maxCoord}`);

  const sceneCustom = USDBridgeClient.read('tests/fixtures/hierarchy_set.usda', {
    primPath: '/World/Buildings/BuildingA',
    scale: 0.1
  });
  let maxCoordCustom = -Infinity;
  for (let i = 0; i < sceneCustom.geometries[0].vertices.length; i++) {
    if (Math.abs(sceneCustom.geometries[0].vertices[i]) > maxCoordCustom) {
      maxCoordCustom = Math.abs(sceneCustom.geometries[0].vertices[i]);
    }
  }
  assert.ok(Math.abs(maxCoordCustom - 20.0) < 1e-4, `Expected custom scaled dimension 20.0, got ${maxCoordCustom}`);
});

check('1.5 Up-Axis Conversion (+Z to +Y in hierarchy_set.usda)', () => {
  const sceneZ = USDBridgeClient.read('tests/fixtures/hierarchy_set.usda', {
    upAxis: 'Z'
  });
  const geom = sceneZ.geometries[0];
  assert.ok(geom.vertices.length > 0);
  
  // In Z-up coordinate system, original Z (200 cm) is rotated to +Y
  assert.ok(geom.bbox.max.y > 0, `Bounding box max Y must be positive after Z-to-Y conversion (got ${geom.bbox.max.y})`);
});

check('1.6 Animated Camera Time Sampling (camera_animated.usda)', () => {
  const sceneF1 = USDBridgeClient.read('tests/fixtures/camera_animated.usda', {
    frame: 1.0,
    readMeshes: false
  });
  assert.equal(sceneF1.cameras.length, 1);
  const cam1 = sceneF1.cameras[0];
  assert.ok(Math.abs(cam1.focal - 35.0) < 1e-3, `Expected focal 35mm at frame 1, got ${cam1.focal}`);
  assert.ok(Math.abs(cam1.haperture - 24.89) < 1e-2, `Expected haperture ~24.89mm, got ${cam1.haperture}`);
  assert.ok(Math.abs(cam1.vaperture - 18.67) < 1e-2, `Expected vaperture ~18.67mm, got ${cam1.vaperture}`);
  assert.ok(Math.abs(cam1.near - 0.1) < 1e-3);
  assert.ok(Math.abs(cam1.far - 5000.0) < 1e-3);

  // Read camera at frame 5.0 (focalLength = 35 + 4*3 = 47mm)
  const sceneF5 = USDBridgeClient.read('tests/fixtures/camera_animated.usda', {
    frame: 5.0,
    readMeshes: false
  });
  const cam5 = sceneF5.cameras[0];
  assert.ok(Math.abs(cam5.focal - 47.0) < 1e-3, `Expected focal 47mm at frame 5, got ${cam5.focal}`);

  // Read camera at frame 10.0 (focalLength = 35 + 9*3 = 62mm)
  const sceneF10 = USDBridgeClient.read('tests/fixtures/camera_animated.usda', {
    frame: 10.0,
    readMeshes: false
  });
  const cam10 = sceneF10.cameras[0];
  assert.ok(Math.abs(cam10.focal - 62.0) < 1e-3, `Expected focal 62mm at frame 10, got ${cam10.focal}`);
});

check('1.7 Animated Deforming Wave Mesh Time Sampling (animated_deform.usda)', () => {
  const sceneF1 = USDBridgeClient.read('tests/fixtures/animated_deform.usda', { frame: 1.0 });
  const sceneF5 = USDBridgeClient.read('tests/fixtures/animated_deform.usda', { frame: 5.0 });

  const geomF1 = sceneF1.geometries[0];
  const geomF5 = sceneF5.geometries[0];

  assert.equal(geomF1.vertices.length, geomF5.vertices.length);

  let differences = 0;
  for (let i = 0; i < geomF1.vertices.length; i++) {
    if (Math.abs(geomF1.vertices[i] - geomF5.vertices[i]) > 1e-4) {
      differences++;
    }
  }
  assert.ok(differences > 0, `Vertices must deform over time (found ${differences} changed coordinates)`);
});

check('1.8 Point Decimation Stride (LOD Downsampling)', () => {
  const sceneFull = USDBridgeClient.read('tests/fixtures/cube_static.usda', { stride: 1 });
  const sceneLOD = USDBridgeClient.read('tests/fixtures/cube_static.usda', { stride: 2 });

  const gFull = sceneFull.geometries[0];
  const gLOD = sceneLOD.geometries[0];

  assert.equal(gFull.vertices.length, 24); // 8 vertices
  assert.equal(gLOD.vertices.length, 12);  // 4 vertices (decimated by 2)
});

check('1.9 Malformed and Missing USD Error Recovery', () => {
  assert.throws(() => {
    USDBridgeClient.read('tests/fixtures/non_existent_file.usda');
  }, /not found/i);

  assert.throws(() => {
    USDBridgeClient.read('tests/fixtures/malformed.usda');
  }, /(USD read error|failed)/i);
});

// ============================================================================
// SECTION 2: Alembic (.abc) Archive Ingestion
// ============================================================================
console.log('\n--- SECTION 2: Alembic (.abc Ogawa) Archive Ingestion ---');

check('2.1 Alembic Archive Inspection (animated_mesh.abc)', () => {
  const meta = AlembicBridgeClient.inspect('tests/fixtures/animated_mesh.abc');
  assert.equal(meta.format, 'Alembic');
  assert.equal(meta.archiveType, 'Ogawa');
  assert.equal(meta.fps, 24.0);
  assert.ok(Array.isArray(meta.objects));

  const torusObj = meta.objects.find(o => o.path === '/world/animated_torus' || o.name === 'animated_torus');
  assert.ok(torusObj, 'Torus object found in Alembic hierarchy');
  assert.equal(torusObj.type, 'PolyMesh');
  assert.equal(torusObj.pointCount, 4);

  const camObj = meta.objects.find(o => o.path === '/world/camera_tracking' || o.name === 'camera_tracking');
  assert.ok(camObj, 'Camera object found in Alembic hierarchy');
  assert.equal(camObj.type, 'Camera');
});

check('2.2 Alembic Integer Frame Reading (animated_mesh.abc)', () => {
  const scene = AlembicBridgeClient.read('tests/fixtures/animated_mesh.abc', {
    frame: 1.0,
    subframe: 0.0
  });

  assert.ok(scene instanceof Scene3D);
  assert.equal(scene.geometries.length, 1);
  const geom = scene.geometries[0];
  assert.equal(geom.name, 'animated_torus');
  // 4 vertices * 3 coords = 12 floats
  assert.equal(geom.vertices.length, 12);
  // 1 quad triangulated into 2 triangles * 3 indices = 6 indices
  assert.equal(geom.indices.length, 6);
  assert.equal(geom.normals.length, 12);
  assert.equal(geom.uvs.length, 8);

  // In frame 1, Y coordinate displacement was 0.0
  assert.ok(Math.abs(geom.vertices[1] - 0.0) < 1e-4, `Expected Y=0.0 at frame 1, got ${geom.vertices[1]}`);
});

check('2.3 Fractional Sub-Frame Time Sampling & Linear Blending', () => {
  // Keyframe 1: Y = 0.0
  // Keyframe 5: Y = 1.5
  // At frame 3.0: alpha = (3 - 1) / (5 - 1) = 0.5 -> Y = 0.75
  const scene = AlembicBridgeClient.read('tests/fixtures/animated_mesh.abc', {
    frame: 3.0,
    subframe: 0.0
  });
  const geom = scene.geometries[0];
  assert.ok(Math.abs(geom.vertices[1] - 0.75) < 1e-4, `Expected exact interpolated Y=0.75, got ${geom.vertices[1]}`);

  // Test fractional subframe offset: frame 1 + subframe 0.5 = frame 1.5
  // alpha = (1.5 - 1) / 4 = 0.125 -> Y = 0.125 * 1.5 = 0.1875
  const sceneSub = AlembicBridgeClient.read('tests/fixtures/animated_mesh.abc', {
    frame: 1.0,
    subframe: 0.5
  });
  const geomSub = sceneSub.geometries[0];
  assert.ok(Math.abs(geomSub.vertices[1] - 0.1875) < 1e-4, `Expected interpolated Y=0.1875 at frame 1.5, got ${geomSub.vertices[1]}`);
});

check('2.4 Alembic Camera Extraction', () => {
  const scene = AlembicBridgeClient.read('tests/fixtures/animated_mesh.abc', {
    frame: 1.0
  });
  assert.equal(scene.cameras.length, 1);
  const cam = scene.cameras[0];
  assert.equal(cam.name, 'camera_tracking');
  assert.ok(Math.abs(cam.focal - 50.0) < 1e-3, `Expected focal 50mm, got ${cam.focal}`);
  assert.ok(Math.abs(cam.haperture - 24.89) < 1e-2);
  assert.ok(Math.abs(cam.vaperture - 18.67) < 1e-2);
});

check('2.5 Malformed Alembic Archive Error Handling', () => {
  assert.throws(() => {
    AlembicBridgeClient.read('tests/fixtures/malformed.abc');
  }, /(Invalid Ogawa archive header|failed)/i);
});

// ============================================================================
// SECTION 3: Unified Node Graph & ScanlineRender Integration
// ============================================================================
console.log('\n--- SECTION 3: Node Graph & ScanlineRender Integration ---');

check('3.1 USDReadNode Ingestion with PipelineTokens Evaluation', () => {
  const node = new USDReadNode('USDRead1');
  node.setKnobValue('file', '${FIXTURE_DIR}/${FILE_NAME}.usda');
  
  const context = {
    FIXTURE_DIR: 'tests/fixtures',
    FILE_NAME: 'cube_static',
    frame: 1.0
  };

  const scene = node.compute({}, context);
  assert.ok(scene instanceof Scene3D);
  assert.equal(scene.geometries.length, 1);
  assert.equal(scene.geometries[0].name, 'CubeMesh');
  assert.equal(scene.geometries[0].primPath, '/World/CubeMesh');
  assert.equal(scene.geometries[0].vertices.length, 24);
});

check('3.2 AlembicReadNode Ingestion with Sub-Frame Knob', () => {
  const node = new AlembicReadNode('AlembicRead1');
  node.setKnobValue('file', 'tests/fixtures/animated_mesh.abc');
  node.setKnobValue('useTimelineFrame', false);
  node.setKnobValue('frame', 1.0);
  node.setKnobValue('subFrame', 0.5);

  const scene = node.compute({}, {});
  assert.ok(scene instanceof Scene3D);
  assert.equal(scene.geometries.length, 1);
  assert.ok(Math.abs(scene.geometries[0].vertices[1] - 0.1875) < 1e-4);
});

check('3.3 Upstream Scene Stream Merging', () => {
  const cubeNode = new Cube3DNode('Cube3D_upstream');
  const upstreamScene = cubeNode.compute({}, {});

  const usdNode = new USDReadNode('USDRead_merge');
  usdNode.setKnobValue('file', 'tests/fixtures/cube_static.usda');

  const mergedScene = usdNode.compute({ in: upstreamScene }, {});
  assert.ok(mergedScene instanceof Scene3D);
  assert.equal(mergedScene.geometries.length, 2);
  assert.equal(mergedScene.geometries[0].name, 'Cube3D_upstream');
  assert.equal(mergedScene.geometries[1].name, 'CubeMesh');
});

check('3.4 CPU SoftwareRasterizer & ScanlineRender Multi-Pass Rendering', () => {
  const usdScene = USDBridgeClient.read('tests/fixtures/cube_static.usda');
  
  const cam = new Camera3D();
  cam.name = 'RenderCam';
  cam.worldMatrix.makeTranslation(0, 0, 4);
  cam.focal = 35.0;
  cam.haperture = 24.89;
  cam.vaperture = 18.67;
  cam.near = 0.1;
  cam.far = 100.0;
  usdScene.addCamera(cam);

  const renderNode = new ScanlineRenderNode('ScanlineRender1');
  renderNode.setKnobValue('format', 'custom');
  renderNode.setKnobValue('width', 128);
  renderNode.setKnobValue('height', 128);
  renderNode.setKnobValue('shading', 'solid');
  renderNode.setKnobValue('outputDepth', true);

  const rendered = renderNode.compute({
    obj: usdScene,
    cam: cam
  }, { frame: 1.0 });

  assert.ok(rendered instanceof PixelBuffer, 'Render output is a valid PixelBuffer');
  assert.equal(rendered.width, 128);
  assert.equal(rendered.height, 128);

  const centerIdx = (64 * 128 + 64) * 4;
  const alpha = rendered.data[centerIdx + 3];
  assert.ok(alpha > 0.5, `Cube must be rendered at center with alpha > 0.5 (got ${alpha})`);

  assert.ok(rendered.extraChannels.has('depth.Z'), 'depth.Z channel generated');
  const depthBuf = rendered.extraChannels.get('depth.Z');
  const centerDepth = depthBuf[64 * 128 + 64];
  assert.ok(centerDepth > 0 && centerDepth < 100.0, `Center depth is valid distance (got ${centerDepth})`);
});

check('3.5 Project Serialization & NukeScriptIO (.nk) Round-Trip', () => {
  const graph = new Graph();
  const usdNode = new USDReadNode('USDRead_test', 100, 150);
  usdNode.setKnobValue('file', '/shows/Avatar/sh01/cube.usda');
  usdNode.setKnobValue('primPath', '/World/Set');
  usdNode.setKnobValue('upAxis', 'Z');
  usdNode.setKnobValue('scale', 'centimeters');
  usdNode.setKnobValue('stride', 2);
  graph.addNode(usdNode);

  const abcNode = new AlembicReadNode('AlembicRead_test', 300, 150);
  abcNode.setKnobValue('file', '/shows/Avatar/sh01/creature.abc');
  abcNode.setKnobValue('objectPath', '/Creature/Body');
  abcNode.setKnobValue('stride', 1);
  graph.addNode(abcNode);

  const nkScript = NukeScriptIO.exportToNuke(graph);
  assert.ok(nkScript.includes('USDRead {'), 'Nuke script contains USDRead block');
  assert.ok(nkScript.includes('AlembicRead {'), 'Nuke script contains AlembicRead block');
  assert.ok(nkScript.includes('file /shows/Avatar/sh01/cube.usda'), 'USDRead file knob preserved in .nk');
  assert.ok(nkScript.includes('file /shows/Avatar/sh01/creature.abc'), 'AlembicRead file knob preserved in .nk');

  const deserializedGraph = new Graph();
  NukeScriptIO.importFromNuke(
    nkScript,
    (type, id, x, y) => createNode(type, id, x, y),
    deserializedGraph
  );

  assert.equal(deserializedGraph.getAllNodes().length, 2);

  const restoredUSD = deserializedGraph.getAllNodes().find(n => n.type === 'USDRead');
  assert.ok(restoredUSD, 'USDReadNode restored from .nk');
  assert.equal(restoredUSD.getKnobValue('file'), '/shows/Avatar/sh01/cube.usda');

  const restoredABC = deserializedGraph.getAllNodes().find(n => n.type === 'AlembicRead');
  assert.ok(restoredABC, 'AlembicReadNode restored from .nk');
  assert.equal(restoredABC.getKnobValue('file'), '/shows/Avatar/sh01/creature.abc');
});

check('3.6 Temporary File Cleanup & Memory Efficiency', () => {
  const tmpDir = os.tmpdir();
  const beforeFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('opencomp_'));

  for (let i = 0; i < 5; i++) {
    USDBridgeClient.read('tests/fixtures/cube_static.usda');
    AlembicBridgeClient.read('tests/fixtures/animated_mesh.abc', { frame: 1.0 });
  }

  const afterFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('opencomp_'));
  assert.equal(afterFiles.length, beforeFiles.length, 'All temporary binary OC3D containers cleaned up automatically');
});

// ============================================================================
// SUMMARY
// ============================================================================
console.log('\n====================================================');
console.log('📊 PHASE 6.4 USD & ALEMBIC SCENE EXCHANGE TEST RESULTS');
console.log(`Total Checks:  ${passed + failed}`);
console.log(`Passed:        ${passed}`);
console.log(`Failed:        ${failed}`);
console.log('====================================================');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL PHASE 6.4 USD & ALEMBIC SCENE EXCHANGE TESTS PASSED!');
  process.exit(0);
}
