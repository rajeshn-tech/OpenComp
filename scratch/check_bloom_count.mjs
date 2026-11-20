import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const inputBuf = ImageIO.readEXR(fs.readFileSync(bgPath));
const d = inputBuf.data;
let bloomCount = 0;
for (let i = 0; i < d.length; i += 4) {
  const luma = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
  if (luma > 0.7) bloomCount++;
}
console.log(`Pixels with luma > 0.7: ${bloomCount} / ${d.length / 4} (${((bloomCount / (d.length / 4)) * 100).toFixed(2)}%)`);

