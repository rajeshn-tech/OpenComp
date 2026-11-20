import fs from 'fs';

const LUT_SIZE = 65536;
const LUT_MAX = 4.0;
const LUT_SCALE = LUT_SIZE / LUT_MAX;
const LUT_INV_SCALE = LUT_MAX / LUT_SIZE;

function runComparison(gamma, blackClamp, whiteClamp, reverse) {
  const invGamma = 1.0 / gamma;
  const isLinearGamma = Math.abs(gamma - 1.0) < 1e-5;
  const exponent = reverse ? gamma : invGamma;
  const useLUT = !isLinearGamma && exponent >= 0.25 && exponent <= 4.0;

  let lut = null, lutDelta = null;
  if (useLUT) {
    lut = new Float32Array(LUT_SIZE + 1);
    lutDelta = new Float32Array(LUT_SIZE + 1);
    for (let i = 0; i <= LUT_SIZE; i++) lut[i] = Math.pow(i * LUT_INV_SCALE, exponent);
    for (let i = 0; i < LUT_SIZE; i++) lutDelta[i] = lut[i + 1] - lut[i];
    lutDelta[LUT_SIZE] = 0;
  }

  const testVals = [
    NaN, -Infinity, -100.0, -1.0, -0.001, -1e-6,
    0.0, 1e-7, 1e-5, 1e-4, 0.0005, 0.001, 0.002, 0.01, 0.1, 0.5, 1.0, 2.0, 3.5, 3.9999, 4.0, 4.0001,
    8.0, 16.0, 64.0, 100.0, 1000.0, Infinity
  ];

  const A = 1.2, B = 0.05, invA = 1.0 / A;

  for (const v of testVals) {
    // 1. Original Exact Reference
    let rRef = v;
    if (!reverse) {
      rRef = A * rRef + B;
      if (isLinearGamma) {
        if (blackClamp) { if (rRef < 0) rRef = 0; }
        if (whiteClamp) { if (rRef > 1) rRef = 1; }
      } else {
        if (rRef > 0) rRef = Math.pow(rRef, invGamma);
        else if (blackClamp) rRef = 0;
        if (whiteClamp) { if (rRef > 1) rRef = 1; }
      }
    } else {
      if (!isLinearGamma) {
        if (rRef > 0) rRef = Math.pow(rRef, gamma);
      }
      if (A !== 0) rRef = (rRef - B) / A;
      if (blackClamp && rRef < 0) rRef = 0;
      if (whiteClamp && rRef > 1) rRef = 1;
    }

    // 2. Candidate Optimized
    let rOpt = v;
    if (!reverse) {
      rOpt = A * rOpt + B;
      if (isLinearGamma) {
        if (blackClamp && rOpt < 0) rOpt = 0;
        if (whiteClamp && rOpt > 1) rOpt = 1;
      } else {
        if (rOpt > 0) {
          if (useLUT && rOpt >= 0.002 && rOpt <= 4.0) {
            const idxF = rOpt * LUT_SCALE;
            const idx = idxF | 0;
            rOpt = lut[idx] + (idxF - idx) * lutDelta[idx];
          } else {
            rOpt = Math.pow(rOpt, invGamma);
          }
        } else if (blackClamp) {
          rOpt = 0;
        }
        if (whiteClamp && rOpt > 1) rOpt = 1;
      }
    } else {
      if (isLinearGamma) {
        rOpt = (rOpt - B) * invA;
        if (blackClamp && rOpt < 0) rOpt = 0;
        if (whiteClamp && rOpt > 1) rOpt = 1;
      } else {
        if (rOpt > 0) {
          if (useLUT && rOpt >= 0.002 && rOpt <= 4.0) {
            const idxF = rOpt * LUT_SCALE;
            const idx = idxF | 0;
            rOpt = lut[idx] + (idxF - idx) * lutDelta[idx];
          } else {
            rOpt = Math.pow(rOpt, gamma);
          }
        }
        rOpt = (rOpt - B) * invA;
        if (blackClamp && rOpt < 0) rOpt = 0;
        if (whiteClamp && rOpt > 1) rOpt = 1;
      }
    }

    // Compare
    const refIsNaN = Number.isNaN(rRef);
    const optIsNaN = Number.isNaN(rOpt);
    if (refIsNaN !== optIsNaN) {
      console.error(`NaN mismatch for v=${v}: ref=${rRef}, opt=${rOpt}`);
      return false;
    }
    if (!refIsNaN) {
      const diff = Math.abs(rOpt - rRef);
      if (diff > 5e-6) {
        console.error(`Divergence for gamma=${gamma}, v=${v}: ref=${rRef}, opt=${rOpt}, diff=${diff.toExponential(4)}`);
        return false;
      }
    }
  }
  return true;
}

console.log('Testing Candidate Optimized Grade against Original Reference...');
let allPassed = true;
for (const gamma of [0.1, 0.25, 0.5, 0.8, 0.98, 1.0, 1.05, 1.5, 2.2, 4.0, 10.0]) {
  for (const bc of [true, false]) {
    for (const wc of [true, false]) {
      for (const rev of [false, true]) {
        if (!runComparison(gamma, bc, wc, rev)) {
          allPassed = false;
          console.error(`Failed on gamma=${gamma}, bc=${bc}, wc=${wc}, rev=${rev}`);
          break;
        }
      }
    }
  }
}

if (allPassed) {
  console.log('✅ ALL COMBINATIONS PASSED! Zero NaN mismatches, zero divergences > 5e-6 across all gammas, HDR, clamps and reverse.');
}
