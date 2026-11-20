import fs from 'fs';

const LUT_SIZE = 65536;
const LUT_MAX = 4.0;
const LUT_SCALE = LUT_SIZE / LUT_MAX;
const LUT_INV_SCALE = LUT_MAX / LUT_SIZE;

function checkMaxErr(gamma) {
  const invGamma = 1.0 / gamma;
  const lut = new Float32Array(LUT_SIZE + 1);
  const lutDelta = new Float32Array(LUT_SIZE + 1);
  for (let i = 0; i <= LUT_SIZE; i++) lut[i] = Math.pow(i * LUT_INV_SCALE, invGamma);
  for (let i = 0; i < LUT_SIZE; i++) lutDelta[i] = lut[i + 1] - lut[i];
  lutDelta[LUT_SIZE] = 0;

  let maxDiff = 0;
  let worstV = 0;
  // Test 100,000 points between 0 and 4.0
  for (let step = 0; step < 100000; step++) {
    const v = (step / 100000) * 4.0;
    if (v <= 0) continue;
    let approx;
    if (v < 0.0005 && invGamma < 1.0) {
      approx = Math.pow(v, invGamma);
    } else {
      const idxF = v * LUT_SCALE;
      const idx = idxF | 0;
      approx = lut[idx] + (idxF - idx) * lutDelta[idx];
    }
    const exact = Math.pow(v, invGamma);
    const diff = Math.abs(approx - exact);
    if (diff > maxDiff) {
      maxDiff = diff;
      worstV = v;
    }
  }
  console.log(`Gamma ${gamma}: MaxDiff = ${maxDiff.toExponential(4)} at v = ${worstV}`);
}

checkMaxErr(1.5);
checkMaxErr(2.2);
checkMaxErr(4.0);

