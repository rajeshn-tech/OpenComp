/**
 * OpenComp - Phase 2.1 Step 2 Spatial BBox Test Suite
 * Validates dynamic BBox calculations, negative coordinate propagation,
 * perspective quad projection, morphological kernel conventions, stereo disparity bounding,
 * multi-input grid routing, and 16K ultra-resolution tile culling across 9 spatial nodes.
 */

import assert from 'node:assert/strict';
import { BBox } from '../src/core/BBox.js';
import { PixelBuffer, TiledPixelBuffer } from '../src/core/PixelBuffer.js';
import { CornerPinNode } from '../src/nodes/CornerPinNode.js';
import { EdgeBlurNode } from '../src/nodes/EdgeBlurNode.js';
import { ErodeNode } from '../src/nodes/ErodeNode.js';
import { StereoWarpNode } from '../src/nodes/StereoWarpNode.js';
import { GlowNode } from '../src/nodes/GlowNode.js';
import { ZDefocusNode } from '../src/nodes/ZDefocusNode.js';
import { ContactSheetNode } from '../src/nodes/ContactSheetNode.js';
import { SwitchNode } from '../src/nodes/SwitchNode.js';
import { StereoMergeNode } from '../src/nodes/StereoMergeNode.js';
import { CropNode } from '../src/nodes/CropNode.js';
import { ConstantNode } from '../src/nodes/ConstantNode.js';

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_spatial_bbox_nodes.mjs');
console.log('----------------------------------------------------');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
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
// 1. CornerPinNode: Perspective Projection, Negative Coordinates & Homography
// -------------------------------------------------------------
runTest('CornerPinNode: Perspective projection, negative bounds & degenerate safety', () => {
  const cp = new CornerPinNode('CP1');
  const buf = new PixelBuffer(1920, 1080);
  buf.bbox = new BBox(0, 0, 1920, 1080);

  // Negative origin corners (pin 1 outside bottom-left, pin 3 outside top-right)
  cp.setKnobValue('to1_x', -0.1); // -192 px
  cp.setKnobValue('to1_y', -0.1); // -108 px
  cp.setKnobValue('to2_x', 1.0);  // 1920 px
  cp.setKnobValue('to2_y', 0.0);  // 0 px
  cp.setKnobValue('to3_x', 1.1);  // 2112 px
  cp.setKnobValue('to3_y', 1.1);  // 1188 px
  cp.setKnobValue('to4_x', 0.0);  // 0 px
  cp.setKnobValue('to4_y', 1.0);  // 1080 px

  const bbox = cp.getBBox({ in: buf });
  assert.equal(bbox.x, -192);
  assert.equal(bbox.y, -108);
  assert.equal(bbox.r, 2112);
  assert.equal(bbox.t, 1188);

  // Verify compute sets result.bbox
  const res = cp.compute({ in: buf });
  assert.ok(res.bbox);
  assert.equal(res.bbox.x, -192);
  assert.equal(res.bbox.r, 2112);

  // Cropped sub-BBox forward projection through homography
  const croppedBuf = new PixelBuffer(1920, 1080);
  croppedBuf.bbox = new BBox(480, 270, 1440, 810); // Center quarter
  const subBBox = cp.getBBox({ in: croppedBuf });
  assert.ok(subBBox.x > -192 && subBBox.r < 2112, 'Sub-BBox must project within full quad');

  // Degenerate quad safety (all points collapsed to 0)
  cp.setKnobValue('to1_x', 0); cp.setKnobValue('to1_y', 0);
  cp.setKnobValue('to2_x', 0); cp.setKnobValue('to2_y', 0);
  cp.setKnobValue('to3_x', 0); cp.setKnobValue('to3_y', 0);
  cp.setKnobValue('to4_x', 0); cp.setKnobValue('to4_y', 0);
  const degenBBox = cp.getBBox({ in: buf });
  assert.ok(!isNaN(degenBBox.x) && !isNaN(degenBBox.y), 'Degenerate quad must return finite BBox');
});

