import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));

const bgPath = path.join(workspace, 'demo/vfx_showcase/source/bg_plate.0001.exr');
const depthPath = path.join(workspace, 'demo/vfx_showcase/depth/depth_pass.0001.exr');
const inputBuf = ImageIO.readEXR(fs.readFileSync(bgPath));
const depthBuf = ImageIO.readEXR(fs.readFileSync(depthPath));

const w = inputBuf.width;
const h = inputBuf.height;
const focusPlane = 0.5;
const dof = 0.12;
const maxDefocus = 14.0;
const aspect = 1.0;

const cocMap = new Float32Array(w * h);
const halfDof = dof * 0.5;
const normFactor = Math.max(0.01, 1.0 - halfDof);
const invNormFactor = 1.0 / normFactor;

for (let i = 0; i < w * h; i++) {
  const z = depthBuf.data[i * 4];
  const delta = Math.abs(z - focusPlane) - halfDof;
  if (delta <= 0) {
    cocMap[i] = 0;
  } else {
    const cocNorm = delta < normFactor ? delta * invNormFactor : 1.0;
    cocMap[i] = cocNorm * maxDefocus;
  }
}

const numSamples = 24;
const offDX = new Float32Array(numSamples);
const offDY = new Float32Array(numSamples);
const goldenAngle = 2.39996323;
for (let i = 0; i < numSamples; i++) {
  const r = Math.sqrt((i + 0.5) / numSamples);
  const theta = i * goldenAngle;
  offDX[i] = r * Math.cos(theta) * aspect;
  offDY[i] = r * Math.sin(theta);
}

const sampleLinearOffset = new Int32Array(numSamples);
let lastCoC = -999.0;
let totalSamples = 0;
let cocEqualOrGreaterCount = 0;
let cocExactEqualCount = 0;

for (let y = 14; y < h - 14; y++) {
  const rowOffset = y * w;
  for (let x = 14; x < w - 14; x++) {
    const centerIdx = rowOffset + x;
    const centerCoC = cocMap[centerIdx];
    if (centerCoC < 0.5) continue;

    if (centerCoC !== lastCoC) {
      lastCoC = centerCoC;
      for (let s = 0; s < numSamples; s++) {
        const sx = Math.round(offDX[s] * centerCoC);
        const sy = Math.round(offDY[s] * centerCoC);
        sampleLinearOffset[s] = sy * w + sx;
      }
    }

    for (let s = 0; s < numSamples; s++) {
      totalSamples++;
      const sCoC = cocMap[centerIdx + sampleLinearOffset[s]];
      if (sCoC >= centerCoC) cocEqualOrGreaterCount++;
      if (sCoC === centerCoC) cocExactEqualCount++;
    }
  }
}

console.log(`Total Interior Samples: ${totalSamples}`);
console.log(`Samples where sCoC >= centerCoC: ${cocEqualOrGreaterCount} (${((cocEqualOrGreaterCount / totalSamples)*100).toFixed(1)}%)`);
console.log(`Samples where sCoC === centerCoC: ${cocExactEqualCount} (${((cocExactEqualCount / totalSamples)*100).toFixed(1)}%)`);

