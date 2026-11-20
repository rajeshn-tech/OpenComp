import fs from 'node:fs';
import path from 'node:path';
import { ZDefocusNode } from '../src/nodes/ZDefocusNode.js';
import { ImageIO } from '../src/core/ImageIO.js';

const bgPath = path.resolve('demo/vfx_showcase/source/bg_plate.0001.exr');
const depthPath = path.resolve('demo/vfx_showcase/depth/depth_pass.0001.exr');

const inputBuf = ImageIO.readEXR(fs.readFileSync(bgPath));
const depthBuf = ImageIO.readEXR(fs.readFileSync(depthPath));

console.log('inputBuf:', inputBuf.width, inputBuf.height, 'isTiled:', inputBuf.isTiled);
console.log('depthBuf:', depthBuf.width, depthBuf.height, 'isTiled:', depthBuf.isTiled);

const node = new ZDefocusNode('ZD_1080p_perf');
node.setKnobValue('focusPlane', 0.5);
node.setKnobValue('depthOfField', 0.12);
node.setKnobValue('maxDefocus', 14.0);
node.setKnobValue('aspectRatio', 1.0);
node.setKnobValue('bloom', 0.25);

const t0 = performance.now();
const out = node.compute({ in: inputBuf, depth: depthBuf }, { frame: 1 });
const elapsed = performance.now() - t0;
console.log('Elapsed:', elapsed.toFixed(1), 'ms');

