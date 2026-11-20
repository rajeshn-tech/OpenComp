import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { PixelBuffer, TiledPixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

// Check Tiled conversion
const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const plateBuf = ImageIO.readEXR(fs.readFileSync(bgPath));

const tiledBuf = new TiledPixelBuffer(plateBuf.width, plateBuf.height, 256);
for (let y = 0; y < plateBuf.height; y++) {
  for (let x = 0; x < plateBuf.width; x++) {
    const idx = (y * plateBuf.width + x) * 4;
    tiledBuf.setPixel(x, y, plateBuf.data[idx], plateBuf.data[idx+1], plateBuf.data[idx+2], plateBuf.data[idx+3]);
  }
}

console.log('Tiled buffer created:', tiledBuf.cols, 'x', tiledBuf.rows, 'tiles');

