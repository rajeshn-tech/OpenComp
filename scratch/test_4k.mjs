import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { PixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));

console.log('Testing 4K UHD (3840x2160) allocation and pool sizing...');
const w = 3840;
const h = 2160;
const numPixels = w * h;
console.log(`4K UHD Pixels: ${numPixels} (${(numPixels * 16 / (1024*1024)).toFixed(1)} MB per buffer)`);

