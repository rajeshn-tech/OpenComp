import fs from 'fs';

const maskValues = [0.0, 0.0001, 0.5, 0.9999, 1.0];
const origVal = 0.5;
const gradedVal = 1.0;

for (const m of maskValues) {
  // Original formula
  const invM = 1.0 - m;
  const ref = origVal * invM + gradedVal * m;

  // Optimized logic
  let opt;
  if (m <= 0) opt = origVal;
  else if (m >= 1.0) opt = gradedVal;
  else opt = origVal + (gradedVal - origVal) * m;

  const diff = Math.abs(opt - ref);
  console.log(`Mask ${m.toString().padEnd(7)} | Ref: ${ref.toFixed(8)} | Opt: ${opt.toFixed(8)} | Diff: ${diff.toExponential(4)}`);
}

