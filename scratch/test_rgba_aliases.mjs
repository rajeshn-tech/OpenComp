import { PixelBuffer } from '../src/core/PixelBuffer.js';

const buf = new PixelBuffer(4, 4);
buf.fill(0.1, 0.2, 0.3, 0.4);

console.log('hasChannel("rgba.alpha"):', buf.hasChannel('rgba.alpha'));
console.log('hasChannel("rgba.a"):', buf.hasChannel('rgba.a'));
console.log('hasChannel("rgba.red"):', buf.hasChannel('rgba.red'));
console.log('hasChannel("rgba.r"):', buf.hasChannel('rgba.r'));

console.log('getChannel("rgba.alpha"):', buf.getChannel('rgba.alpha'));

