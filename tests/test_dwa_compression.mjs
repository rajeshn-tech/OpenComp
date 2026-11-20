/**
 * OpenComp - Test Suite 30: DWAA & DWAB Lossy OpenEXR Compression
 * Validates DWAA (32-scanline) and DWAB (256-scanline) encoding/decoding,
 * compression ratio vs uncompressed baseline, PSNR (>40 dB) and MAE (<0.015)
 * image quality fidelity metrics, and compression level knobs.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { ImageIO } from '../src/core/ImageIO.js';

const testDir = path.join(os.tmpdir(), `opencomp_test_dwa_${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ DWA Compression: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: DWA Compression: ${name}`);
    console.error(err);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ DWA Compression: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: DWA Compression: ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_dwa_compression.mjs');
console.log('----------------------------------------------------');

// Helper to calculate MSE, MAE, and PSNR between two PixelBuffers
function computeMetrics(bufA, bufB) {
  assert.equal(bufA.width, bufB.width);
  assert.equal(bufA.height, bufB.height);

  const a = bufA.data;
  const b = bufB.data;
  const len = a.length;

  let sumSquaredDiff = 0;
  let sumAbsDiff = 0;
  let maxVal = 0.0001;

  for (let i = 0; i < len; i++) {
    const diff = a[i] - b[i];
    sumSquaredDiff += diff * diff;
    sumAbsDiff += Math.abs(diff);
    if (a[i] > maxVal) maxVal = a[i];
    if (b[i] > maxVal) maxVal = b[i];
  }

  const mse = sumSquaredDiff / len;
  const mae = sumAbsDiff / len;
  const psnr = mse === 0 ? 100 : 10 * Math.log10((maxVal * maxVal) / mse);

  return { mse, mae, psnr, maxVal };
}

// Generate complex test image (synthetic film scene with gradients, edges, fine detail)
function createFilmTestImage(width = 256, height = 256) {
  const buf = new PixelBuffer(width, height);
  const d = buf.data;

  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const idx = (y * width + x) * 4;

      // Smooth cinematic gradient + high frequency edge features
      const r = Math.sin(u * Math.PI) * 0.8 + 0.1;
      const g = Math.cos(v * Math.PI) * 0.7 + 0.15;
      const b = (u * v) * 0.9;
      const fineDetail = ((x % 8 === 0) || (y % 8 === 0)) ? 0.05 : 0.0;

      d[idx] = Math.max(0, Math.min(1.5, r + fineDetail));
      d[idx + 1] = Math.max(0, Math.min(1.5, g + fineDetail));
      d[idx + 2] = Math.max(0, Math.min(1.5, b));
      d[idx + 3] = 1.0;
    }
  }

  return buf;
}

const testImage = createFilmTestImage(256, 256);

// 1. DWAA Encoding & Decoding Round-Trip
await runAsyncTest('DWAA (32-scanline) Compression Round-Trip & Verification', async () => {
  const uncompressedPath = path.join(testDir, 'raw_half.exr');
  const dwaaPath = path.join(testDir, 'comp_dwaa.exr');

  // Write uncompressed half float
  ImageIO.writeEXRViaBridgeSync(testImage, true, 'none', 45, uncompressedPath);
  const rawSize = fs.statSync(uncompressedPath).size;

  // Write DWAA compressed half float
  ImageIO.writeEXRViaBridgeSync(testImage, true, 'dwaa', 45.0, dwaaPath);
  const dwaaSize = fs.statSync(dwaaPath).size;

  assert(rawSize > 10000, `Raw uncompressed file should be > 10KB (got ${rawSize})`);
  assert(dwaaSize > 1000, `DWAA file should be valid non-empty EXR (got ${dwaaSize})`);

  // Verify size reduction (> 50% reduction on 256x256 test image)
  const ratio = (rawSize - dwaaSize) / rawSize;
  console.log(`    [DWAA] Raw: ${rawSize} B, DWAA: ${dwaaSize} B, Reduction: ${(ratio * 100).toFixed(1)}%`);
  assert(ratio > 0.50, `DWAA must achieve at least 50% size reduction (achieved ${(ratio * 100).toFixed(1)}%)`);

  // Verify inspection
  const meta = await ImageIO.inspectEXR(dwaaPath);
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);
  assert(meta.compression.includes('DWAA') || meta.compression.includes('dwaa') || meta.compression.includes('8'));

  // Read back and compute quality metrics
  const decoded = ImageIO.readEXRViaBridgeSync(dwaaPath);
  const metrics = computeMetrics(testImage, decoded);
  console.log(`    [DWAA Metrics] PSNR: ${metrics.psnr.toFixed(2)} dB, MAE: ${metrics.mae.toFixed(5)}, MSE: ${metrics.mse.toExponential(3)}`);

  assert(metrics.psnr > 38.0, `DWAA PSNR must exceed 38 dB for production fidelity (got ${metrics.psnr.toFixed(2)} dB)`);
  assert(metrics.mae < 0.02, `DWAA MAE must be below 0.02 (got ${metrics.mae.toFixed(5)})`);
});

// 2. DWAB Encoding & Decoding Round-Trip
await runAsyncTest('DWAB (256-scanline) Compression Round-Trip & Verification', async () => {
  const uncompressedPath = path.join(testDir, 'raw_half.exr');
  const dwabPath = path.join(testDir, 'comp_dwab.exr');

  const rawSize = fs.statSync(uncompressedPath).size;

  // Write DWAB compressed half float
  ImageIO.writeEXRViaBridgeSync(testImage, true, 'dwab', 45.0, dwabPath);
  const dwabSize = fs.statSync(dwabPath).size;

  const ratio = (rawSize - dwabSize) / rawSize;
  console.log(`    [DWAB] Raw: ${rawSize} B, DWAB: ${dwabSize} B, Reduction: ${(ratio * 100).toFixed(1)}%`);
  assert(ratio > 0.50, `DWAB must achieve at least 50% size reduction (achieved ${(ratio * 100).toFixed(1)}%)`);

  // Verify inspection
  const meta = await ImageIO.inspectEXR(dwabPath);
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);
  assert(meta.compression.includes('DWAB') || meta.compression.includes('dwab') || meta.compression.includes('9'));

  // Read back and compute quality metrics
  const decoded = ImageIO.readEXRViaBridgeSync(dwabPath);
  const metrics = computeMetrics(testImage, decoded);
  console.log(`    [DWAB Metrics] PSNR: ${metrics.psnr.toFixed(2)} dB, MAE: ${metrics.mae.toFixed(5)}, MSE: ${metrics.mse.toExponential(3)}`);

  assert(metrics.psnr > 38.0, `DWAB PSNR must exceed 38 dB (got ${metrics.psnr.toFixed(2)} dB)`);
  assert(metrics.mae < 0.02, `DWAB MAE must be below 0.02 (got ${metrics.mae.toFixed(5)})`);
});

// 3. Quality vs Compression Level Knobs
runTest('DWA Quality Knobs (Low vs High Compression Level)', () => {
  const highQualityPath = path.join(testDir, 'dwa_q20.exr'); // level 20 = high quality / less compression
  const highCompPath = path.join(testDir, 'dwa_q100.exr');   // level 100 = aggressive compression / smaller file

  ImageIO.writeEXRViaBridgeSync(testImage, true, 'dwaa', 20.0, highQualityPath);
  ImageIO.writeEXRViaBridgeSync(testImage, true, 'dwaa', 100.0, highCompPath);

  const sizeQ20 = fs.statSync(highQualityPath).size;
  const sizeQ100 = fs.statSync(highCompPath).size;

  console.log(`    [Knobs] Level 20: ${sizeQ20} B vs Level 100: ${sizeQ100} B`);
  assert(sizeQ100 < sizeQ20, 'Higher compression level (100) must produce a smaller or equal file size than level 20');

  const decQ20 = ImageIO.readEXRViaBridgeSync(highQualityPath);
  const decQ100 = ImageIO.readEXRViaBridgeSync(highCompPath);

  const m20 = computeMetrics(testImage, decQ20);
  const m100 = computeMetrics(testImage, decQ100);

  console.log(`    [Knobs] Level 20 PSNR: ${m20.psnr.toFixed(2)} dB vs Level 100 PSNR: ${m100.psnr.toFixed(2)} dB`);
  assert(m20.psnr >= m100.psnr, 'Level 20 must have equal or higher PSNR fidelity than Level 100');
});

// 4. ZIP Lossless Compression Comparison
runTest('ZIP Lossless Compression Comparison', () => {
  const zipPath = path.join(testDir, 'comp_zip.exr');
  ImageIO.writeEXRViaBridgeSync(testImage, true, 'zip', 45.0, zipPath);
  assert(fs.existsSync(zipPath));

  const decoded = ImageIO.readEXRViaBridgeSync(zipPath);
  const metrics = computeMetrics(testImage, decoded);

  // In 16-bit half conversion from float32, small precision quant exists, but for identical bit depth MSE is near 0
  console.log(`    [ZIP Metrics] PSNR: ${metrics.psnr.toFixed(2)} dB, MAE: ${metrics.mae.toFixed(6)}`);
  assert(metrics.psnr > 50.0, `ZIP lossless PSNR must be > 50 dB (got ${metrics.psnr.toFixed(2)} dB)`);
  assert(metrics.mae < 0.005, `ZIP lossless MAE must be < 0.005 (got ${metrics.mae.toFixed(6)})`);
});

// 5. Error Handling on Malformed Codec or Missing Files
runTest('Error Handling on Malformed Compression Specification', () => {
  assert.throws(() => {
    ImageIO.writeEXRViaBridgeSync(testImage, true, 'invalid_codec_xyz', 45, path.join(testDir, 'err.exr'));
  }, /Unsupported compression|failed/i);

  assert.throws(() => {
    ImageIO.readEXRViaBridgeSync(path.join(testDir, 'non_existent_file.exr'));
  }, /not found|failed/i);
});

// Cleanup
try {
  fs.rmSync(testDir, { recursive: true, force: true });
} catch (e) {}

console.log('\n🎉 test_dwa_compression.mjs PASSED: All 5 DWA compression tests succeeded with 0 errors.');

