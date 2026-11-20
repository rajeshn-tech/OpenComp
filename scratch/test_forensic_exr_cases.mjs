import fs from 'fs';
import path from 'path';
import { PixelBuffer, TiledPixelBuffer } from '../src/core/PixelBuffer.js';
import { ImageIO } from '../src/core/ImageIO.js';

console.log('--- TEST 1: Missing Alpha (RGB Only) ---');
const w = 4, h = 4;
// Create an RGB-only buffer by writing EXR with channels R, G, B
const rgbBuf = new PixelBuffer(w, h);
rgbBuf.fill(0.5, 0.6, 0.7, 0.0);
// Delete alpha from channel names if possible or write custom header
const exrRGB = ImageIO.writeEXR(rgbBuf, false);
const loadedRGB = ImageIO.readEXR(exrRGB);
console.log('Loaded RGB alpha pixel 0:', loadedRGB.getPixel(0, 0)[3]);

console.log('\n--- TEST 2: Primary Channel Aliases ---');
const aliasBuf = new PixelBuffer(w, h);
aliasBuf.fill(0.1, 0.2, 0.3, 1.0);
const redArr = new Float32Array(w * h).fill(0.99);
const alphaArr = new Float32Array(w * h).fill(0.77);

for (const alias of ['r', 'red', 'rgba.r', 'rgba.red']) {
  aliasBuf.setChannel(alias, redArr);
  console.log(`setChannel("${alias}") -> data[0]: ${aliasBuf.data[0]}, hasChannel: ${aliasBuf.hasChannel(alias)}, extraChannels.size: ${aliasBuf.extraChannels.size}`);
}

for (const alias of ['a', 'alpha', 'rgba.a', 'rgba.alpha']) {
  aliasBuf.setChannel(alias, alphaArr);
  console.log(`setChannel("${alias}") -> data[3]: ${aliasBuf.data[3]}, hasChannel: ${aliasBuf.hasChannel(alias)}, extraChannels.size: ${aliasBuf.extraChannels.size}`);
}

