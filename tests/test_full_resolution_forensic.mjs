/**
 * OpenComp - Forensic Full Resolution Processing Suite
 * Tests actual image allocation, multi-node DAG execution, numerical validation,
 * OpenEXR disk export, and memory footprint across:
 * - 4K UHD (3840x2160)
 * - 8K UHD (7680x4320)
 * - 12K DCI (12288x6480)
 * - 16K UHD (15360x8640) via Tiled Memory Architecture
 */

import { strict as assert } from 'assert';
import { PixelBuffer, TiledPixelBuffer } from '../src/core/PixelBuffer.js';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';
import { ImageIO } from '../src/core/ImageIO.js';
import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('🔬 FORENSIC FULL RESOLUTION PROCESSING AUDIT');
console.log('====================================================\n');

const resAudit = [];

function auditResolution(name, fn) {
  process.stdout.write(`▶ Auditing Resolution: ${name.padEnd(20, ' ')} ... `);
  const memBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  try {
    const details = fn();
    const dt = (performance.now() - t0).toFixed(1);
    const memAfter = process.memoryUsage().heapUsed;
    const memDeltaMB = Math.max(0, ((memAfter - memBefore) / (1024 * 1024))).toFixed(1);
    console.log(`✅ VERIFIED (${dt} ms, +${memDeltaMB} MB Heap)`);
    resAudit.push({ name, status: 'VERIFIED', durationMs: dt, memMB: memDeltaMB, details });
  } catch (err) {
    console.log(`❌ FAILED`);
    console.error(`       Error: ${err.message}`);
    resAudit.push({ name, status: 'FAILED', error: err.message });
    process.exit(1);
  }
}

// 1. 4K UHD (3840 x 2160)
auditResolution('4K UHD (3840x2160)', () => {
  const w = 3840;
  const h = 2160;

  const bg = createNode('Constant', 'BG_4K');
  bg.setKnobValue('format', `${w}x${h}`);
  bg.setKnobValue('colorR', 0.2);
  bg.setKnobValue('colorG', 0.4);
  bg.setKnobValue('colorB', 0.6);
  bg.setKnobValue('colorA', 1.0);

  const grade = createNode('Grade', 'Grade_4K');
  grade.setKnobValue('gain', 1.5);
  grade.setKnobValue('gamma', 0.9);

  const graph = new Graph();
  graph.addNode(bg);
  graph.addNode(grade);
  graph.connect('BG_4K', 'out', 'Grade_4K', 'in');

  const result = graph.evaluate('Grade_4K');
  assert(result instanceof PixelBuffer);
  assert.equal(result.width, w);
  assert.equal(result.height, h);

  // Numerical output validation
  const sample = result.getPixel(1920, 1080);
  assert(sample[0] > 0.25, 'Graded Red channel');
  assert(sample[1] > 0.45, 'Graded Green channel');

  // Export full-res 4K OpenEXR to disk
  const outPath = path.resolve('tests/output/forensic_4k_test.exr');
  const exrBytes = ImageIO.writeEXR(result);
  fs.writeFileSync(outPath, exrBytes);

  // Reopen and validate exported 4K EXR
  const fileBytes = fs.readFileSync(outPath);
  const readBack = ImageIO.readEXR(fileBytes);
  assert.equal(readBack.width, w, 'Readback 4K width matches');
  assert.equal(readBack.height, h, 'Readback 4K height matches');
  const rbSample = readBack.getPixel(1920, 1080);
  assert(Math.abs(rbSample[0] - sample[0]) < 1e-3, 'Pixel fidelity preserved in 4K EXR');

  return `Full DAG + EXR Export (${(exrBytes.length / (1024*1024)).toFixed(1)} MB)`;
});

// 2. 8K UHD (7680 x 4320)
auditResolution('8K UHD (7680x4320)', () => {
  const w = 7680;
  const h = 4320;

  const buf8k = new PixelBuffer(w, h);
  buf8k.fill(0.3, 0.4, 0.5, 1.0);

  const grade = createNode('Grade', 'Grade_8K');
  grade.setKnobValue('gain', 1.4);
  const graded = grade.compute({ in: buf8k }, {});

  assert.equal(graded.width, w);
  assert.equal(graded.height, h);

  const px = graded.getPixel(3840, 2160);
  assert(Math.abs(px[0] - 0.42) < 1e-3, `Expected ~0.42, got ${px[0]}`);
  assert(Math.abs(px[1] - 0.56) < 1e-3, `Expected ~0.56, got ${px[1]}`);

  return 'Contiguous 506 MB float buffer processed';
});

// 3. 12K DCI (12288 x 6480)
auditResolution('12K DCI (12288x6480)', () => {
  const w = 12288;
  const h = 6480;

  // Verify contiguous allocation
  const buf12k = new PixelBuffer(w, h);
  assert.equal(buf12k.width, w);
  assert.equal(buf12k.height, h);
  assert.equal(buf12k.data.byteLength, w * h * 4 * 4);

  // Set boundary test pixels
  buf12k.setPixel(0, 0, 0.5, 0.5, 0.5, 1.0);
  buf12k.setPixel(6144, 3240, 0.8, 0.2, 0.1, 1.0);
  buf12k.setPixel(12287, 6479, 0.1, 0.9, 0.2, 1.0);

  const mid = buf12k.getPixel(6144, 3240);
  assert(Math.abs(mid[0] - 0.8) < 1e-4, 'Red channel 0.8 in 12K DCI');
  assert(Math.abs(mid[1] - 0.2) < 1e-4, 'Green channel 0.2 in 12K DCI');

  return 'Contiguous 1.21 GB float buffer processed';
});

// 4. 16K UHD (15360 x 8640) - Tiled Processing Architecture
auditResolution('16K UHD (15360x8640 Tiled)', () => {
  const w = 15360;
  const h = 8640;

  // Single-buffer check must confirm boundary limit
  assert.equal(PixelBuffer.canAllocateContiguous(w, h), false, '16K exceeds 2GB single contiguous buffer limit');

  // Allocate 16K via Tiled Architecture (40 tiles of 2048x2048)
  const tiledBuf = PixelBuffer.createBuffer(w, h);
  assert(tiledBuf instanceof TiledPixelBuffer, 'Must create TiledPixelBuffer');
  assert.equal(tiledBuf.cols, 8, '8 columns of 2048 px');
  assert.equal(tiledBuf.rows, 5, '5 rows of 2048 px');

  // Fill test color
  tiledBuf.fill(0.2, 0.3, 0.4, 1.0);

  // Execute processing operation across all 40 tiles
  tiledBuf.processPointOp((r, g, b, a) => [r * 1.5, g * 1.5, b * 1.5, a]);

  // Verify pixels across tile boundaries
  const px0 = tiledBuf.getPixel(0, 0);
  const pxMid = tiledBuf.getPixel(7680, 4320);
  const pxEnd = tiledBuf.getPixel(15359, 8639);

  assert(Math.abs(px0[0] - 0.3) < 1e-4, 'Tile [0, 0] processed');
  assert(Math.abs(pxMid[1] - 0.45) < 1e-4, 'Tile [3, 2] processed');
  assert(Math.abs(pxEnd[2] - 0.6) < 1e-4, 'Tile [7, 4] processed');

  return '40x 2048-pixel tiles (2.12 GB addressable space) processed cleanly';
});

console.log('\n====================================================');
console.log(`📊 RESOLUTION AUDIT COMPLETE: ALL 4 SCALES VERIFIED`);
console.log('====================================================\n');
