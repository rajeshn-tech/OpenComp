import fs from 'fs';

const gammas = [0.1, 0.25, 0.5, 0.8, 0.98, 1.0, 1.05, 1.5, 2.2, 4.0, 10.0];
const testValues = [
  -100.0, -10.0, -1.0, -0.1, -1e-5,
  0.0, 1e-7, 1e-5, 1e-4, 0.00019, 0.0002, 0.001, 0.002, 0.005, 0.01,
  0.05, 0.1, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 3.5, 3.9, 3.99,
  3.9999, 3.99999, 4.0, 4.00001, 4.0001, 4.01, 4.5,
  8.0, 16.0, 64.0, 100.0, 1000.0
];

const LUT_SIZE = 65536;
const LUT_MAX = 4.0;
const LUT_SCALE = LUT_SIZE / LUT_MAX;
const LUT_INV_SCALE = LUT_MAX / LUT_SIZE;

for (const gamma of gammas) {
  const invGamma = 1.0 / gamma;
  const exponent = invGamma;
  const useLUT = exponent >= 0.25 && exponent <= 4.0;

  let lut = null, lutDelta = null;
  if (useLUT) {
    lut = new Float32Array(LUT_SIZE + 1);
    lutDelta = new Float32Array(LUT_SIZE + 1);
    for (let i = 0; i <= LUT_SIZE; i++) lut[i] = Math.pow(i * LUT_INV_SCALE, exponent);
    for (let i = 0; i < LUT_SIZE; i++) lutDelta[i] = lut[i + 1] - lut[i];
    lutDelta[LUT_SIZE] = 0;
  }

  let maxDiff = 0;
  for (const v of testValues) {
    let exact = 0;
    if (v > 0) exact = Math.pow(v, exponent);

    let approx = 0;
    if (v <= 0) {
      approx = 0;
    } else if (!useLUT || (v < 0.002 && exponent < 1.0) || v > 4.0) {
      approx = Math.pow(v, exponent);
    } else {
      const idxF = v * LUT_SCALE;
      const idx = idxF | 0;
      approx = lut[idx] + (idxF - idx) * lutDelta[idx];
    }

    const diff = Math.abs(approx - exact);
    if (diff > maxDiff) maxDiff = diff;
  }

  console.log(`Gamma: ${gamma.toString().padEnd(5)} | Exponent: ${exponent.toFixed(4).padEnd(8)} | UseLUT: ${useLUT} | Max Error: ${maxDiff.toExponential(4)}`);
}

