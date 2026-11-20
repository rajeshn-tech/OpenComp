import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const inputBuf = ImageIO.readEXR(fs.readFileSync(bgPath));

let allOne = true;
for (let i = 3; i < inputBuf.data.length; i += 4) {
  if (inputBuf.data[i] !== 1.0) {
    allOne = false;
    break;
  }
}
console.log('Is bg_plate alpha strictly 1.0 everywhere?', allOne);

