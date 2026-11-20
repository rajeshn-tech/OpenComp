/**
 * OpenComp - Dynamic Bounding Box (BBox) Architecture Test Suite
 * Validates Foundry Nuke standard BBox [x, y, r, t] behavior, negative coordinates,
 * upstream/downstream DAG propagation, node transformations, and 16K tiled optimizations.
 */

import assert from 'node:assert/strict';
import { BBox } from '../src/core/BBox.js';
import { PixelBuffer, TiledPixelBuffer } from '../src/core/PixelBuffer.js';
import { Node } from '../src/core/Node.js';
import { TransformNode } from '../src/nodes/TransformNode.js';
import { BlurNode } from '../src/nodes/BlurNode.js';
import { CropNode } from '../src/nodes/CropNode.js';
import { MergeNode } from '../src/nodes/MergeNode.js';
import { GradeNode } from '../src/nodes/GradeNode.js';
import { ConstantNode } from '../src/nodes/ConstantNode.js';
import { CornerPinNode } from '../src/nodes/CornerPinNode.js';
import { EdgeBlurNode } from '../src/nodes/EdgeBlurNode.js';
import { ErodeNode } from '../src/nodes/ErodeNode.js';
import { StereoWarpNode } from '../src/nodes/StereoWarpNode.js';
import { GlowNode } from '../src/nodes/GlowNode.js';
import { ZDefocusNode } from '../src/nodes/ZDefocusNode.js';
import { ContactSheetNode } from '../src/nodes/ContactSheetNode.js';
import { SwitchNode } from '../src/nodes/SwitchNode.js';
import { StereoMergeNode } from '../src/nodes/StereoMergeNode.js';

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_dynamic_bbox.mjs');
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
// 1. Core BBox Class Primitives
// -------------------------------------------------------------
runTest('BBox: Core Primitives, Dimensions, and Equality', () => {
  const box = new BBox(10, 20, 110, 220);
  assert.equal(box.x, 10);
  assert.equal(box.y, 20);
  assert.equal(box.r, 110);
  assert.equal(box.t, 220);
  assert.equal(box.width, 100);
  assert.equal(box.height, 200);
  assert.equal(box.isEmpty(), false);

  const emptyBox = new BBox(50, 50, 50, 50);
  assert.equal(emptyBox.width, 0);
  assert.equal(emptyBox.height, 0);
  assert.equal(emptyBox.isEmpty(), true);

  const invertedBox = new BBox(100, 100, 50, 50);
  assert.equal(invertedBox.isEmpty(), true);

  const cloned = box.clone();
  assert.ok(box.equals(cloned));
  assert.notEqual(box, cloned);
});

// -------------------------------------------------------------
// 2. Union, Intersection, and Point Testing
// -------------------------------------------------------------
runTest('BBox: Union, Intersection, and Point Containment', () => {
  const boxA = new BBox(0, 0, 100, 100);
  const boxB = new BBox(50, 50, 150, 150);

  // Union
  const u = boxA.union(boxB);
  assert.equal(u.x, 0);
  assert.equal(u.y, 0);
  assert.equal(u.r, 150);
  assert.equal(u.t, 150);

  // Intersection
  const i = boxA.intersect(boxB);
  assert.equal(i.x, 50);
  assert.equal(i.y, 50);
  assert.equal(i.r, 100);
  assert.equal(i.t, 100);
  assert.ok(boxA.intersects(boxB));

  // Disjoint Intersection -> Empty
  const boxC = new BBox(200, 200, 300, 300);
  const disjoint = boxA.intersect(boxC);
  assert.ok(disjoint.isEmpty());
  assert.equal(boxA.intersects(boxC), false);

  // Points
  assert.ok(boxA.containsPoint(0, 0));
  assert.ok(boxA.containsPoint(99, 99));
  assert.equal(boxA.containsPoint(100, 100), false); // Upper boundary is exclusive
  assert.equal(boxA.containsPoint(-1, 50), false);
});

