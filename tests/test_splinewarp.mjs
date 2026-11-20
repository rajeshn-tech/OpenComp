/**
 * OpenComp - Unit & Acceptance Test Suite: SplineWarp (Workstream 3.3)
 * Validates dual-spline correspondence, IDW vector field deformation,
 * identity preservation, mask modulation, dynamic BBox, and tiled seam continuity.
 */

import assert from 'node:assert/strict';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { BBox } from '../src/core/BBox.js';
import { SplineWarpEngine, SplinePair } from '../src/core/SplineWarpEngine.js';
import { SplineWarpNode } from '../src/nodes/SplineWarpNode.js';

console.log('================================================================');
console.log('🎯 RUNNING: tests/test_splinewarp.mjs');
console.log('================================================================\n');

// --- Helper: Generate Test Grid Plate ---
function createGridPlate(width = 256, height = 256) {
  const buf = new PixelBuffer(width, height);
  const data = buf.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const isGrid = (x % 32 === 0 || y % 32 === 0);
      const val = isGrid ? 1.0 : 0.2;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 1.0;
    }
  }
  return buf;
}

// -------------------------------------------------------------
// Test 1: Identity Warp (Zero Deformation When Src == Dst)
// -------------------------------------------------------------
console.log('▶ Test 1: Identity Preservation (Src == Dst)...');
{
  const node = new SplineWarpNode('SplineWarp_Identity');
  const pair = node.addPair('Circle1');

  // Create identical circular splines for source and destination
  const numPts = 8;
  const cx = 128, cy = 128, r = 50;
  for (let i = 0; i < numPts; i++) {
    const angle = (i / numPts) * 2 * Math.PI;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    pair.addPointPair(px, py, px, py, 1);
  }

  const plate = createGridPlate(256, 256);
  const warped = node.compute({ in: plate }, { frame: 1 });

  let maxDiff = 0;
  for (let i = 0; i < plate.data.length; i += 4) {
    const diff = Math.abs(warped.data[i] - plate.data[i]);
    if (diff > maxDiff) maxDiff = diff;
  }

  console.log(`  Max Difference from Input Plate: ${maxDiff.toFixed(6)}`);
  assert.ok(maxDiff < 1e-4, `Identity warp should have max diff < 1e-4, got ${maxDiff}`);
  console.log('  ✔ Identity warp preserved image perfectly');
}

// -------------------------------------------------------------
// Test 2: Controlled Vector Field Expansion
// -------------------------------------------------------------
console.log('\n▶ Test 2: Directional Shape Warping...');
{
  const node = new SplineWarpNode('SplineWarp_Deform');
  const pair = node.addPair('BarWarp');

  // Source vertical bar at x = 96 (divisible by 32), pulled rightward to destination x = 126 (+30 px)
  pair.addPointPair(96, 50, 126, 50, 1);
  pair.addPointPair(96, 150, 126, 150, 1);

  const plate = createGridPlate(256, 256);
  // In the original plate, x = 96 has gridline value 1.0, while x = 126 is background (0.2)
  const origAtDst = plate.getPixel(126, 100)[0];
  assert.ok(Math.abs(origAtDst - 0.2) < 1e-4, 'Original plate should be background (0.2) at x = 126');

  const warped = node.compute({ in: plate }, { frame: 1 });

  // Destination point (126, 100) should sample backward from source point (96, 100)
  // Therefore, warped image at x = 126 should now have the bright gridline (~1.0)!
  const pixAtDst = warped.getPixel(126, 100);
  console.log(`  Luminance at Deformed Destination (126, 100): ${pixAtDst[0].toFixed(3)} (Original: ${origAtDst.toFixed(3)})`);
  assert.ok(pixAtDst[0] > 0.85, 'Deformed destination should pull gridline from source (96, 100)');
  console.log('  ✔ Directional displacement vector field successfully warped pixels');
}

// -------------------------------------------------------------
// Test 3: Mask Modulation
// -------------------------------------------------------------
console.log('\n▶ Test 3: Mask Input Modulation...');
{
  const node = new SplineWarpNode('SplineWarp_Masked');
  const pair = node.addPair('WarpBox');
  pair.addPointPair(100, 100, 100, 100, 1);
  pair.addPointPair(150, 100, 180, 100, 1);
  pair.addPointPair(150, 150, 180, 150, 1);
  pair.addPointPair(100, 150, 100, 150, 1);

  const plate = createGridPlate(256, 256);

  // Black mask (zero warp allowed)
  const mask = new PixelBuffer(256, 256); // All zeros

  const warped = node.compute({ in: plate, mask }, { frame: 1 });

  let maxDiff = 0;
  for (let i = 0; i < plate.data.length; i += 4) {
    const diff = Math.abs(warped.data[i] - plate.data[i]);
    if (diff > maxDiff) maxDiff = diff;
  }

  console.log(`  Max Difference with Zero Mask: ${maxDiff.toFixed(6)}`);
  assert.ok(maxDiff < 1e-4, 'Zero mask should inhibit warp completely');
  console.log('  ✔ Mask modulation verified');
}

