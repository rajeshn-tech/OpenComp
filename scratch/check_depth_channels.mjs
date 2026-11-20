import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

const depthPath = path.join(workspace, 'demo/vfx_showcase/depth/depth_pass.0001.exr');
const buf = ImageIO.readEXR(fs.readFileSync(depthPath));

console.log('Channels:', buf.getChannelNames());
console.log('ExtraChannels keys:', Array.from(buf.extraChannels.keys()));
