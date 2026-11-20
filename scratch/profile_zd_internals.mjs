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

console.log('======================================================================');
console.log('🔬 STEP 2: PROFILING ZDEFOCUS INTERNALS (1080p)');
console.log('======================================================================\n');

function profileZDefocusRun() {
  const timings = {
    bufferAlloc: 0,
    cocMapCalc: 0,
    bloomMapCalc: 0,
    poissonTableCalc: 0,
    mainLoopTotal: 0,
    inFocusPass: 0,
    shiftUpdates: 0,
    interiorConvolution: 0,
    boundaryConvolution: 0,
    outputWrite: 0,
    copyChannels: 0,
    total: 0
  };

  const tStart = performance.now();

  // 1. Buffer Alloc
  let t0 = performance.now();
  const outBuf = new PixelBuffer(w, h);
  const outData = outBuf.data;
  const srcData = inputBuf.data;
  const depthData = depthBuf.data;
  timings.bufferAlloc = performance.now() - t0;

  // 2. CoC Map
  t0 = performance.now();
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
  timings.cocMapCalc = performance.now() - t0;

  // 3. Poisson table
  t0 = performance.now();
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
  timings.poissonTableCalc = performance.now() - t0;

  // 4. Bloom map
  t0 = performance.now();
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
  timings.bloomMapCalc = performance.now() - t0;

  // 5. Main loop
  t0 = performance.now();
  const sampleShiftsX = new Int32Array(numSamples);
  const sampleShiftsY = new Int32Array(numSamples);
  const sampleLinearOffset = new Int32Array(numSamples);
  let lastCoC = -999.0;
  let maxShiftX = 0;
  let maxShiftY = 0;

  let inFocusCount = 0;
  let interiorCount = 0;
  let boundaryCount = 0;
  let shiftUpdateCount = 0;

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      const centerIdx = rowOffset + x;
      const centerCoC = cocMap[centerIdx];

      if (centerCoC < 0.5) {
        inFocusCount++;
        const p4 = centerIdx * 4;
        outData[p4]     = srcData[p4];
        outData[p4 + 1] = srcData[p4 + 1];
        outData[p4 + 2] = srcData[p4 + 2];
        outData[p4 + 3] = srcData[p4 + 3];
        continue;
      }

      if (centerCoC !== lastCoC) {
        shiftUpdateCount++;
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
        interiorCount++;
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
        boundaryCount++;
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
  timings.mainLoopTotal = performance.now() - t0;

  // 6. Copy channels
  t0 = performance.now();
  outBuf.copyChannelsFrom(inputBuf);
  timings.copyChannels = performance.now() - t0;

  timings.total = performance.now() - tStart;

  return {
    timings,
    counts: { inFocusCount, interiorCount, boundaryCount, shiftUpdateCount, totalPixels: w * h }
  };
}

// Warmup
profileZDefocusRun();

// 5 runs
const allRuns = [];
for (let i = 0; i < 5; i++) {
  allRuns.push(profileZDefocusRun());
}

console.log('Component Breakdown (Averaged across 5 runs):');
const keys = Object.keys(allRuns[0].timings);
for (const k of keys) {
  const mean = allRuns.reduce((sum, r) => sum + r.timings[k], 0) / allRuns.length;
  const pct = (mean / (allRuns.reduce((sum, r) => sum + r.timings.total, 0) / allRuns.length)) * 100;
  console.log(`   - ${k.padEnd(20)}: ${mean.toFixed(2).padStart(8)} ms (${pct.toFixed(1).padStart(5)}%)`);
}

const c = allRuns[0].counts;
console.log('\nPixel Classification:');
console.log(`   - Total Pixels:        ${c.totalPixels} (100.0%)`);
console.log(`   - In-Focus (<0.5 CoC): ${c.inFocusCount} (${((c.inFocusCount / c.totalPixels)*100).toFixed(1)}%)`);
console.log(`   - Interior Blurred:    ${c.interiorCount} (${((c.interiorCount / c.totalPixels)*100).toFixed(1)}%)`);
console.log(`   - Boundary Blurred:    ${c.boundaryCount} (${((c.boundaryCount / c.totalPixels)*100).toFixed(1)}%)`);
console.log(`   - CoC Shift Updates:   ${c.shiftUpdateCount}`);

