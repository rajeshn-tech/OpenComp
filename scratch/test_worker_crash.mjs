import { Worker } from 'node:worker_threads';
import { ZDefocusNode } from '../src/nodes/ZDefocusNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

console.log('Testing worker crash behavior...');
// Let's see what happens if one worker in the pool is terminated
const node = new ZDefocusNode('crash_test');
const img = new PixelBuffer(1000, 600);
const depth = new PixelBuffer(1000, 600);

// Normal execution first
const out1 = node.compute({ in: img, depth });
console.log('Initial execute OK, width:', out1.width);

