import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { GradeNode } = await import('file:///' + path.join(workspace, 'src/nodes/GradeNode.js').replace(/\\/g, '/'));
const { PixelBuffer, TiledPixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

console.log('Testing existing GradeNode baseline behaviors...');

// 1. Test existing GradeNode with real EXR plate
const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const plateBuf = ImageIO.readEXR(fs.readFileSync(bgPath));

console.log(`Plate loaded: ${plateBuf.width}x${plateBuf.height}, pixels: ${plateBuf.width * plateBuf.height}`);

// Baseline tests for various knob configs
const configs = [
  { name: 'Grade_Atmosphere', knobs: { lift: 0.04, gain: 1.02, gamma: 0.98, blackClamp: true, whiteClamp: false } },
  { name: 'Grade_FilmMaster', knobs: { lift: 0.015, gain: 1.05, gamma: 1.05, blackClamp: true, whiteClamp: false } },
  { name: 'Grade_Rim', knobs: { gain: 1.25, gamma: 1.06, blackClamp: true, whiteClamp: false } },
  { name: 'Linear_Grade', knobs: { lift: 0.1, gain: 1.5, gamma: 1.0, blackClamp: true, whiteClamp: false } },
  { name: 'Both_Clamps', knobs: { lift: 0.05, gain: 1.2, gamma: 1.2, blackClamp: true, whiteClamp: true } },
  { name: 'No_Clamps', knobs: { lift: -0.1, gain: 1.3, gamma: 0.8, blackClamp: false, whiteClamp: false } },
  { name: 'Reverse_Grade', knobs: { lift: 0.04, gain: 1.02, gamma: 0.98, blackClamp: true, whiteClamp: false, reverse: true } },
];

for (const cfg of configs) {
  const node = new GradeNode('test_' + cfg.name);
  for (const [k, v] of Object.entries(cfg.knobs)) {
    node.setKnobValue(k, v);
  }
  const t0 = performance.now();
  const out = node.compute({ in: plateBuf });
  const dt = performance.now() - t0;
  console.log(`- ${cfg.name.padEnd(20)}: ${dt.toFixed(2)} ms (pixel[0]=${out.data[0].toFixed(5)}, pixel[100]=${out.data[100].toFixed(5)})`);
}

