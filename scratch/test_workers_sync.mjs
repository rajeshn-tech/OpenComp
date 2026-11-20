import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

if (isMainThread) {
  console.log('Main thread testing SharedArrayBuffer and Atomics.wait...');
  const sharedBuf = new SharedArrayBuffer(1024);
  const statusArray = new Int32Array(sharedBuf, 0, 4);

  // statusArray[0] = worker state (0 = idle, 1 = working, 2 = done)
  // statusArray[1] = main command (0 = stop, 1 = run)
  
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { sharedBuf }
  });

  // Wait for worker to be ready
  while (Atomics.load(statusArray, 0) !== 1) {
    // spin wait a microsecond
  }

  console.log('Worker is ready. Dispatching task synchronously...');
  const t0 = performance.now();
  Atomics.store(statusArray, 1, 1); // trigger run
  Atomics.notify(statusArray, 1, 1);

  // Wait for worker to finish
  Atomics.wait(statusArray, 0, 1); // wait while statusArray[0] === 1
  const dt = performance.now() - t0;
  console.log(`Worker completed synchronously in ${dt.toFixed(3)} ms! Result: status=${statusArray[0]}`);

  // Terminate worker
  Atomics.store(statusArray, 1, 0); // stop
  Atomics.notify(statusArray, 1, 1);
  await worker.terminate();
  console.log('Test complete!');
} else {
  const { sharedBuf } = workerData;
  const statusArray = new Int32Array(sharedBuf, 0, 4);

  Atomics.store(statusArray, 0, 1); // ready
  
  while (true) {
    Atomics.wait(statusArray, 1, 0); // wait for command !== 0
    const cmd = Atomics.load(statusArray, 1);
    if (cmd === 0) break; // exit

    // Do dummy work
    let sum = 0;
    for (let i = 0; i < 1000000; i++) sum += i;

    // Signal done
    Atomics.store(statusArray, 0, 2);
    Atomics.store(statusArray, 1, 0);
    Atomics.notify(statusArray, 0, 1);
  }
}

