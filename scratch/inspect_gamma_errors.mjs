import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { GradeNode } = await import('file:///' + path.join(workspace, 'src/nodes/GradeNode.js').replace(/\\/g, '/'));
const { PixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));

const testValues = [
  0.0, 1e-7, 1e-5, 1e-4, 0.001, 0.01,
  0.05, 0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 3.5, 3.9, 3.99,
  3.9999, 4.0, 4.0001, 8.0, 16.0
];

const gamma = 2.2;
const invGamma = 1.0 / gamma;

console.log(`Gamma: ${gamma}, invGamma: ${invGamma}`);
console.log('Value       | Exact Math.pow     | Node Compute       | Abs Diff');
console.log('-----------------------------------------------------------------');

const node = new GradeNode('inspect');
node.setKnobValue('gamma', gamma);
node.setKnobValue('blackClamp', true);
node.setKnobValue('whiteClamp', false);

for (const v of testValues) {
  const buf = new PixelBuffer(1, 1);
  buf.setPixel(0, 0, v, 0, 0, 1);
  const out = node.compute({ in: buf });
  const actual = out.getPixel(0, 0)[0];
  const expected = v > 0 ? Math.pow(v, invGamma) : 0;
  const diff = Math.abs(actual - expected);
  console.log(`${v.toString().padEnd(11)} | ${expected.toFixed(8).padStart(18)} | ${actual.toFixed(8).padStart(18)} | ${diff.toExponential(4)}`);
}

