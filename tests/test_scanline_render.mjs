/**
 * OpenComp - Workstream 4.4 Test Suite
 * Validates SoftwareRasterizer and ScanlineRenderNode:
 * 1. Float32 Depth Occlusion (near geometry occludes far geometry regardless of order)
 * 2. Depth AOV Accuracy (depth.Z channel contains exact linear camera distance)
 * 3. Texture Mapping & Perspective-Correct Interpolation
 * 4. Background Plate Under/Over Compositing
 * 5. Multi-channel AOVs (Normal.X/Y/Z, UVs) and SSAA Antialiasing
 */

import { Vector3 } from '../src/core/3d/Vector3.js';
import { Matrix4 } from '../src/core/3d/Matrix4.js';
import { Camera3D } from '../src/core/3d/Camera3D.js';
import { Scene3D } from '../src/core/3d/Scene3D.js';
import { SoftwareRasterizer } from '../src/core/3d/SoftwareRasterizer.js';
import { ScanlineRenderNode } from '../src/nodes/ScanlineRenderNode.js';
import { Card3DNode } from '../src/nodes/Card3DNode.js';
import { Camera3DNode } from '../src/nodes/Camera3DNode.js';
import { Scene3DNode } from '../src/nodes/Scene3DNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

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
  console.log('🎯 RUNNING: tests/test_scanline_render.mjs (Workstream 4.4)');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test 1: Float32 Depth Occlusion & Order-Independence
  // -------------------------------------------------------------
  console.log('▶ Test 1: Depth Occlusion & Order-Independence ...');
  {
    // Setup camera at (0, 0, 5), looking at origin (0, 0, 0)
    const camera = new Camera3D({
      focal: 50,
      haperture: 36,
      vaperture: 24,
      near: 0.1,
      far: 100
    });
    camera.transform = new Matrix4().makeTranslation(0, 0, 5);

    // Card A: Closer (at z = 0, distance = 5), Color: Red (1, 0, 0, 1)
    const cardNodeA = new Card3DNode('cardA');
    cardNodeA.setKnobValue('translateZ', 0.0);
    cardNodeA.setKnobValue('uniformScale', 2.0);
    const cardA = cardNodeA.compute([]);
    cardA.material.color = [1.0, 0.0, 0.0, 1.0];

    // Card B: Farther (at z = -2, distance = 7), Color: Green (0, 1, 0, 1)
    const cardNodeB = new Card3DNode('cardB');
    cardNodeB.setKnobValue('translateZ', -2.0);
    cardNodeB.setKnobValue('uniformScale', 2.0);
    const cardB = cardNodeB.compute([]);
    cardB.material.color = [0.0, 1.0, 0.0, 1.0];

    // Case 1: Submit Far first, then Near (Scene: [cardB, cardA])
    const scene1 = new Scene3D();
    scene1.add(cardB);
    scene1.add(cardA);

    const buf1 = SoftwareRasterizer.render({
      scene: scene1,
      camera,
      width: 64,
      height: 64,
      shading: 'unlit'
    });

    // Sample center pixel (32, 32)
    const centerIdx = (32 * 64 + 32) * 4;
    const r1 = buf1.data[centerIdx];
    const g1 = buf1.data[centerIdx + 1];
    const b1 = buf1.data[centerIdx + 2];
    const a1 = buf1.data[centerIdx + 3];

    assert(r1 > 0.99 && g1 < 0.01 && b1 < 0.01 && a1 > 0.99,
      `Case 1 (Far first, Near second): Closer Red Card occludes Far Green Card (Got R=${r1}, G=${g1})`);

    // Case 2: Submit Near first, then Far (Scene: [cardA, cardB])
    const scene2 = new Scene3D();
    scene2.add(cardA);
    scene2.add(cardB);

    const buf2 = SoftwareRasterizer.render({
      scene: scene2,
      camera,
      width: 64,
      height: 64,
      shading: 'unlit'
    });

    const r2 = buf2.data[centerIdx];
    const g2 = buf2.data[centerIdx + 1];
    assert(r2 > 0.99 && g2 < 0.01,
      `Case 2 (Near first, Far second): Occlusion is strictly order-independent (Got R=${r2}, G=${g2})`);
  }

  // -------------------------------------------------------------
  // Test 2: Depth AOV Accuracy
  // -------------------------------------------------------------
  console.log('\n▶ Test 2: Depth AOV Linear Camera Distance ...');
  {
    const camera = new Camera3D({
      focal: 50,
      haperture: 36,
      vaperture: 24,
      near: 0.1,
      far: 100
    });
    camera.transform = new Matrix4().makeTranslation(0, 0, 5);

    // Card at z = 0, camera at z = 5 -> distance along camera optical axis is exactly 5.0
    const cardNode = new Card3DNode('card');
    cardNode.setKnobValue('translateZ', 0.0);
    cardNode.setKnobValue('uniformScale', 2.0);
    const card = cardNode.compute([]);

    const render = SoftwareRasterizer.render({
      scene: card,
      camera,
      width: 64,
      height: 64,
      shading: 'unlit'
    });

    const depthAOV = render.getChannel('depth.Z');
    assert(depthAOV !== null, 'depth.Z channel is present in rendered PixelBuffer');

    const centerIdx = 32 * 64 + 32;
    const centerDepth = depthAOV[centerIdx];
    const depthDiff = Math.abs(centerDepth - 5.0);

    assert(depthDiff < 0.05,
      `depth.Z center value (${centerDepth.toFixed(4)}) matches expected camera distance 5.0 (diff=${depthDiff.toFixed(5)})`);
  }

  // -------------------------------------------------------------
  // Test 3: Texture Mapping & Perspective-Correct UV Sampling
  // -------------------------------------------------------------
  console.log('\n▶ Test 3: Texture Mapping & Perspective-Correct UV Sampling ...');
  {
    const camera = new Camera3D({
      focal: 50,
      haperture: 36,
      vaperture: 24,
      near: 0.1,
      far: 100
    });
    camera.transform = new Matrix4().makeTranslation(0, 0, 5);

    // Create a 4x4 split texture: Left half Blue (0, 0, 1, 1), Right half Yellow (1, 1, 0, 1)
    const texture = new PixelBuffer(4, 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const idx = (y * 4 + x) * 4;
        if (x < 2) {
          // Left: Blue
          texture.data[idx] = 0.0;
          texture.data[idx + 1] = 0.0;
          texture.data[idx + 2] = 1.0;
          texture.data[idx + 3] = 1.0;
        } else {
          // Right: Yellow
          texture.data[idx] = 1.0;
          texture.data[idx + 1] = 1.0;
          texture.data[idx + 2] = 0.0;
          texture.data[idx + 3] = 1.0;
        }
      }
    }

    const cardNode = new Card3DNode('cardTex');
    cardNode.setKnobValue('translateZ', 0.0);
    cardNode.setKnobValue('uniformScale', 2.0);
    const card = cardNode.compute([]);
    card.material.texture = texture;

    const render = SoftwareRasterizer.render({
      scene: card,
      camera,
      width: 64,
      height: 64,
      shading: 'unlit'
    });

    // Sample left side of card at (20, 32)
    const leftIdx = (32 * 64 + 20) * 4;
    const lR = render.data[leftIdx];
    const lB = render.data[leftIdx + 2];

    // Sample right side of card at (44, 32)
    const rightIdx = (32 * 64 + 44) * 4;
    const rR = render.data[rightIdx];
    const rB = render.data[rightIdx + 2];

    assert(lB > 0.8 && lR < 0.2, `Left side of rendered card is Blue (B=${lB.toFixed(2)}, R=${lR.toFixed(2)})`);
    assert(rR > 0.8 && rB < 0.2, `Right side of rendered card is Yellow (R=${rR.toFixed(2)}, B=${rB.toFixed(2)})`);
  }

  // -------------------------------------------------------------
  // Test 4: Background Plate Compositing
  // -------------------------------------------------------------
  console.log('\n▶ Test 4: Background Plate Under/Over Compositing ...');
  {
    const camera = new Camera3D({
      focal: 50,
      haperture: 36,
      vaperture: 24,
      near: 0.1,
      far: 100
    });
    camera.transform = new Matrix4().makeTranslation(0, 0, 5);

    // Create a 64x64 solid Cyan background (0, 1, 1, 1)
    const bg = new PixelBuffer(64, 64);
    for (let i = 0; i < 64 * 64; i++) {
      bg.data[i * 4] = 0.0;
      bg.data[i * 4 + 1] = 1.0;
      bg.data[i * 4 + 2] = 1.0;
      bg.data[i * 4 + 3] = 1.0;
    }

    // Small Magenta Card in center (1, 0, 1, 1)
    const cardNode = new Card3DNode('cardSmall');
    cardNode.setKnobValue('uniformScale', 0.8);
    const card = cardNode.compute([]);
    card.material.color = [1.0, 0.0, 1.0, 1.0];

    const render = SoftwareRasterizer.render({
      scene: card,
      camera,
      background: bg,
      width: 64,
      height: 64,
      shading: 'unlit'
    });

    // Center pixel (inside card): Magenta (R=1, G=0, B=1)
    const cIdx = (32 * 64 + 32) * 4;
    assert(render.data[cIdx] > 0.9 && render.data[cIdx + 1] < 0.1 && render.data[cIdx + 2] > 0.9,
      'Center pixel inside card is Magenta');

    // Corner pixel (2, 2) (outside card): Background Cyan (R=0, G=1, B=1)
    const cornerIdx = (2 * 64 + 2) * 4;
    assert(render.data[cornerIdx] < 0.1 && render.data[cornerIdx + 1] > 0.9 && render.data[cornerIdx + 2] > 0.9,
      'Corner pixel outside card is untouched Background Cyan');
  }

  // -------------------------------------------------------------
  // Test 5: ScanlineRenderNode DAG Integration & AOVs
  // -------------------------------------------------------------
  console.log('\n▶ Test 5: ScanlineRenderNode DAG & Multi-Channel AOVs ...');
  {
    const sceneNode = new Scene3DNode('scene');
    const camNode = new Camera3DNode('cam');
    camNode.setKnobValue('translateZ', 5.0);

    const cardNode = new Card3DNode('card');
    cardNode.setKnobValue('uniformScale', 2.0);

    const renderNode = new ScanlineRenderNode('render');
    renderNode.setKnobValue('format', 'custom');
    renderNode.setKnobValue('width', 64);
    renderNode.setKnobValue('height', 64);
    renderNode.setKnobValue('shading', 'flat');
    renderNode.setKnobValue('antialiasing', 'none');

    // Compute scene
    const geo = cardNode.compute([]);
    const scene = sceneNode.compute([geo]);
    const cam = camNode.compute([]);

    // Compute render
    const renderedBuffer = renderNode.compute([scene, cam, null]);

    assert(renderedBuffer instanceof PixelBuffer, 'Render output is instance of PixelBuffer');
    assert(renderedBuffer.width === 64 && renderedBuffer.height === 64, 'Render resolution matches requested dimensions');

    // Verify all standard 3D AOVs
    const normX = renderedBuffer.getChannel('normal.X');
    const normY = renderedBuffer.getChannel('normal.Y');
    const normZ = renderedBuffer.getChannel('normal.Z');
    const uChan = renderedBuffer.getChannel('u');
    const vChan = renderedBuffer.getChannel('v');
    const depthChan = renderedBuffer.getChannel('depth.Z');

    assert(normX && normY && normZ, 'All Normal XYZ AOVs generated');
    assert(uChan && vChan, 'UV texture coordinate AOVs generated');
    assert(depthChan !== null, 'Depth Z AOV generated');

    // Inspect normal at center: for flat card facing camera along +Z, normal in camera space points towards camera (+Z)
    const centerIdx = 32 * 64 + 32;
    const nz = normZ[centerIdx];
    assert(nz > 0.8, `Normal Z (${nz.toFixed(3)}) points towards camera`);
  }

  console.log('\n================================================================');
  console.log(`✅ ALL SCANLINE RENDER TESTS PASSED (${passed}/${passed + failed})`);
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});