// -------------------------------------------------------------
// 3. Negative Coordinates and Offset / Expansion
// -------------------------------------------------------------
runTest('BBox: Negative Coordinates and Symmetric Expansion', () => {
  const box = new BBox(-100, -50, 200, 300);
  assert.equal(box.x, -100);
  assert.equal(box.width, 300);
  assert.equal(box.height, 350);

  // Translate
  const shifted = box.translated(50, 100);
  assert.equal(shifted.x, -50);
  assert.equal(shifted.y, 50);
  assert.equal(shifted.r, 250);
  assert.equal(shifted.t, 400);

  // Symmetric expansion (Blur style)
  const expanded = box.expanded(15, 25);
  assert.equal(expanded.x, -115);
  assert.equal(expanded.y, -75);
  assert.equal(expanded.r, 215);
  assert.equal(expanded.t, 325);
  assert.equal(expanded.width, box.width + 30);
  assert.equal(expanded.height, box.height + 50);

  // Clamping to 1920x1080 canvas
  const clamped = box.clampToFormat(1920, 1080);
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 0);
  assert.equal(clamped.r, 200);
  assert.equal(clamped.t, 300);
});

// -------------------------------------------------------------
// 4. PixelBuffer and TiledPixelBuffer BBox Integration
// -------------------------------------------------------------
runTest('PixelBuffer & TiledPixelBuffer: BBox Initialization & Tiling', () => {
  const buf = new PixelBuffer(1920, 1080);
  assert.ok(buf.bbox instanceof BBox);
  assert.equal(buf.bbox.x, 0);
  assert.equal(buf.bbox.y, 0);
  assert.equal(buf.bbox.r, 1920);
  assert.equal(buf.bbox.t, 1080);

  const cloned = buf.clone();
  assert.ok(cloned.bbox.equals(buf.bbox));

  // Tiled buffer (8K UHD with 2048 tiles -> 4 cols, 3 rows = 12 tiles)
  const tiled = new TiledPixelBuffer(7680, 4320, 2048);
  assert.equal(tiled.cols, 4);
  assert.equal(tiled.rows, 3);
  assert.ok(tiled.bbox.equals(new BBox(0, 0, 7680, 4320)));

  // Sub-canvas query intersecting only 1 tile (top-left: x=100..500, y=100..400)
  const subBox = new BBox(100, 100, 500, 400);
  const tilesHit = tiled.getTilesIntersecting(subBox);
  assert.equal(tilesHit.length, 1);
  assert.equal(tilesHit[0].col, 0);
  assert.equal(tilesHit[0].row, 0);

  // Query spanning 4 tiles across center boundary
  const centerBox = new BBox(2000, 2000, 2100, 2100);
  const centerHit = tiled.getTilesIntersecting(centerBox);
  assert.equal(centerHit.length, 4); // Spans (0,0), (1,0), (0,1), (1,1)
});

// -------------------------------------------------------------
// 5. TransformNode: Translation, Scaling, Rotation & BBox Propagation
// -------------------------------------------------------------
runTest('TransformNode: Dynamic BBox for Translation, Scale, and Rotation', () => {
  const input = new PixelBuffer(1920, 1080);
  input.bbox = new BBox(100, 100, 500, 400); // 400x300 sub-box

  const xform = new TransformNode('Xform1');

  // Translation by +250 X, -50 Y
  xform.setKnobValue('translateX', 250);
  xform.setKnobValue('translateY', -50);
  const bbox1 = xform.getBBox({ in: input });
  assert.equal(Math.round(bbox1.x), 350);
  assert.equal(Math.round(bbox1.y), 50);
  assert.equal(Math.round(bbox1.r), 750);
  assert.equal(Math.round(bbox1.t), 350);

  // Negative Translation: into negative coordinates off-screen
  xform.setKnobValue('translateX', -300);
  xform.setKnobValue('translateY', -200);
  const bbox2 = xform.getBBox({ in: input });
  assert.equal(Math.round(bbox2.x), -200);
  assert.equal(Math.round(bbox2.y), -100);
  assert.equal(Math.round(bbox2.r), 200);
  assert.equal(Math.round(bbox2.t), 200);

  // 90-degree Rotation around center
  xform.setKnobValue('translateX', 0);
  xform.setKnobValue('translateY', 0);
  xform.setKnobValue('rotate', 90);
  xform.setKnobValue('centerRatio', 'center');
  const bbox3 = xform.getBBox({ in: input });
  assert.ok(bbox3.width > 0 && bbox3.height > 0);

  // Computation test: execution sets result.bbox
  const computed = xform.compute({ in: input });
  assert.ok(computed.bbox instanceof BBox);
  assert.ok(computed.bbox.equals(bbox3, 1e-3));
});