// -------------------------------------------------------------
// 2. EdgeBlurNode: Blur Filter Radius & Edge Width Expansion
// -------------------------------------------------------------
runTest('EdgeBlurNode: Radial filter expansion and edge gradient support', () => {
  const node = new EdgeBlurNode('EB1');
  const buf = new PixelBuffer(1920, 1080);
  buf.bbox = new BBox(200, 200, 600, 600);

  // size = 5, edgeWidth = 3 -> pad = ceil(max(2*5, 5+3)) = 10
  node.setKnobValue('size', 5.0);
  node.setKnobValue('edgeWidth', 3.0);
  const bbox = node.getBBox({ in: buf });
  assert.equal(bbox.x, 190);
  assert.equal(bbox.y, 190);
  assert.equal(bbox.r, 610);
  assert.equal(bbox.t, 610);

  // Zero blur size -> exact input BBox preserved
  node.setKnobValue('size', 0.0);
  const noBlurBBox = node.getBBox({ in: buf });
  assert.ok(noBlurBBox.equals(buf.bbox));

  // Compute sets result.bbox
  node.setKnobValue('size', 4.0);
  node.setKnobValue('edgeWidth', 2.0);
  const res = node.compute({ in: buf });
  assert.ok(res.bbox);
  assert.equal(res.bbox.x, 192); // 200 - 8
  assert.equal(res.bbox.r, 608); // 600 + 8
});

// -------------------------------------------------------------
// 3. ErodeNode: Morphological Dilation (+size) and Erosion (-size)
// -------------------------------------------------------------
runTest('ErodeNode: Morphological dilation expansion (+size) and erosion contraction (-size)', () => {
  const node = new ErodeNode('Erode1');
  const buf = new PixelBuffer(1920, 1080);
  buf.bbox = new BBox(300, 300, 500, 500); // 200x200 box

  // Positive size = Dilation (expand matte outwards)
  node.setKnobValue('size', 8.0);
  const dilated = node.getBBox({ in: buf });
  assert.equal(dilated.x, 292);
  assert.equal(dilated.y, 292);
  assert.equal(dilated.r, 508);
  assert.equal(dilated.t, 508);

  // Negative size = Erosion (shrink matte inwards)
  node.setKnobValue('size', -6.0);
  const eroded = node.getBBox({ in: buf });
  assert.equal(eroded.x, 306);
  assert.equal(eroded.y, 306);
  assert.equal(eroded.r, 494);
  assert.equal(eroded.t, 494);

  // Severe erosion exceeding dimensions -> Empty BBox
  node.setKnobValue('size', -150.0);
  const emptyBox = node.getBBox({ in: buf });
  assert.ok(emptyBox.isEmpty());

  // Compute sets result.bbox
  node.setKnobValue('size', 5.0);
  const res = node.compute({ in: buf });
  assert.ok(res.bbox);
  assert.equal(res.bbox.x, 295);
  assert.equal(res.bbox.r, 505);
});

// -------------------------------------------------------------
// 4. StereoWarpNode: DIBR Disparity Displacement & Side-by-Side Canvas
// -------------------------------------------------------------
runTest('StereoWarpNode: Horizontal disparity bounding and stereo canvas modes', () => {
  const node = new StereoWarpNode('SW1');
  const monoBuf = new PixelBuffer(1920, 1080);
  monoBuf.bbox = new BBox(100, 100, 1000, 1000);
  const depthBuf = new PixelBuffer(1920, 1080);

  // Separation 15, Convergence 0.5 -> maxDisparity = 15
  node.setKnobValue('separation', 15.0);
  node.setKnobValue('convergence', 0.5);
  node.setKnobValue('outputEye', 'anaglyph');

  const anaglyphBBox = node.getBBox({ in: monoBuf, depth: depthBuf });
  assert.equal(anaglyphBBox.x, 85);  // 100 - 15
  assert.equal(anaglyphBBox.y, 100); // Y unchanged
  assert.equal(anaglyphBBox.r, 1015); // 1000 + 15
  assert.equal(anaglyphBBox.t, 1000);

  // Side-by-Side 3D mode: double horizontal canvas [0, 0, 2*w, h]
  node.setKnobValue('outputEye', 'side_by_side');
  const sbsBBox = node.getBBox({ in: monoBuf, depth: depthBuf });
  assert.equal(sbsBBox.x, 0);
  assert.equal(sbsBBox.y, 0);
  assert.equal(sbsBBox.r, 3840);
  assert.equal(sbsBBox.t, 1080);

  // Compute sets result.bbox
  node.setKnobValue('outputEye', 'anaglyph');
  const res = node.compute({ in: monoBuf, depth: depthBuf });
  assert.ok(res.bbox);
  assert.equal(res.bbox.x, 85);
  assert.equal(res.bbox.r, 1015);
});

