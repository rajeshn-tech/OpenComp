import fs from 'fs';
import path from 'path';

const workspace = 'c:/Users/rajeshn/Desktop/Rajesh/OpenComp';
const { ImageIO } = await import('file:///' + path.join(workspace, 'src/core/ImageIO.js').replace(/\\/g, '/'));
const { PixelBuffer } = await import('file:///' + path.join(workspace, 'src/core/PixelBuffer.js').replace(/\\/g, '/'));

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

// Baseline implementation
function computeBaseline() {
  const outBuf = new PixelBuffer(w, h);
  const outData = outBuf.data;
  const srcData = inputBuf.data;
  const depthData = depthBuf.data;

  const cocMap = new Float32Array(w * h);
  const halfDof = dof * 0.5;
  const normFactor = Math.max(0.01, 1.0 - halfDof);
  const invNormFactor = 1.0 / normFactor;

  for (let i = 0; i < w * h; i++) {
    const z = depthData[i * 4];
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
      const luma = srcData[sp4] * 0.2126 + srcData[sp4 + 1] * 0.7152 + srcData[sp4 + 2] * 0.0722;
      bloomMap[i] = 1.0 + Math.max(0.0, luma - 0.7) * bloomFactor;
    }
  }

  const sampleShiftsX = new Int32Array(numSamples);
  const sampleShiftsY = new Int32Array(numSamples);
  const sampleLinearOffset = new Int32Array(numSamples);
  let lastCoC = -999.0;
  let maxShiftX = 0;
  let maxShiftY = 0;

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      const centerIdx = rowOffset + x;
      const centerCoC = cocMap[centerIdx];

      if (centerCoC < 0.5) {
        const p4 = centerIdx * 4;
        outData[p4]     = srcData[p4];
        outData[p4 + 1] = srcData[p4 + 1];
        outData[p4 + 2] = srcData[p4 + 2];
        outData[p4 + 3] = srcData[p4 + 3];
        continue;
      }

      if (centerCoC !== lastCoC) {
        lastCoC = centerCoC;
        maxShiftX = 0;
        maxShiftY = 0;
        for (let s = 0; s < numSamples; s++) {
          const sx = Math.round(offDX[s] * centerCoC);
          const sy = Math.round(offDY[s] * centerCoC);
          sampleShiftsX[s] = sx;
          sampleShiftsY[s] = sy;
          sampleLinearOffset[s] = sy * w + sx;
          const absX = Math.abs(sx);
          const absY = Math.abs(sy);
          if (absX > maxShiftX) maxShiftX = absX;
          if (absY > maxShiftY) maxShiftY = absY;
        }
      }

      const invCenterCoC = 1.0 / centerCoC;
      let accR = 0.0, accG = 0.0, accB = 0.0, accA = 0.0;
      let totalWeight = 0.0;

      const isInterior = (x >= maxShiftX && x < w - maxShiftX && y >= maxShiftY && y < h - maxShiftY);

      if (isInterior) {
        for (let s = 0; s < numSamples; s++) {
          const sIdx = centerIdx + sampleLinearOffset[s];
          const sCoC = cocMap[sIdx];
          const sp4 = sIdx * 4;

          const cocWeight = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, 1.0 - (centerCoC - sCoC) * invCenterCoC);
          const wFinal = hasBloom ? cocWeight * bloomMap[sIdx] : cocWeight;

          accR += srcData[sp4] * wFinal;
          accG += srcData[sp4 + 1] * wFinal;
          accB += srcData[sp4 + 2] * wFinal;
          accA += srcData[sp4 + 3] * wFinal;
          totalWeight += wFinal;
        }
      } else {
        for (let s = 0; s < numSamples; s++) {
          const sx = x + sampleShiftsX[s];
          const sy = y + sampleShiftsY[s];

          if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
            const sIdx = sy * w + sx;
            const sCoC = cocMap[sIdx];
            const sp4 = sIdx * 4;

            const cocWeight = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, 1.0 - (centerCoC - sCoC) * invCenterCoC);
            const wFinal = hasBloom ? cocWeight * bloomMap[sIdx] : cocWeight;

            accR += srcData[sp4] * wFinal;
            accG += srcData[sp4 + 1] * wFinal;
            accB += srcData[sp4 + 2] * wFinal;
            accA += srcData[sp4 + 3] * wFinal;
            totalWeight += wFinal;
          }
        }
      }

      const out4 = centerIdx * 4;
      if (totalWeight > 0.0) {
        const invTotal = 1.0 / totalWeight;
        outData[out4]     = accR * invTotal;
        outData[out4 + 1] = accG * invTotal;
        outData[out4 + 2] = accB * invTotal;
        outData[out4 + 3] = accA * invTotal;
      } else {
        outData[out4]     = srcData[out4];
        outData[out4 + 1] = srcData[out4 + 1];
        outData[out4 + 2] = srcData[out4 + 2];
        outData[out4 + 3] = srcData[out4 + 3];
      }
    }
  }
  return outBuf;
}