// -------------------------------------------------------------
// 6. BlurNode: Filter Radius Expansion
// -------------------------------------------------------------
runTest('BlurNode: Dynamic BBox Expansion by Filter Radius', () => {
  const input = new PixelBuffer(1920, 1080);
  input.bbox = new BBox(300, 300, 600, 500); // 300x200

  const blur = new BlurNode('Blur1');
  blur.setKnobValue('size', 20.0);
  blur.setKnobValue('aspectRatio', 1.0);

  const blurBBox = blur.getBBox({ in: input });
  assert.equal(blurBBox.x, 300 - 20);
  assert.equal(blurBBox.y, 300 - 20);
  assert.equal(blurBBox.r, 600 + 20);
  assert.equal(blurBBox.t, 500 + 20);
  assert.equal(blurBBox.width, 300 + 40);
  assert.equal(blurBBox.height, 200 + 40);

  const computed = blur.compute({ in: input });
  assert.ok(computed.bbox.equals(blurBBox));
});

// -------------------------------------------------------------
// 7. CropNode: BBox Intersection & Reformat
// -------------------------------------------------------------
runTest('CropNode: Data Window Clipping and Reformat Handling', () => {
  const input = new PixelBuffer(1920, 1080);
  input.bbox = new BBox(100, 100, 1000, 800);

  const crop = new CropNode('Crop1');
  crop.setKnobValue('boxX', 200);
  crop.setKnobValue('boxY', 200);
  crop.setKnobValue('boxR', 600);
  crop.setKnobValue('boxT', 500);
  crop.setKnobValue('reformat', false);

  // In-place crop: BBox is intersection of input data window and crop box
  const croppedBBox = crop.getBBox({ in: input });
  assert.equal(croppedBBox.x, 200);
  assert.equal(croppedBBox.y, 200);
  assert.equal(croppedBBox.r, 600);
  assert.equal(croppedBBox.t, 500);

  const outInPlace = crop.compute({ in: input });
  assert.equal(outInPlace.width, 1920); // Canvas format preserved
  assert.equal(outInPlace.height, 1080);
  assert.ok(outInPlace.bbox.equals(croppedBBox));

  // Reformat crop: Canvas format resized to crop dimensions
  crop.setKnobValue('reformat', true);
  const outReformat = crop.compute({ in: input });
  assert.equal(outReformat.width, 400); // 600 - 200
  assert.equal(outReformat.height, 300); // 500 - 200
  assert.equal(outReformat.bbox.x, 0);
  assert.equal(outReformat.bbox.y, 0);
  assert.equal(outReformat.bbox.r, 400);
  assert.equal(outReformat.bbox.t, 300);
});

// -------------------------------------------------------------
// 8. MergeNode: Nuke-Standard BBox Modes (union, intersection, B, A)
// -------------------------------------------------------------
runTest('MergeNode: Dynamic BBox Modes (union, intersection, B, A)', () => {
  const bufB = new PixelBuffer(1920, 1080);
  bufB.bbox = new BBox(0, 0, 1000, 800);

  const bufA = new PixelBuffer(1920, 1080);
  bufA.bbox = new BBox(500, 400, 1500, 1000);

  const merge = new MergeNode('Merge1');

  // Mode 1: union
  merge.setKnobValue('bbox', 'union');
  const uBBox = merge.getBBox({ B: bufB, A: bufA });
  assert.equal(uBBox.x, 0);
  assert.equal(uBBox.y, 0);
  assert.equal(uBBox.r, 1500);
  assert.equal(uBBox.t, 1000);

  // Mode 2: intersection
  merge.setKnobValue('bbox', 'intersection');
  const iBBox = merge.getBBox({ B: bufB, A: bufA });
  assert.equal(iBBox.x, 500);
  assert.equal(iBBox.y, 400);
  assert.equal(iBBox.r, 1000);
  assert.equal(iBBox.t, 800);

  // Mode 3: B
  merge.setKnobValue('bbox', 'B');
  const bBBox = merge.getBBox({ B: bufB, A: bufA });
  assert.ok(bBBox.equals(bufB.bbox));

  // Mode 4: A
  merge.setKnobValue('bbox', 'A');
  const aBBox = merge.getBBox({ B: bufB, A: bufA });
  assert.ok(aBBox.equals(bufA.bbox));

  // Verify compute propagates BBox
  merge.setKnobValue('bbox', 'union');
  const result = merge.compute({ B: bufB, A: bufA });
  assert.ok(result.bbox.equals(uBBox));
});

