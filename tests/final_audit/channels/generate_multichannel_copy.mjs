/**
 * OpenComp - Generate Multi-Channel Scalable Copy EXR
 * Creates a multi-channel composite using the newly stabilized Scalable CopyNode
 * mapping 8 concurrent AOV channels, while preserving existing unmapped channels.
 */

import { CopyNode } from '../../../src/nodes/CopyNode.js';
import { PixelBuffer } from '../../../src/core/PixelBuffer.js';
import { ImageIO } from '../../../src/core/ImageIO.js';
import path from 'path';
import fs from 'fs';

const width = 64;
const height = 64;
const len = width * height;

// 1. Create Base Buffer B with RGBA and untouched auxiliary channel 'ambient.R'
const bufB = new PixelBuffer(width, height);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    bufB.data[idx] = x / width;         // R gradient
    bufB.data[idx + 1] = y / height;     // G gradient
    bufB.data[idx + 2] = 0.5;            // B constant
    bufB.data[idx + 3] = 1.0;            // A constant
  }
}
const ambientData = new Float32Array(len).fill(42.5);
bufB.setChannel('ambient.R', ambientData);

// 2. Create Foreground Buffer A with 8 auxiliary channels
const bufA = new PixelBuffer(width, height);
const testChannels = [
  { name: 'depth.Z', val: 150.25 },
  { name: 'forward.u', val: 1.5 },
  { name: 'forward.v', val: -2.75 },
  { name: 'diffuse.R', val: 0.8 },
  { name: 'diffuse.G', val: 0.6 },
  { name: 'diffuse.B', val: 0.4 },
  { name: 'specular.R', val: 0.95 },
  { name: 'crypto_object.01', val: 1042.0 }
];

for (const ch of testChannels) {
  const arr = new Float32Array(len).fill(ch.val);
  bufA.setChannel(ch.name, arr);
}

// 3. Configure Scalable CopyNode with 8 concurrent mappings
const copy = new CopyNode('Copy_Scalable_8');
for (let i = 0; i < testChannels.length; i++) {
  copy.setKnobValue(`from${i}`, testChannels[i].name);
  copy.setKnobValue(`to${i}`, testChannels[i].name);
}

// 4. Compute output
const out = copy.compute({ B: bufB, A: bufA });

// 5. Gather channels into map for EXR export
const channelsMap = {
  'R': out.getChannel('R'),
  'G': out.getChannel('G'),
  'B': out.getChannel('B'),
  'A': out.getChannel('A'),
  'ambient.R': out.getChannel('ambient.R')
};

for (const ch of testChannels) {
  channelsMap[ch.name] = out.getChannel(ch.name);
}

const outDir = path.resolve('tests/final_audit/channels');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
const outExrPath = path.join(outDir, 'test_copy_scalable_8ch.exr');

// Write uncompressed / dwaa EXR via bridge
const { EXRBridgeClient } = ImageIO._loadBridgeClientSync();
const res = EXRBridgeClient.write(width, height, channelsMap, 'none', 45.0, false, outExrPath);

console.log(JSON.stringify({
  status: 'ok',
  outPath: outExrPath,
  totalChannels: Object.keys(channelsMap).length,
  channelNames: Object.keys(channelsMap).sort(),
  fileSize: fs.statSync(outExrPath).size
}, null, 2));

