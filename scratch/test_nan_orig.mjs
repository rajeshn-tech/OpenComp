import fs from 'fs';

function originalTest(srcVal, blackClamp, whiteClamp, gamma) {
  const invGamma = 1.0 / gamma;
  let r = 1.0 * srcVal + 0.0;
  if (r > 0) r = Math.pow(r, invGamma);
  else if (blackClamp) r = 0;
  if (whiteClamp && r > 1) r = 1;
  return r;
}

console.log('Original behavior with special float values:');
for (const bc of [true, false]) {
  console.log(`\nblackClamp = ${bc}:`);
  for (const v of [NaN, -Infinity, Infinity]) {
    console.log(`  Input: ${v.toString().padEnd(10)} -> Output: ${originalTest(v, bc, false, 2.2)}`);
  }
}