// -------------------------------------------------------------
// 9. End-to-End Multi-Node DAG BBox Propagation
// -------------------------------------------------------------
runTest('DAG Pipeline: Upstream to Downstream Multi-Node BBox Propagation', () => {
  // Constant (Format: 1920x1080)
  const constNode = new ConstantNode('Const1');
  const bg = constNode.compute({});
  assert.ok(bg.bbox.equals(new BBox(0, 0, 1920, 1080)));

  // Crop to a 200x200 window
  const cropNode = new CropNode('Crop1');
  cropNode.setKnobValue('boxX', 400);
  cropNode.setKnobValue('boxY', 300);
  cropNode.setKnobValue('boxR', 600);
  cropNode.setKnobValue('boxT', 500);
  cropNode.setKnobValue('reformat', false);
  const cropped = cropNode.compute({ in: bg });
  assert.ok(cropped.bbox.equals(new BBox(400, 300, 600, 500)));

  // Transform: Shift by +100 X, +50 Y
  const xformNode = new TransformNode('Xform1');
  xformNode.setKnobValue('translateX', 100);
  xformNode.setKnobValue('translateY', 50);
  const xformed = xformNode.compute({ in: cropped });
  assert.ok(xformed.bbox.equals(new BBox(500, 350, 700, 550)));

  // Blur: 10px radius -> expands 10px on all sides
  const blurNode = new BlurNode('Blur1');
  blurNode.setKnobValue('size', 10.0);
  const blurred = blurNode.compute({ in: xformed });
  assert.ok(blurred.bbox.equals(new BBox(490, 340, 710, 560)));

  // Grade: Preserves dynamic BBox
  const gradeNode = new GradeNode('Grade1');
  gradeNode.setKnobValue('gain', 1.5);
  const graded = gradeNode.compute({ in: blurred });
  assert.ok(graded.bbox.equals(new BBox(490, 340, 710, 560)));
});

// -------------------------------------------------------------
// 10. 16K Ultra-Resolution Tiled BBox Optimization
// -------------------------------------------------------------
runTest('16K Ultra-Resolution: Tiled BBox Culling and Optimization', () => {
  // 16K UHD Tiled Buffer (15360 x 8640 with 2048 tiles: 8 cols x 5 rows = 40 tiles)
  const tiled16K = new TiledPixelBuffer(15360, 8640, 2048);
  assert.equal(tiled16K.cols, 8);
  assert.equal(tiled16K.rows, 5);
  assert.equal(tiled16K.cols * tiled16K.rows, 40);

  // Place a localized VFX element at (300, 300, 700, 700) (400x400 px)
  const fgBBox = new BBox(300, 300, 700, 700);
  tiled16K.bbox = fgBBox;

  // Intersecting tile query
  const hitTiles = tiled16K.getTilesIntersecting(fgBBox);
  assert.equal(hitTiles.length, 1, '400x400 element in 16K frame must hit exactly 1 tile out of 40');
  assert.equal(hitTiles[0].col, 0);
  assert.equal(hitTiles[0].row, 0);

  // Performance calculation: 39 out of 40 tiles completely culled (97.5% processing avoidance)
  const culledTiles = 40 - hitTiles.length;
  assert.equal(culledTiles, 39);
});

// -------------------------------------------------------------
// 11. CornerPinNode: Perspective Homography & Negative Bounds
// -------------------------------------------------------------
runTest('CornerPinNode: Perspective homography quad projection & negative bounds', () => {
  const cp = new CornerPinNode('CP1');
  const buf = new PixelBuffer(1920, 1080);
  buf.bbox = new BBox(0, 0, 1920, 1080);

  cp.setKnobValue('to1_x', -0.1); // -192 px
  cp.setKnobValue('to1_y', -0.1); // -108 px
  cp.setKnobValue('to2_x', 1.0);  // 1920 px
  cp.setKnobValue('to2_y', 0.0);
  cp.setKnobValue('to3_x', 1.1);  // 2112 px
  cp.setKnobValue('to3_y', 1.1);  // 1188 px
  cp.setKnobValue('to4_x', 0.0);
  cp.setKnobValue('to4_y', 1.0);

  const bbox = cp.getBBox({ in: buf });
  assert.equal(bbox.x, -192);
  assert.equal(bbox.y, -108);
  assert.equal(bbox.r, 2112);
  assert.equal(bbox.t, 1188);
});