// -------------------------------------------------------------
// 5. GlowNode: Multi-Pass Bloom Radius Expansion (2.5x size)
// -------------------------------------------------------------
runTest('GlowNode: Optical bloom diffusion radius expansion', () => {
  const node = new GlowNode('Glow1');
  const buf = new PixelBuffer(1920, 1080);
  buf.bbox = new BBox(500, 500, 800, 800);

  // size = 20.0 -> pad = ceil(20.0 * 2.5) = 50
  node.setKnobValue('size', 20.0);
  const bbox = node.getBBox({ in: buf });
  assert.equal(bbox.x, 450);
  assert.equal(bbox.y, 450);
  assert.equal(bbox.r, 850);
  assert.equal(bbox.t, 850);

  // Zero size -> no expansion
  node.setKnobValue('size', 0.0);
  const zeroBBox = node.getBBox({ in: buf });
  assert.ok(zeroBBox.equals(buf.bbox));

  // Compute sets result.bbox
  node.setKnobValue('size', 10.0); // pad = 25
  const res = node.compute({ in: buf });
  assert.ok(res.bbox);
  assert.equal(res.bbox.x, 475);
  assert.equal(res.bbox.r, 825);
});

// -------------------------------------------------------------
// 6. ZDefocusNode: Bokeh Aperture Radius & Anamorphic Aspect Ratio
// -------------------------------------------------------------
runTest('ZDefocusNode: Bokeh aperture radius expansion with anamorphic aspect ratio', () => {
  const node = new ZDefocusNode('ZD1');
  const buf = new PixelBuffer(1920, 1080);
  buf.bbox = new BBox(400, 400, 800, 800);
  const depth = new PixelBuffer(1920, 1080);

  // maxDefocus = 12.0, aspect = 2.0 (anamorphic 2x horizontal stretch)
  // padX = ceil(12 * 2.0) = 24, padY = ceil(12) = 12
  node.setKnobValue('maxDefocus', 12.0);
  node.setKnobValue('aspectRatio', 2.0);
  const bbox = node.getBBox({ in: buf, depth });
  assert.equal(bbox.x, 376); // 400 - 24
  assert.equal(bbox.y, 388); // 400 - 12
  assert.equal(bbox.r, 824); // 800 + 24
  assert.equal(bbox.t, 812); // 800 + 12

  // No depth map connected -> fallback to input BBox without expansion
  const noDepthBBox = node.getBBox({ in: buf });
  assert.ok(noDepthBBox.equals(buf.bbox));

  // Compute sets result.bbox
  const res = node.compute({ in: buf, depth });
  assert.ok(res.bbox);
  assert.equal(res.bbox.x, 376);
  assert.equal(res.bbox.r, 824);
});

// -------------------------------------------------------------
// 7. ContactSheetNode: Grid Composite BBox from Active Cell Sub-Bounds
// -------------------------------------------------------------
runTest('ContactSheetNode: Grid-scaled placement and composite BBox calculation', () => {
  const node = new ContactSheetNode('CS1');
  node.setKnobValue('rows', 2);
  node.setKnobValue('columns', 2);
  node.setKnobValue('width', 1920);
  node.setKnobValue('height', 1080);
  // cell size = 960 x 540

  // Input 0 (row 0, col 0): Localized BBox [100, 100, 500, 500] in 1920x1080
  const buf0 = new PixelBuffer(1920, 1080);
  buf0.bbox = new BBox(100, 100, 500, 500);

  // Input 3 (row 1, col 1): Full canvas BBox
  const buf3 = new PixelBuffer(1920, 1080);
  buf3.bbox = new BBox(0, 0, 1920, 1080);

  const bbox = node.getBBox({ '0': buf0, '3': buf3 });
  // Cell 0 scaled: startX=0, startY=0, scaleX=0.5, scaleY=0.5 -> [50, 50, 250, 250]
  // Cell 3 scaled: startX=960, startY=540 -> [960, 540, 1920, 1080]
  // Union -> [50, 50, 1920, 1080]
  assert.equal(bbox.x, 50);
  assert.equal(bbox.y, 50);
  assert.equal(bbox.r, 1920);
  assert.equal(bbox.t, 1080);

  // Compute sets result.bbox
  const res = node.compute({ '0': buf0, '3': buf3 });
  assert.ok(res.bbox);
  assert.equal(res.bbox.x, 50);
  assert.equal(res.bbox.r, 1920);
});

