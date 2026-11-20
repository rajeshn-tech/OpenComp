import { ZDefocusNode } from '../src/nodes/ZDefocusNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

const node = new ZDefocusNode('test');
const img = new PixelBuffer(1920, 1080);
const depth = new PixelBuffer(1920, 1080);

const t0 = performance.now();
const res = node.compute({ in: img, depth });
console.log('Time:', performance.now() - t0);