// -------------------------------------------------------------
// 12. EdgeBlurNode: Blur Filter Radius & Edge Support Expansion
// -------------------------------------------------------------
runTest('EdgeBlurNode: Blur filter radius and edge width expansion', () => {
  const node = new EdgeBlurNode('EB1');
  const buf = new PixelBuffer(1920, 1080);
  buf.bbox = new BBox(200, 200, 600, 600);

  node.setKnobValue('size', 5.0);
  node.setKnobValue('edgeWidth', 3.0);
  const bbox = node.getBBox({ in: buf });
  assert.equal(bbox.x, 190); // 200 - 10
  assert.equal(bbox.y, 190);
  assert.equal(bbox.r, 610);
  assert.equal(bbox.t, 610);

  node.setKnobValue('size', 0.0);
  assert.ok(node.getBBox({ in: buf }).equals(buf.bbox));
});

// -------------------------------------------------------------
// 13. ErodeNode: Morphological Dilation (+size) & Erosion (-size)
// -------------------------------------------------------------
runTest('ErodeNode: Dilation expansion (+size) and erosion contraction (-size)', () => {
  const node = new ErodeNode('Erode1');
  const buf = new PixelBuffer(1920, 1080);
  buf.bbox = new BBox(300, 300, 500, 500);

  // Dilate (+8) -> expand 8
  node.setKnobValue('size', 8.0);
  const dilated = node.getBBox({ in: buf });
  assert.equal(dilated.x, 292);
  assert.equal(dilated.r, 508);

  // Erode (-6) -> shrink 6
  node.setKnobValue('size', -6.0);
  const eroded = node.getBBox({ in: buf });
  assert.equal(eroded.x, 306);
  assert.equal(eroded.r, 494);

  // Severe erosion -> empty BBox
  node.setKnobValue('size', -150.0);
  assert.ok(node.getBBox({ in: buf }).isEmpty());
});

// -------------------------------------------------------------
// 14. StereoWarpNode: Horizontal Disparity & Side-by-Side Canvas
// -------------------------------------------------------------
runTest('StereoWarpNode: Horizontal disparity bounding and stereo canvas modes', () => {
  const node = new StereoWarpNode('SW1');
  const monoBuf = new PixelBuffer(1920, 1080);
  monoBuf.bbox = new BBox(100, 100, 1000, 1000);

  node.setKnobValue('separation', 15.0);
  node.setKnobValue('convergence', 0.5);
  node.setKnobValue('outputEye', 'anaglyph');
  const anaglyphBBox = node.getBBox({ in: monoBuf });
  assert.equal(anaglyphBBox.x, 85);
  assert.equal(anaglyphBBox.r, 1015);

  node.setKnobValue('outputEye', 'side_by_side');
  const sbsBBox = node.getBBox({ in: monoBuf });
  assert.equal(sbsBBox.x, 0);
  assert.equal(sbsBBox.r, 3840);
});

// -------------------------------------------------------------
// 15. GlowNode: Multi-Pass Bloom Radius Expansion (2.5x size)
// -------------------------------------------------------------
runTest('GlowNode: Optical bloom diffusion radius expansion', () => {
  const node = new GlowNode('Glow1');
  const buf = new PixelBuffer(1920, 1080);
  buf.bbox = new BBox(500, 500, 800, 800);

  node.setKnobValue('size', 20.0);
  const bbox = node.getBBox({ in: buf });
  assert.equal(bbox.x, 450); // 500 - 50
  assert.equal(bbox.r, 850);

  node.setKnobValue('size', 0.0);
  assert.ok(node.getBBox({ in: buf }).equals(buf.bbox));
});

// -------------------------------------------------------------
// 16. ZDefocusNode: Bokeh Aperture Radius & Anamorphic Aspect
// -------------------------------------------------------------
runTest('ZDefocusNode: Bokeh aperture radius expansion with anamorphic aspect ratio', () => {
  const node = new ZDefocusNode('ZD1');
  const buf = new PixelBuffer(1920, 1080);
  buf.bbox = new BBox(400, 400, 800, 800);
  const depth = new PixelBuffer(1920, 1080);

  node.setKnobValue('maxDefocus', 12.0);
  node.setKnobValue('aspectRatio', 2.0);
  const bbox = node.getBBox({ in: buf, depth });
  assert.equal(bbox.x, 376); // 400 - 24
  assert.equal(bbox.y, 388); // 400 - 12
  assert.equal(bbox.r, 824);
  assert.equal(bbox.t, 812);
});

