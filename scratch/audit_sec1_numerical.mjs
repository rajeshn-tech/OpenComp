import fs from 'node:fs';
import path from 'node:path';
import { ZDefocusNode } from '../src/nodes/ZDefocusNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';
import { ImageIO } from '../src/core/ImageIO.js';

console.log('======================================================================');
console.log('🔬 AUDIT SECTION 1: NUMERICAL CORRECTNESS & STATISTICAL ERROR METRICS');
console.log('======================================================================\n');

// 1. Analytical Single-Threaded Reference (exact canonical mathematical definition)
function referenceZDefocus(inputBuf, depthBuf, focusPlane, dof, maxDefocus, aspect, bloom) {
  const w = inputBuf.width;
  const h = inputBuf.height;
  const pixelCount = w * h;
  const outBuf = new PixelBuffer(w, h);
  const outData = outBuf.data;
  const srcData = inputBuf.data;
  const depthData = depthBuf.data;

  const cocMap = new Float32Array(pixelCount);
  const halfDof = dof * 0.5;
  const normFactor = Math.max(0.01, 1.0 - halfDof);
  const invNormFactor = 1.0 / normFactor;

  for (let i = 0; i < pixelCount; i++) {
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
    bloomMap = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
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
      const p4 = centerIdx * 4;

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
          const bloomWeight = hasBloom ? bloomMap[sIdx] : 1.0;
          const w_s = cocWeight * bloomWeight;

          accR += srcData[sp4] * w_s;
          accG += srcData[sp4 + 1] * w_s;
          accB += srcData[sp4 + 2] * w_s;
          accA += srcData[sp4 + 3] * w_s;
          totalWeight += w_s;
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

function computeMetrics(parallelBuf, refBuf) {
  const len = parallelBuf.data.length;
  let maxAbsError = 0.0;
  let sumAbsError = 0.0;
  let sumSquaredError = 0.0;
  let diffCountExact = 0;
  let diffCountEpsilon = 0;
  let diffCountHigh = 0;
  let nanCount = 0;
  let infCount = 0;

  for (let i = 0; i < len; i++) {
    const p = parallelBuf.data[i];
    const r = refBuf.data[i];

    if (Number.isNaN(p)) nanCount++;
    if (!Number.isFinite(p)) infCount++;

    const delta = Math.abs(p - r);
    if (delta > maxAbsError) maxAbsError = delta;
    sumAbsError += delta;
    sumSquaredError += delta * delta;

    if (delta > 0.0) diffCountExact++;
    if (delta > 1.1920929e-7) diffCountEpsilon++;
    if (delta > 1e-4) diffCountHigh++;
  }

  const mae = sumAbsError / len;
  const rmse = Math.sqrt(sumSquaredError / len);

  return {
    len,
    maxAbsError,
    mae,
    rmse,
    diffCountExact,
    diffCountEpsilon,
    diffCountHigh,
    nanCount,
    infCount
  };
}

const testCases = [
  {
    name: '1080p Real VFX Plate (Full Graph Assets)',
    setup: () => {
      const bgPath = path.resolve('demo/vfx_showcase/source/bg_plate.0001.exr');
      const depthPath = path.resolve('demo/vfx_showcase/depth/depth_pass.0001.exr');
      return {
        img: ImageIO.readEXR(fs.readFileSync(bgPath)),
        depth: ImageIO.readEXR(fs.readFileSync(depthPath)),
        fp: 0.5, dof: 0.12, maxDefocus: 14.0, aspect: 1.0, bloom: 0.25
      };
    }
  },
  {
    name: 'Extreme HDR Specular Highlights (> 65,504.0)',
    setup: () => {
      const W = 1000, H = 600;
      const img = new PixelBuffer(W, H);
      const depth = new PixelBuffer(W, H);
      depth.data.fill(1.0);
      for (let y = 250; y < 350; y++) {
        for (let x = 450; x < 550; x++) {
          const idx = (y * W + x) * 4;
          img.data[idx] = 100000.0;
          img.data[idx + 1] = 80000.0;
          img.data[idx + 2] = 65536.0;
          img.data[idx + 3] = 1.0;
        }
      }
      return { img, depth, fp: 0.2, dof: 0.05, maxDefocus: 16.0, aspect: 1.0, bloom: 0.5 };
    }
  },
  {
    name: 'Negative Values & Deep Inverted Float Space',
    setup: () => {
      const W = 800, H = 800;
      const img = new PixelBuffer(W, H);
      const depth = new PixelBuffer(W, H);
      for (let i = 0; i < W * H * 4; i += 4) {
        img.data[i] = -0.5;
        img.data[i + 1] = -1.2;
        img.data[i + 2] = 0.5;
        img.data[i + 3] = 1.0;
        depth.data[i] = -0.2;
      }
      return { img, depth, fp: 0.5, dof: 0.1, maxDefocus: 8.0, aspect: 1.0, bloom: 0.0 };
    }
  },
  {
    name: 'Graded Variable Alpha & Transparent AOVs',
    setup: () => {
      const W = 900, H = 700;
      const img = new PixelBuffer(W, H);
      const depth = new PixelBuffer(W, H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4;
          img.data[idx] = x / W;
          img.data[idx + 1] = y / H;
          img.data[idx + 2] = 0.5;
          img.data[idx + 3] = (x + y) / (W + H); // Alpha varying from 0 to 1
          depth.data[idx] = y / H;
        }
      }
      return { img, depth, fp: 0.5, dof: 0.1, maxDefocus: 12.0, aspect: 1.0, bloom: 0.2 };
    }
  },
  {
    name: 'Anamorphic Bokeh Aspect Ratio (2.5:1 Oval Diffusion)',
    setup: () => {
      const W = 1024, H = 600;
      const img = new PixelBuffer(W, H);
      const depth = new PixelBuffer(W, H);
      depth.data.fill(0.9);
      img.data.fill(0.2);
      // Impress bright points
      for (let i = 0; i < 5; i++) {
        const px = 200 * (i + 1);
        const py = 300;
        const idx = (py * W + px) * 4;
        img.data[idx] = 10.0; img.data[idx + 1] = 10.0; img.data[idx + 2] = 10.0; img.data[idx + 3] = 1.0;
      }
      return { img, depth, fp: 0.1, dof: 0.05, maxDefocus: 20.0, aspect: 2.5, bloom: 0.4 };
    }
  },
  {
    name: 'Near vs Far Bilateral Optical Blur Continuity',
    setup: () => {
      const W = 1000, H = 800;
      const img = new PixelBuffer(W, H);
      const depth = new PixelBuffer(W, H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4;
          img.data[idx] = (x % 40 < 20) ? 0.8 : 0.2;
          img.data[idx + 1] = (y % 40 < 20) ? 0.8 : 0.2;
          img.data[idx + 2] = 0.5;
          img.data[idx + 3] = 1.0;
          depth.data[idx] = y / H; // Continuous gradient from 0 (near) to 1 (far)
        }
      }
      return { img, depth, fp: 0.5, dof: 0.1, maxDefocus: 15.0, aspect: 1.0, bloom: 0.1 };
    }
  }
];

