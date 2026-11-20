let WorkerClass = null;
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  try {
    const wt = await import('node:worker_threads');
    WorkerClass = wt.Worker;
  } catch (e) {
    WorkerClass = null;
  }
}
console.log('WorkerClass loaded:', !!WorkerClass);

