import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

const exrBytes = fs.readFileSync(path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr'));

// Warmup
ImageIO.readEXR(exrBytes);

const N = 10;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  ImageIO.readEXR(exrBytes);
}
const dt = (performance.now() - t0) / N;

console.log(`Current readEXR average time: ${dt.toFixed(2)} ms`);

