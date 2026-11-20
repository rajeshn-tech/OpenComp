import { Worker } from 'node:worker_threads';

const code = `
const { workerData } = require('node:worker_threads');
const sab = new Int32Array(workerData);
while(true) {
  Atomics.wait(sab, 0, 0);
}
`;

const sab = new SharedArrayBuffer(4);
const wrk = new Worker(code, { eval: true, workerData: sab });
wrk.on('error', () => {});
wrk.unref();

console.log('Testing with wrk.unref() after wrk.on...');

