import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { ZDefocusNode } = await import('file:///' + path.join(workspace, 'src/nodes/ZDefocusNode.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));
const { PixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));

const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const depthPath = path.join(workspace, 'demo/vfx_showcase/depth/depth_pass.0001.exr');

const inputBuf = ImageIO.readEXR(fs.readFileSync(bgPath));
const depthBuf = ImageIO.readEXR(fs.readFileSync(depthPath));

const node = new ZDefocusNode('ZD_test');
node.setKnobValue('focusPlane', 0.5);
node.setKnobValue('depthOfField', 0.12);
node.setKnobValue('maxDefocus', 14.0);
node.setKnobValue('aspectRatio', 1.0);
node.setKnobValue('bloom', 0.25);

console.log('Testing standalone ZDefocus compute on 1080p plate:');
for (let i = 0; i < 10; i++) {
  const t0 = performance.now();
  const out = node.compute({ in: inputBuf, depth: depthBuf }, { frame: 1 });
  const dt = performance.now() - t0;
  console.log(`Run ${i + 1}: ${dt.toFixed(2)} ms`);
}

