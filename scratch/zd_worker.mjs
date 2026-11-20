
import { parentPort, workerData } from 'worker_threads';

const { w, h, numSamples, offDX, offDY, hasBloom, sharedControl, sharedOut, sharedSrc, sharedCoC, sharedBloom } = workerData;

const control = new Int32Array(sharedControl);
const outData = new Float32Array(sharedOut);
const srcData = new Float32Array(sharedSrc);
const cocMap = new Float32Array(sharedCoC);
const bloomMap = hasBloom ? new Float32Array(sharedBloom) : null;

const workerIdx = workerData.workerIdx;
const statusIdx = workerIdx * 4; // status, startY, endY, command

// Signal ready
Atomics.store(control, statusIdx, 1);

const sampleShiftsX = new Int32Array(numSamples);
const sampleShiftsY = new Int32Array(numSamples);
const sampleLinearOffset = new Int32Array(numSamples);

while (true) {
  Atomics.wait(control, statusIdx + 3, 0); // wait for command !== 0
  const cmd = Atomics.load(control, statusIdx + 3);
  if (cmd === 0 || cmd === 2) break; // exit

  const startY = Atomics.load(control, statusIdx + 1);
  const endY = Atomics.load(control, statusIdx + 2);

  let lastCoC = -999.0;
  let maxShiftX = 0;
  let maxShiftY = 0;

  for (let y = startY; y < endY; y++) {
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
        if (!hasBloom) {
          for (let s = 0; s < numSamples; s++) {
            const sIdx = centerIdx + sampleLinearOffset[s];
            const sCoC = cocMap[sIdx];
            const sp4 = sIdx * 4;

            if (sCoC >= centerCoC) {
              accR += srcData[sp4];
              accG += srcData[sp4 + 1];
              accB += srcData[sp4 + 2];
              accA += srcData[sp4 + 3];
              totalWeight += 1.0;
            } else {
              const w_s = Math.max(0.1, 1.0 - (centerCoC - sCoC) * invCenterCoC);
              accR += srcData[sp4] * w_s;
              accG += srcData[sp4 + 1] * w_s;
              accB += srcData[sp4 + 2] * w_s;
              accA += srcData[sp4 + 3] * w_s;
              totalWeight += w_s;
            }
          }
        } else {
          for (let s = 0; s < numSamples; s++) {
            const sIdx = centerIdx + sampleLinearOffset[s];
            const sCoC = cocMap[sIdx];
            const sp4 = sIdx * 4;
            const b = bloomMap[sIdx];

            if (sCoC >= centerCoC && b === 1.0) {
              accR += srcData[sp4];
              accG += srcData[sp4 + 1];
              accB += srcData[sp4 + 2];
              accA += srcData[sp4 + 3];
              totalWeight += 1.0;
            } else {
              const cocW = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, 1.0 - (centerCoC - sCoC) * invCenterCoC);
              const w_s = cocW * b;
              accR += srcData[sp4] * w_s;
              accG += srcData[sp4 + 1] * w_s;
              accB += srcData[sp4 + 2] * w_s;
              accA += srcData[sp4 + 3] * w_s;
              totalWeight += w_s;
            }
          }
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

  // Done signal
  Atomics.store(control, statusIdx, 2);
  Atomics.store(control, statusIdx + 3, 0); // reset cmd
  Atomics.notify(control, statusIdx, 1);
}
