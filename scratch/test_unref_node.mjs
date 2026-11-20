import { ZDefocusNode } from '../src/nodes/ZDefocusNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

const node = new ZDefocusNode('unref_test');
const img = new PixelBuffer(1000, 600);
const depth = new PixelBuffer(1000, 600);
node.compute({ in: img, depth });
console.log('Compute complete, letting event loop drain naturally without process.exit()...');