// Optimized Candidate 1: Math simplification + sampleLinearOffset4 + direct 4-wide indexing
function computeOpt1() {
  const outBuf = new PixelBuffer(w, h);
  const outData = outBuf.data;
  const srcData = inputBuf.data;
  const depthData = depthBuf.data;

  const cocMap = new Float32Array(w * h);
  const halfDof = dof * 0.5;
  const normFactor = Math.max(0.01, 1.0 - halfDof);
  const invNormFactor = 1.0 / normFactor;

  for (let i = 0; i < w * h; i++) {
    const z = depthData[i * 4];
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
      const luma = srcData[sp4] * 0.2126 + srcData[sp4 + 1] * 0.7152 + srcData[sp4 + 2] * 0.0722;
      bloomMap[i] = 1.0 + Math.max(0.0, luma - 0.7) * bloomFactor;
    }
  }

  const sampleShiftsX = new Int32Array(numSamples);
  const sampleShiftsY = new Int32Array(numSamples);
  const sampleLinearOffset = new Int32Array(numSamples);
  const sampleLinearOffset4 = new Int32Array(numSamples);
  let lastCoC = -999.0;
  let maxShiftX = 0;
  let maxShiftY = 0;

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      const centerIdx = rowOffset + x;
      const centerCoC = cocMap[centerIdx];
      const p4 = centerIdx << 2;

      if (centerCoC < 0.5) {
        outData[p4]     = srcData[p4];
        outData[p4 + 1] = srcData[p4 + 1];
        outData[p4 + 2] = srcData[p4 + 2];
        outData[p4 + 3] = srcData[p4 + 3];
        continue;
      }

      if (centerCoC !== lastCoC) {
        lastCoC = centerCoC;
        maxShiftX = 0;
        maxShiftY = 0;
        for (let s = 0; s < numSamples; s++) {
          const sx = Math.round(offDX[s] * centerCoC);
          const sy = Math.round(offDY[s] * centerCoC);
          sampleShiftsX[s] = sx;
          sampleShiftsY[s] = sy;
          const lin = sy * w + sx;
          sampleLinearOffset[s] = lin;
          sampleLinearOffset4[s] = lin << 2;
          const absX = Math.abs(sx);
          const absY = Math.abs(sy);
          if (absX > maxShiftX) maxShiftX = absX;
          if (absY > maxShiftY) maxShiftY = absY;
        }
      }

      const invCenterCoC = 1.0 / centerCoC;
      let accR = 0.0, accG = 0.0, accB = 0.0, accA = 0.0;
      let totalWeight = 0.0;

      const isInterior = (x >= maxShiftX && x < w - maxShiftX && y >= maxShiftY && y < h - maxShiftY);

      if (isInterior) {
        for (let s = 0; s < numSamples; s++) {
          const sIdx = centerIdx + sampleLinearOffset[s];
          const sCoC = cocMap[sIdx];
          const sp4 = p4 + sampleLinearOffset4[s];

          const cocWeight = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, sCoC * invCenterCoC);
          const wFinal = hasBloom ? cocWeight * bloomMap[sIdx] : cocWeight;

          accR += srcData[sp4] * wFinal;
          accG += srcData[sp4 + 1] * wFinal;
          accB += srcData[sp4 + 2] * wFinal;
          accA += srcData[sp4 + 3] * wFinal;
          totalWeight += wFinal;
        }
      } else {
        for (let s = 0; s < numSamples; s++) {
          const sx = x + sampleShiftsX[s];
          const sy = y + sampleShiftsY[s];

          if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
            const sIdx = sy * w + sx;
            const sCoC = cocMap[sIdx];
            const sp4 = sIdx << 2;

            const cocWeight = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, sCoC * invCenterCoC);
            const wFinal = hasBloom ? cocWeight * bloomMap[sIdx] : cocWeight;

            accR += srcData[sp4] * wFinal;
            accG += srcData[sp4 + 1] * wFinal;
            accB += srcData[sp4 + 2] * wFinal;
            accA += srcData[sp4 + 3] * wFinal;
            totalWeight += wFinal;
          }
        }
      }

      if (totalWeight > 0.0) {
        const invTotal = 1.0 / totalWeight;
        outData[p4]     = accR * invTotal;
        outData[p4 + 1] = accG * invTotal;
        outData[p4 + 2] = accB * invTotal;
        outData[p4 + 3] = accA * invTotal;
      } else {
        outData[p4]     = srcData[p4];
        outData[p4 + 1] = srcData[p4 + 1];
        outData[p4 + 2] = srcData[p4 + 2];
        outData[p4 + 3] = srcData[p4 + 3];
      }
    }
  }
  return outBuf;
}

// Compare numerical parity between Baseline and Opt1
console.log('Testing numerical parity between Baseline and Opt1:');
const ref = computeBaseline();
const opt = computeOpt1();

let maxDiff = 0;
let sumDiff = 0;
let sumSqDiff = 0;
const len = ref.data.length;

for (let i = 0; i < len; i++) {
  const diff = Math.abs(ref.data[i] - opt.data[i]);
  if (diff > maxDiff) maxDiff = diff;
  sumDiff += diff;
  sumSqDiff += diff * diff;
}

const mae = sumDiff / len;
const rmse = Math.sqrt(sumSqDiff / len);
console.log(`   - Max Diff: ${maxDiff.toExponential(4)}`);
console.log(`   - MAE:      ${mae.toExponential(4)}`);
console.log(`   - RMSE:     ${rmse.toExponential(4)}`);

// Benchmark comparison
console.log('\nRunning 5 timed iterations for Baseline vs Opt1:');
const baseTimes = [];
const optTimes = [];

for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  computeBaseline();
  baseTimes.push(performance.now() - t0);

  const t1 = performance.now();
  computeOpt1();
  optTimes.push(performance.now() - t1);
}

const avgBase = baseTimes.reduce((a, b) => a + b, 0) / 5;
const avgOpt = optTimes.reduce((a, b) => a + b, 0) / 5;

console.log(`   - Baseline Mean: ${avgBase.toFixed(2)} ms`);
console.log(`   - Opt1 Mean:     ${avgOpt.toFixed(2)} ms (${(avgBase / avgOpt).toFixed(2)}x speedup)`);

