import { Worker } from 'worker_threads';

const workerCode = `
import { parentPort, workerData } from 'worker_threads';
const { control } = workerData;
const arr = new Int32Array(control);
arr[0] = 42;
`;

const control = new SharedArrayBuffer(16);
const arr = new Int32Array(control);
const w = new Worker(workerCode, {
  eval: true,
  workerData: { control }
});

while (arr[0] !== 42) {
  // wait
}
console.log('Eval worker succeeded! arr[0] =', arr[0]);
await w.terminate();