// -------------------------------------------------------------
// Test 4: Dynamic BBox Expansion
// -------------------------------------------------------------
console.log('\n▶ Test 4: Dynamic BBox Boundary Expansion...');
{
  const node = new SplineWarpNode('SplineWarp_BBox');
  const pair = node.addPair('OuterSpline');
  // Destination points extend past canvas boundary (e.g. at x = 320 for 256 canvas)
  pair.addPointPair(200, 100, 320, 100, 1);
  pair.addPointPair(200, 200, 320, 200, 1);

  const plate = createGridPlate(256, 256);
  const bbox = node.getBBox({ in: plate }, { frame: 1 });

  console.log(`  Output BBox: [${bbox.x}, ${bbox.y}, ${bbox.r}, ${bbox.t}] (Width: ${bbox.width}, Height: ${bbox.height})`);
  assert.ok(bbox.r >= 320, 'BBox right boundary should expand to at least 320');
  console.log('  ✔ Dynamic BBox expanded correctly to encompass warped boundary');
}

// -------------------------------------------------------------
// Test 5: Tiled Processing Seam Continuity
// -------------------------------------------------------------
console.log('\n▶ Test 5: Tiled Processing Seam Continuity (Delta = 0)...');
{
  const engine = new SplineWarpEngine();
  const pair = engine.addPair('TileWarp');
  pair.addPointPair(64, 64, 80, 80, 1);
  pair.addPointPair(192, 192, 180, 180, 1);

  const plate = createGridPlate(256, 256);
  const fullDst = new PixelBuffer(256, 256);
  engine.warpBuffer(plate, fullDst, 1, null, null);

  // Render two adjacent tiles (Left: 0..128, Right: 128..256)
  const tileLeft = new PixelBuffer(256, 256);
  const tileRight = new PixelBuffer(256, 256);

  engine.warpBuffer(plate, tileLeft, 1, null, new BBox(0, 0, 128, 256));
  engine.warpBuffer(plate, tileRight, 1, null, new BBox(128, 0, 256, 256));

  // Verify seam boundary at x = 127 and x = 128
  let seamDiff = 0;
  for (let y = 0; y < 256; y++) {
    const idxL = (y * 256 + 127) * 4;
    const idxR = (y * 256 + 128) * 4;

    const diffL = Math.abs(tileLeft.data[idxL] - fullDst.data[idxL]);
    const diffR = Math.abs(tileRight.data[idxR] - fullDst.data[idxR]);
    seamDiff = Math.max(seamDiff, diffL, diffR);
  }

  console.log(`  Tile Seam Boundary Difference: ${seamDiff.toFixed(8)}`);
  assert.ok(seamDiff < 1e-6, `Tiled rendering seam difference should be zero, got ${seamDiff}`);
  console.log('  ✔ Tiled processing seam continuity verified (Delta = 0.0)');
}

// -------------------------------------------------------------
// Test 6: Serialization & Restoration
// -------------------------------------------------------------
console.log('\n▶ Test 6: Serialization Fidelity...');
{
  const node = new SplineWarpNode('SplineWarp_Save');
  node.setKnobValue('warp', 1.5);
  const p = node.addPair('Pair_Face');
  p.addPointPair(10, 10, 20, 25, 1);

  const jsonStr = JSON.stringify(node.serialize());
  const restored = new SplineWarpNode('SplineWarp_Restored');
  restored.deserialize(JSON.parse(jsonStr));

  assert.equal(restored.getKnobValue('warp'), 1.5);
  assert.equal(restored.getAllPairs().length, 1);
  const rp = restored.getAllPairs()[0];
  assert.equal(rp.name, 'Pair_Face');
  assert.equal(rp.source.points.length, 1);
  const pt = rp.destination.points[0].getAtFrame(1);
  assert.equal(pt.x, 20);
  assert.equal(pt.y, 25);
  console.log('  ✔ SplineWarpNode serialized and restored with 100% fidelity');
}

console.log('\n================================================================');
console.log('✅ ALL SPLINEWARP TESTS PASSED (Workstream 3.3 Automated Verification Passed)');
console.log('================================================================');