// -------------------------------------------------------------
// 8. SwitchNode: Dynamic Routing and Fractional Blend Union
// -------------------------------------------------------------
runTest('SwitchNode: Dynamic input index routing and fractional blend union', () => {
  const node = new SwitchNode('SW1');

  const buf0 = new PixelBuffer(1920, 1080);
  buf0.bbox = new BBox(0, 0, 400, 400);

  const buf1 = new PixelBuffer(1920, 1080);
  buf1.bbox = new BBox(500, 500, 1200, 1000);

  const buf2 = new PixelBuffer(1920, 1080);
  buf2.bbox = new BBox(200, 200, 800, 800);

  const inputs = { '0': buf0, '1': buf1, '2': buf2 };

  // Discrete switch: which = 0
  node.setKnobValue('which', 0.0);
  node.setKnobValue('blend', false);
  const bbox0 = node.getBBox(inputs);
  assert.ok(bbox0.equals(buf0.bbox));

  // Discrete switch: which = 1
  node.setKnobValue('which', 1.0);
  const bbox1 = node.getBBox(inputs);
  assert.ok(bbox1.equals(buf1.bbox));

  // Discrete switch: which = 2
  node.setKnobValue('which', 2.0);
  const bbox2 = node.getBBox(inputs);
  assert.ok(bbox2.equals(buf2.bbox));

  // Fractional blend: which = 0.5, blend = true -> union of buf0 and buf1
  node.setKnobValue('which', 0.5);
  node.setKnobValue('blend', true);
  const bboxBlend = node.getBBox(inputs);
  assert.equal(bboxBlend.x, 0);
  assert.equal(bboxBlend.y, 0);
  assert.equal(bboxBlend.r, 1200);
  assert.equal(bboxBlend.t, 1000);

  // Compute sets result.bbox
  const res = node.compute(inputs);
  assert.ok(res.bbox);
  assert.ok(res.bbox.equals(bboxBlend));
});

// -------------------------------------------------------------
// 9. StereoMergeNode: View Combinations, Translations & Modes
// -------------------------------------------------------------
runTest('StereoMergeNode: Left/Right eye selection, anaglyph union & side-by-side translation', () => {
  const node = new StereoMergeNode('SM1');

  const bufL = new PixelBuffer(1920, 1080);
  bufL.bbox = new BBox(100, 100, 800, 800);

  const bufR = new PixelBuffer(1920, 1080);
  bufR.bbox = new BBox(150, 100, 850, 800);

  const inputs = { left: bufL, right: bufR };

  // Anaglyph: Union of Left and Right bounds
  node.setKnobValue('mode', 'anaglyph');
  const anaglyphBBox = node.getBBox(inputs);
  assert.equal(anaglyphBBox.x, 100);
  assert.equal(anaglyphBBox.y, 100);
  assert.equal(anaglyphBBox.r, 850);
  assert.equal(anaglyphBBox.t, 800);

  // Left eye only
  node.setKnobValue('mode', 'left');
  const leftBBox = node.getBBox(inputs);
  assert.ok(leftBBox.equals(bufL.bbox));

  // Right eye only
  node.setKnobValue('mode', 'right');
  const rightBBox = node.getBBox(inputs);
  assert.ok(rightBBox.equals(bufR.bbox));

  // Side-by-side: Right is translated by leftBuf.width (1920)
  // Right translated: [150 + 1920, 100, 850 + 1920, 800] = [2070, 100, 2770, 800]
  // Union with Left [100, 100, 800, 800] -> [100, 100, 2770, 800]
  node.setKnobValue('mode', 'side_by_side');
  const sbsBBox = node.getBBox(inputs);
  assert.equal(sbsBBox.x, 100);
  assert.equal(sbsBBox.y, 100);
  assert.equal(sbsBBox.r, 2770);
  assert.equal(sbsBBox.t, 800);

  // Compute sets result.bbox
  const res = node.compute(inputs);
  assert.ok(res.bbox);
  assert.ok(res.bbox.equals(sbsBBox));
});

