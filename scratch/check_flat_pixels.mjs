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
const bloom = 0.25;

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

const bloomFactor = bloom * 2.0;
const hasBloom = bloomFactor > 0.0001;
let bloomMap = null;
if (hasBloom) {
  bloomMap = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const sp4 = i * 4;
    const luma = inputBuf.data[sp4] * 0.2126 + inputBuf.data[sp4 + 1] * 0.7152 + inputBuf.data[sp4 + 2] * 0.0722;
    bloomMap[i] = 1.0 + Math.max(0.0, luma - 0.7) * bloomFactor;
  }
}

const sampleLinearOffset = new Int32Array(numSamples);
let lastCoC = -999.0;
let totalBlurredPixels = 0;
let allCoCEqualNoBloomPixels = 0;
let allCoCGreaterNoBloomPixels = 0;

for (let y = 14; y < h - 14; y++) {
  const rowOffset = y * w;
  for (let x = 14; x < w - 14; x++) {
    const centerIdx = rowOffset + x;
    const centerCoC = cocMap[centerIdx];
    if (centerCoC < 0.5) continue;
    totalBlurredPixels++;

    if (centerCoC !== lastCoC) {
      lastCoC = centerCoC;
      for (let s = 0; s < numSamples; s++) {
        const sx = Math.round(offDX[s] * centerCoC);
        const sy = Math.round(offDY[s] * centerCoC);
        sampleLinearOffset[s] = sy * w + sx;
      }
    }

    let allEqualNoBloom = true;
    let allGreaterNoBloom = true;

    for (let s = 0; s < numSamples; s++) {
      const sIdx = centerIdx + sampleLinearOffset[s];
      const sCoC = cocMap[sIdx];
      const sBloom = hasBloom ? bloomMap[sIdx] : 1.0;
      if (sCoC !== centerCoC || sBloom > 1.0001) {
        allEqualNoBloom = false;
      }
      if (sCoC < centerCoC || sBloom > 1.0001) {
        allGreaterNoBloom = false;
        break;
      }
    }

    if (allEqualNoBloom) allCoCEqualNoBloomPixels++;
    if (allGreaterNoBloom) allCoCGreaterNoBloomPixels++;
  }
}

console.log(`Total Interior Blurred Pixels: ${totalBlurredPixels}`);
console.log(`Pixels where ALL 24 samples have sCoC === centerCoC and bloom === 1.0: ${allCoCEqualNoBloomPixels} (${((allCoCEqualNoBloomPixels/totalBlurredPixels)*100).toFixed(1)}%)`);
console.log(`Pixels where ALL 24 samples have sCoC >= centerCoC and bloom === 1.0:  ${allCoCGreaterNoBloomPixels} (${((allCoCGreaterNoBloomPixels/totalBlurredPixels)*100).toFixed(1)}%)`);

