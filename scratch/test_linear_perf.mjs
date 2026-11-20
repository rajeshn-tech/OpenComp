import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { GradeNode } = await import('file:///' + path.join(workspace, 'src/nodes/GradeNode.js').replace(/\\/g, '/'));
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const plateBuf = ImageIO.readEXR(fs.readFileSync(bgPath));

const n = new GradeNode('lin');
n.setKnobValue('gain', 1.5);
n.setKnobValue('gamma', 1.0);
n.compute({ in: plateBuf }); // warmup

console.log('Linear Grade Steady State Timings (1080p, 8.29M floats):');
const times = [];
for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  n.compute({ in: plateBuf });
  const dt = performance.now() - t0;
  times.push(dt);
  console.log(`  Run ${i + 1}: ${dt.toFixed(2)} ms`);
}
const avg = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`Average: ${avg.toFixed(2)} ms`);