// -------------------------------------------------------------
// 10. Multi-Node VFX DAG Propagation (CornerPin -> EdgeBlur -> Glow -> Crop)
// -------------------------------------------------------------
runTest('DAG Pipeline: Multi-node dynamic BBox propagation across spatial nodes', () => {
  // Constant background
  const cNode = new ConstantNode('C1');
  const bg = cNode.compute({});

  // Crop to 400x400
  const crop = new CropNode('Crop1');
  crop.setKnobValue('boxX', 400);
  crop.setKnobValue('boxY', 300);
  crop.setKnobValue('boxR', 800);
  crop.setKnobValue('boxT', 700);
  crop.setKnobValue('reformat', false);
  const cropped = crop.compute({ in: bg });
  assert.ok(cropped.bbox.equals(new BBox(400, 300, 800, 700)));

  // EdgeBlur: size 5, edgeWidth 2 -> pad = ceil(max(10, 7)) = 10 -> [390, 290, 810, 710]
  const edgeBlur = new EdgeBlurNode('EB1');
  edgeBlur.setKnobValue('size', 5.0);
  edgeBlur.setKnobValue('edgeWidth', 2.0);
  const blurred = edgeBlur.compute({ in: cropped });
  assert.equal(blurred.bbox.x, 390);
  assert.equal(blurred.bbox.y, 290);
  assert.equal(blurred.bbox.r, 810);
  assert.equal(blurred.bbox.t, 710);

  // Glow: size 10.0 -> pad = ceil(10 * 2.5) = 25 -> [365, 265, 835, 735]
  const glow = new GlowNode('Glow1');
  glow.setKnobValue('size', 10.0);
  const glowed = glow.compute({ in: blurred });
  assert.equal(glowed.bbox.x, 365);
  assert.equal(glowed.bbox.y, 265);
  assert.equal(glowed.bbox.r, 835);
  assert.equal(glowed.bbox.t, 735);

  // Switch: select glowed branch (which = 0)
  const sw = new SwitchNode('SW1');
  sw.setKnobValue('which', 0.0);
  const switched = sw.compute({ '0': glowed, '1': bg });
  assert.ok(switched.bbox.equals(glowed.bbox));
});

// -------------------------------------------------------------
// 11. 16K Ultra-Resolution Tiled BBox Culling Verification
// -------------------------------------------------------------
runTest('16K Ultra-Resolution: Tiled culling efficiency (>95% avoidance) with spatial filter expansion', () => {
  const tiled16K = new TiledPixelBuffer(15360, 8640, 2048, 2048);
  const totalTiles = tiled16K.cols * tiled16K.rows; // 8 x 5 = 40 tiles
  assert.equal(totalTiles, 40);

  // Localized 400x400 VFX element in tile (0, 0): [200, 200, 600, 600]
  const initialBox = new BBox(200, 200, 600, 600);

  // Simulate expansion through EdgeBlur (pad 10) + Glow (pad 25) -> [165, 165, 635, 635]
  const expandedBox = initialBox.expanded(35);
  assert.equal(expandedBox.x, 165);
  assert.equal(expandedBox.r, 635);

  // Query intersecting tiles in 16K plate
  const hitTiles = tiled16K.getTilesIntersecting(expandedBox);
  assert.equal(hitTiles.length, 1, 'Expanded element still resides entirely within tile (0, 0)');
  assert.equal(hitTiles[0].col, 0);
  assert.equal(hitTiles[0].row, 0);

  const culledTiles = totalTiles - hitTiles.length;
  const avoidancePercent = (culledTiles / totalTiles) * 100;
  assert.equal(culledTiles, 39);
  assert.equal(avoidancePercent, 97.5);
});

console.log('\n====================================================');
console.log(`🎉 test_spatial_bbox_nodes.mjs PASSED: All ${passedTests}/${totalTests} tests succeeded!`);
console.log('====================================================\n');

