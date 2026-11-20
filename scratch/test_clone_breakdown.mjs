import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

const fgPath = path.join(workspace, 'demo/vfx_showcase/source/fg_element.0001.exr');
const fgBuf = ImageIO.readEXR(fs.readFileSync(fgPath));

console.log('fgBuf metadata keys:', Object.keys(fgBuf.metadata || {}));
console.log('fgBuf extraChannels:', Array.from(fgBuf.extraChannels ? fgBuf.extraChannels.keys() : []));

// Measure clone time breakdown
const t0 = performance.now();
for (let i = 0; i < 5; i++) {
  const c = fgBuf.clone();
}
const dt = (performance.now() - t0) / 5;
console.log(`fgBuf.clone() time: ${dt.toFixed(2)} ms`);

// Test clone without JSON.parse(JSON.stringify)
const t1 = performance.now();
for (let i = 0; i < 5; i++) {
  const copy = new fgBuf.constructor(fgBuf.width, fgBuf.height);
  copy.data.set(fgBuf.data);
}
const dt1 = (performance.now() - t1) / 5;
console.log(`Buffer alloc + set(data) only: ${dt1.toFixed(2)} ms`);
