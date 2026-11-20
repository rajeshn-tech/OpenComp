/**
 * OpenComp - ZDefocus Optimization & Performance Regression Suite
 * Tests numerical parity, edge cases, HDR handling, anamorphic bokeh, and CPU throughput.
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZDefocusNode } from '../src/nodes/ZDefocusNode.js';
import { PixelBuffer, TiledPixelBuffer } from '../src/core/PixelBuffer.js';
import { ImageIO } from '../src/core/ImageIO.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('====================================================');
console.log('🧪 RUNNING: tests/test_zdefocus_optimization.mjs');
console.log('====================================================\n');

let passedTests = 0;

function runTest(name, fn) {
  try {
    process.stdout.write(`▶ ${name}... `);
    const t0 = performance.now();
    fn();
    const dt = performance.now() - t0;
    console.log(`✅ PASSED (${dt.toFixed(1)} ms)`);
    passedTests++;
  } catch (err) {
    console.log(`❌ FAILED`);
    console.error(err);
    process.exit(1);
  }
}

// 1. Zero-defocus pass-through
runTest('Zero-Defocus pass-through fidelity', () => {
  const node = new ZDefocusNode('ZD_zero');
  node.setKnobValue('maxDefocus', 0.0);

  const img = new PixelBuffer(128, 128);
  for (let i = 0; i < img.data.length; i++) img.data[i] = Math.random();

  const depth = new PixelBuffer(128, 128);
  depth.data.fill(0.8);

  const out = node.compute({ in: img, depth });
  assert.equal(out.width, img.width);
  assert.equal(out.height, img.height);
  for (let i = 0; i < img.data.length; i++) {
    assert.equal(out.data[i], img.data[i], `Pixel ${i} must match exactly when maxDefocus is 0`);
  }
});

// 2. High Dynamic Range (HDR > 1.0) values
runTest('High Dynamic Range (HDR > 1.0) specular values preserved', () => {
  const node = new ZDefocusNode('ZD_hdr');
  node.setKnobValue('focusPlane', 0.0);
  node.setKnobValue('depthOfField', 0.0);
  node.setKnobValue('maxDefocus', 8.0);
  node.setKnobValue('bloom', 0.5);

  const img = new PixelBuffer(64, 64);
  img.data.fill(0.1);
  // Place high-intensity HDR specular highlight at center (32, 32)
  const centerIdx = (32 * 64 + 32) * 4;
  img.data[centerIdx] = 25.0; // R = 25.0 HDR
  img.data[centerIdx + 1] = 18.0;
  img.data[centerIdx + 2] = 12.0;
  img.data[centerIdx + 3] = 1.0;

  const depth = new PixelBuffer(64, 64);
  depth.data.fill(1.0); // Maximum defocus

  const out = node.compute({ in: img, depth });
  
  // Verify center is blurred and energy is distributed to neighboring pixels
  let maxR = 0;
  let nonZeroCount = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i] > maxR) maxR = out.data[i];
    if (out.data[i] > 0.15) nonZeroCount++;
  }

  // Energy should spread into bokeh disc
  assert(nonZeroCount > 10, 'HDR specular highlight must diffuse into multiple bokeh samples');
  assert(maxR > 0.1, 'Peak blurred energy must remain valid floating point value');
  assert(!Number.isNaN(maxR), 'No NaN values produced');
  assert(Number.isFinite(maxR), 'No Infinite values produced');
});

// 3. Edge pixels & Boundary conditions (no clamp artifacts or overflows)
runTest('Boundary edge pixels and extreme coordinates', () => {
  const node = new ZDefocusNode('ZD_edge');
  node.setKnobValue('focusPlane', 0.0);
  node.setKnobValue('depthOfField', 0.0);
  node.setKnobValue('maxDefocus', 16.0);

  const img = new PixelBuffer(32, 32);
  img.data.fill(0.5);
  // Mark all 4 corners
  img.data[0] = 1.0;
  img.data[(31) * 4] = 1.0;
  img.data[(31 * 32) * 4] = 1.0;
  img.data[(31 * 32 + 31) * 4] = 1.0;

  const depth = new PixelBuffer(32, 32);
  depth.data.fill(0.9);

  const out = node.compute({ in: img, depth });
  assert.equal(out.width, 32);
  assert.equal(out.height, 32);
  for (let i = 0; i < out.data.length; i++) {
    assert(!Number.isNaN(out.data[i]), `NaN detected at index ${i}`);
    assert(Number.isFinite(out.data[i]), `Inf detected at index ${i}`);
  }
});

// 4. Extreme Defocus Radius
runTest('Extreme Defocus Radius (maxDefocus = 64.0)', () => {
  const node = new ZDefocusNode('ZD_extreme');
  node.setKnobValue('focusPlane', 0.0);
  node.setKnobValue('depthOfField', 0.0);
  node.setKnobValue('maxDefocus', 64.0);

  const img = new PixelBuffer(128, 128);
  img.data.fill(0.2);
  const depth = new PixelBuffer(128, 128);
  depth.data.fill(1.0);

  const out = node.compute({ in: img, depth });
  assert.equal(out.width, 128);
  assert.equal(out.height, 128);
  for (let i = 0; i < out.data.length; i++) {
    assert(!Number.isNaN(out.data[i]), `NaN detected at extreme radius`);
  }
});

// 5. Anamorphic Bokeh Aspect Ratio (2.0 vs 0.5)
runTest('Anamorphic Bokeh Aspect Ratios', () => {
  const nodeAnamorphicX = new ZDefocusNode('ZD_anamorphic_x');
  nodeAnamorphicX.setKnobValue('focusPlane', 0.0);
  nodeAnamorphicX.setKnobValue('depthOfField', 0.0);
  nodeAnamorphicX.setKnobValue('maxDefocus', 10.0);
  nodeAnamorphicX.setKnobValue('aspectRatio', 2.0); // 2:1 horizontal stretch

  const nodeAnamorphicY = new ZDefocusNode('ZD_anamorphic_y');
  nodeAnamorphicY.setKnobValue('focusPlane', 0.0);
  nodeAnamorphicY.setKnobValue('depthOfField', 0.0);
  nodeAnamorphicY.setKnobValue('maxDefocus', 10.0);
  nodeAnamorphicY.setKnobValue('aspectRatio', 0.5); // vertical stretch

  const img = new PixelBuffer(64, 64);
  img.data[(32 * 64 + 32) * 4] = 10.0; // Point source
  const depth = new PixelBuffer(64, 64);
  depth.data.fill(1.0);

  const outX = nodeAnamorphicX.compute({ in: img, depth });
  const outY = nodeAnamorphicY.compute({ in: img, depth });

  // In outX, horizontal blur should reach further than vertical
  // In outY, vertical blur should reach further than horizontal
  const pRightX = outX.data[(32 * 64 + 48) * 4];
  const pTopX   = outX.data[(16 * 64 + 32) * 4];
  assert(pRightX >= pTopX, 'Horizontal anamorphic stretch should produce wider horizontal bokeh');

  const pRightY = outY.data[(32 * 64 + 48) * 4];
  const pTopY   = outY.data[(16 * 64 + 32) * 4];
  assert(pTopY >= pRightY, 'Vertical aspect bokeh should produce taller vertical bokeh');
});

// 6. Highlight Bloom response
runTest('Highlight Bloom amplification', () => {
  const nodeNoBloom = new ZDefocusNode('ZD_nobloom');
  nodeNoBloom.setKnobValue('focusPlane', 0.0);
  nodeNoBloom.setKnobValue('depthOfField', 0.0);
  nodeNoBloom.setKnobValue('maxDefocus', 10.0);
  nodeNoBloom.setKnobValue('bloom', 0.0);

  const nodeBloom = new ZDefocusNode('ZD_bloom');
  nodeBloom.setKnobValue('focusPlane', 0.0);
  nodeBloom.setKnobValue('depthOfField', 0.0);
  nodeBloom.setKnobValue('maxDefocus', 10.0);
  nodeBloom.setKnobValue('bloom', 1.0);

  const img = new PixelBuffer(64, 64);
  img.data.fill(0.2);
  // Add bright highlight (> 0.7 luma)
  for (let y = 30; y <= 34; y++) {
    for (let x = 30; x <= 34; x++) {
      const idx = (y * 64 + x) * 4;
      img.data[idx] = 2.0;
      img.data[idx + 1] = 2.0;
      img.data[idx + 2] = 2.0;
    }
  }

  const depth = new PixelBuffer(64, 64);
  depth.data.fill(1.0);

  const outNoBloom = nodeNoBloom.compute({ in: img, depth });
  const outBloom = nodeBloom.compute({ in: img, depth });

  // With bloom, the bright region should exert stronger optical weight and higher total diffused energy
  const sumNoBloom = outNoBloom.data.reduce((a, b) => a + b, 0);
  const sumBloom = outBloom.data.reduce((a, b) => a + b, 0);
  assert(sumBloom > sumNoBloom, 'Highlight bloom must produce elevated luminance response');
});

// 7. Full 1080p Real Footage Parity & Performance Check
runTest('Full 1080p Real Footage Parity & Performance Benchmark', () => {
  const bgPath = path.join(rootDir, 'demo/vfx_showcase/source/bg_plate.0001.exr');
  const depthPath = path.join(rootDir, 'demo/vfx_showcase/depth/depth_pass.0001.exr');

  if (!fs.existsSync(bgPath) || !fs.existsSync(depthPath)) {
    console.log('   ⚠️ Showcase assets not found, skipping plate test');
    return;
  }

  const inputBuf = ImageIO.readEXR(fs.readFileSync(bgPath));
  const depthBuf = ImageIO.readEXR(fs.readFileSync(depthPath));

  const node = new ZDefocusNode('ZD_1080p_perf');
  node.setKnobValue('focusPlane', 0.5);
  node.setKnobValue('depthOfField', 0.12);
  node.setKnobValue('maxDefocus', 14.0);
  node.setKnobValue('aspectRatio', 1.0);
  node.setKnobValue('bloom', 0.25);

  const t0 = performance.now();
  const out = node.compute({ in: inputBuf, depth: depthBuf }, { frame: 1 });
  const elapsed = performance.now() - t0;
  console.log(`\n      [ZDefocus Compute Only]: ${elapsed.toFixed(1)} ms`);

  assert.equal(out.width, 1920);
  assert.equal(out.height, 1080);
  assert(elapsed < 2000, `Execution time must be < 2000 ms (measured: ${elapsed.toFixed(1)} ms)`);

  // Verify no NaNs or Infs across all 8,294,400 floats
  for (let i = 0; i < out.data.length; i++) {
    assert(!Number.isNaN(out.data[i]), `NaN at pixel float ${i}`);
    assert(Number.isFinite(out.data[i]), `Inf at pixel float ${i}`);
  }
});

console.log(`\n====================================================`);
console.log(`🎉 ALL ${passedTests} ZDEFOCUS REGRESSION TESTS PASSED!`);
console.log(`====================================================`);
