/**
 * OpenComp - Final Acceptance Audit: AOV Preservation Pipeline Test
 * Verifies Read -> Shuffle -> Grade -> Write preserving arbitrary auxiliary channels.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { Graph } from '../../src/core/Graph.js';
import { createNode } from '../../src/nodes/index.js';
import { PixelBuffer } from '../../src/core/PixelBuffer.js';
import { ImageIO } from '../../src/core/ImageIO.js';

const outDir = path.resolve('tests/final_audit/aov');
fs.mkdirSync(outDir, { recursive: true });

async function runAOVTest() {
  const w = 512;
  const h = 512;
  const numPx = w * h;

  // 1. Create source buffer with multi-layer AOVs
  const srcBuf = new PixelBuffer(w, h);
  srcBuf.fill(0.1, 0.2, 0.3, 1.0); // Beauty RGBA

  const diffR = new Float32Array(numPx).fill(0.5);
  const diffG = new Float32Array(numPx).fill(0.6);
  const diffB = new Float32Array(numPx).fill(0.7);
  const specR = new Float32Array(numPx).fill(0.25);
  const depthZ = new Float32Array(numPx).map((_, i) => (i % 512) / 10.0);
  const cryptoMat = new Float32Array(numPx).fill(1042.0);

  srcBuf.setChannel('diffuse.R', diffR);
  srcBuf.setChannel('diffuse.G', diffG);
  srcBuf.setChannel('diffuse.B', diffB);
  srcBuf.setChannel('specular.R', specR);
  srcBuf.setChannel('depth.Z', depthZ);
  srcBuf.setChannel('crypto_material.01', cryptoMat);

  // Write multi-channel source EXR
  const srcExrPath = path.join(outDir, 'source_multipass.exr');
  const srcBytes = ImageIO.writeEXR(srcBuf, false);
  fs.writeFileSync(srcExrPath, srcBytes);
  console.log(`[AOV] Generated source multi-channel EXR: "${srcExrPath}" (${(srcBytes.length / (1024*1024)).toFixed(2)} MB)`);

  // 2. Build DAG: Read -> Shuffle -> Grade -> Write
  const g = new Graph();

  const read = createNode('Read', 'Read_MultiAOV');
  read.setUploadedImage(srcBuf); // or read from disk

  const shuffle = createNode('Shuffle', 'Shuffle_DepthToAlpha');
  shuffle.setKnobValue('red', 'diffuse.R');
  shuffle.setKnobValue('green', 'diffuse.G');
  shuffle.setKnobValue('blue', 'diffuse.B');
  shuffle.setKnobValue('alpha', 'depth.Z');

  const grade = createNode('Grade', 'Grade_Diffuse');
  grade.setKnobValue('gain', 1.5); // Boost RGB diffuse by 1.5x (0.5 * 1.5 = 0.75)

  const write = createNode('Write', 'Write_AOV_Out');
  write.setKnobValue('fileType', 'image/exr');
  write.setKnobValue('channels', 'all'); // Preserve all channels
  write.setKnobValue('compression', 'none');

  g.addNode(read);
  g.addNode(shuffle);
  g.addNode(grade);
  g.addNode(write);

  g.connect('Read_MultiAOV', 'out', 'Shuffle_DepthToAlpha', 'in');
  g.connect('Shuffle_DepthToAlpha', 'out', 'Grade_Diffuse', 'in');
  g.connect('Grade_Diffuse', 'out', 'Write_AOV_Out', 'in');

  // Evaluate
  const evaluated = g.evaluate('Write_AOV_Out');
  assert.equal(evaluated.width, w);
  assert.equal(evaluated.height, h);

  // Verify that evaluated buffer preserved extraChannels
  assert(evaluated.hasChannel('specular.R'), 'specular.R must be preserved through Shuffle and Grade');
  assert(evaluated.hasChannel('crypto_material.01'), 'crypto_material.01 must be preserved');

  // Verify RGBA contains graded diffuse values
  const px0 = evaluated.getPixel(0, 0);
  assert(Math.abs(px0[0] - 0.75) < 1e-4, `Red channel should be 0.5 * 1.5 = 0.75, got ${px0[0]}`);
  assert(Math.abs(px0[1] - 0.90) < 1e-4, `Green channel should be 0.6 * 1.5 = 0.90, got ${px0[1]}`);

  // Write out frame to disk
  const outExrPath = path.join(outDir, 'graded_multipass_output.exr');
  write.exportFrame(evaluated, outExrPath);
  assert(fs.existsSync(outExrPath), 'Output EXR must exist on disk');

  console.log(`[AOV] Successfully exported processed multi-channel EXR: "${outExrPath}"`);
}

runAOVTest().catch(err => {
  console.error(err);
  process.exit(1);
});