// -------------------------------------------------------------
// 17. ContactSheetNode: Grid Composite BBox from Sub-Bounds
// -------------------------------------------------------------
runTest('ContactSheetNode: Grid-scaled placement and composite BBox calculation', () => {
  const node = new ContactSheetNode('CS1');
  node.setKnobValue('rows', 2);
  node.setKnobValue('columns', 2);
  node.setKnobValue('width', 1920);
  node.setKnobValue('height', 1080);

  const buf0 = new PixelBuffer(1920, 1080);
  buf0.bbox = new BBox(100, 100, 500, 500);
  const buf3 = new PixelBuffer(1920, 1080);
  buf3.bbox = new BBox(0, 0, 1920, 1080);

  const bbox = node.getBBox({ '0': buf0, '3': buf3 });
  assert.equal(bbox.x, 50);
  assert.equal(bbox.y, 50);
  assert.equal(bbox.r, 1920);
  assert.equal(bbox.t, 1080);
});

// -------------------------------------------------------------
// 18. SwitchNode: Dynamic Routing & Fractional Blend Union
// -------------------------------------------------------------
runTest('SwitchNode: Dynamic input index routing and fractional blend union', () => {
  const node = new SwitchNode('SW1');
  const buf0 = new PixelBuffer(1920, 1080); buf0.bbox = new BBox(0, 0, 400, 400);
  const buf1 = new PixelBuffer(1920, 1080); buf1.bbox = new BBox(500, 500, 1200, 1000);
  const inputs = { '0': buf0, '1': buf1 };

  node.setKnobValue('which', 0.0);
  node.setKnobValue('blend', false);
  assert.ok(node.getBBox(inputs).equals(buf0.bbox));

  node.setKnobValue('which', 1.0);
  assert.ok(node.getBBox(inputs).equals(buf1.bbox));

  node.setKnobValue('which', 0.5);
  node.setKnobValue('blend', true);
  const blendBox = node.getBBox(inputs);
  assert.equal(blendBox.x, 0);
  assert.equal(blendBox.r, 1200);
});

// -------------------------------------------------------------
// 19. StereoMergeNode: Left/Right Modes, Anaglyph Union & Side-by-Side
// -------------------------------------------------------------
runTest('StereoMergeNode: Left/Right selection, anaglyph union & side-by-side translation', () => {
  const node = new StereoMergeNode('SM1');
  const bufL = new PixelBuffer(1920, 1080); bufL.bbox = new BBox(100, 100, 800, 800);
  const bufR = new PixelBuffer(1920, 1080); bufR.bbox = new BBox(150, 100, 850, 800);
  const inputs = { left: bufL, right: bufR };

  node.setKnobValue('mode', 'anaglyph');
  const anaglyph = node.getBBox(inputs);
  assert.equal(anaglyph.x, 100);
  assert.equal(anaglyph.r, 850);

  node.setKnobValue('mode', 'side_by_side');
  const sbs = node.getBBox(inputs);
  assert.equal(sbs.x, 100);
  assert.equal(sbs.r, 2770);
});

// -------------------------------------------------------------
// 20. End-to-End Multi-Node Spatial DAG Propagation
// -------------------------------------------------------------
runTest('DAG Pipeline: Multi-node dynamic BBox propagation across spatial nodes', () => {
  const cNode = new ConstantNode('C1');
  const bg = cNode.compute({});

  const crop = new CropNode('Crop1');
  crop.setKnobValue('boxX', 400); crop.setKnobValue('boxY', 300);
  crop.setKnobValue('boxR', 800); crop.setKnobValue('boxT', 700);
  crop.setKnobValue('reformat', false);
  const cropped = crop.compute({ in: bg });
  assert.ok(cropped.bbox.equals(new BBox(400, 300, 800, 700)));

  const edgeBlur = new EdgeBlurNode('EB1');
  edgeBlur.setKnobValue('size', 5.0);
  edgeBlur.setKnobValue('edgeWidth', 2.0);
  const ebBBox = edgeBlur.getBBox({ in: cropped });
  assert.equal(ebBBox.x, 390);
  assert.equal(ebBBox.r, 810);

  const glow = new GlowNode('Glow1');
  glow.setKnobValue('size', 10.0);
  cropped.bbox = ebBBox;
  const glowBBox = glow.getBBox({ in: cropped });
  assert.equal(glowBBox.x, 365);
  assert.equal(glowBBox.r, 835);
});

console.log('\n====================================================');
console.log(`🎉 test_dynamic_bbox.mjs PASSED: All ${passedTests}/${totalTests} tests succeeded!`);
console.log('====================================================\n');

