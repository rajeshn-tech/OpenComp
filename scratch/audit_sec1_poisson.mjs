const numSamples = 24;
const goldenAngle = 2.39996323;

const refX = new Float32Array(numSamples);
const refY = new Float32Array(numSamples);
const workerX = new Float32Array(numSamples);
const workerY = new Float32Array(numSamples);

for (let i = 0; i < numSamples; i++) {
  const r = Math.sqrt((i + 0.5) / numSamples);
  const theta = i * goldenAngle;
  refX[i] = r * Math.cos(theta);
  refY[i] = r * Math.sin(theta);
  workerX[i] = r * Math.cos(theta);
  workerY[i] = r * Math.sin(theta);
}

let sampleDiffs = 0;
for (let i = 0; i < numSamples; i++) {
  if (refX[i] !== workerX[i] || refY[i] !== workerY[i]) {
    sampleDiffs++;
  }
}
console.log('Poisson 24-sample position differences:', sampleDiffs);
console.log('Sample 0:', refX[0], refY[0]);
console.log('Sample 23:', refX[23], refY[23]);