const node = new ZDefocusNode('audit_node');

testCases.forEach((tc, idx) => {
  const { img, depth, fp, dof, maxDefocus, aspect, bloom } = tc.setup();
  node.setKnobValue('focusPlane', fp);
  node.setKnobValue('depthOfField', dof);
  node.setKnobValue('maxDefocus', maxDefocus);
  node.setKnobValue('aspectRatio', aspect);
  node.setKnobValue('bloom', bloom);

  // Parallel execution
  const outParallel = node.compute({ in: img, depth });

  // Single-threaded canonical reference
  const outRef = referenceZDefocus(img, depth, fp, dof, maxDefocus, aspect, bloom);

  const m = computeMetrics(outParallel, outRef);

  console.log(`Test Case ${idx + 1}: ${tc.name}`);
  console.log(`   Dimensions:     ${img.width}x${img.height} (${m.len} total floats)`);
  console.log(`   Max Abs Error:  ${m.maxAbsError.toExponential(4)}`);
  console.log(`   MAE:            ${m.mae.toExponential(4)}`);
  console.log(`   RMSE:           ${m.rmse.toExponential(4)}`);
  console.log(`   Exact Differ:   ${m.diffCountExact} / ${m.len} (${((m.diffCountExact / m.len) * 100).toFixed(2)}%)`);
  console.log(`   Diff > Epsilon: ${m.diffCountEpsilon} / ${m.len}`);
  console.log(`   Diff > 1e-4:    ${m.diffCountHigh} / ${m.len}`);
  console.log(`   NaNs / Infs:    ${m.nanCount} / ${m.infCount}\n`);
});

