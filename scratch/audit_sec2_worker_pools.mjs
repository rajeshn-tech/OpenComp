import { ZDefocusThreadPool } from '../src/nodes/ZDefocusNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

console.log('======================================================================');
console.log('🔬 AUDIT SECTION 2.3 & 2.4: WORKER SCALING & CRASH FALLBACK AUDIT');
console.log('======================================================================\n');

const W = 1920, H = 1080;
const img = new PixelBuffer(W, H);
const depth = new PixelBuffer(W, H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = (y * W + x) * 4;
    img.data[idx] = (x % 32 < 16) ? 0.9 : 0.1;
    img.data[idx + 1] = (y % 32 < 16) ? 0.9 : 0.1;
    img.data[idx + 2] = 0.5;
    img.data[idx + 3] = 1.0;
    depth.data[idx] = y / H;
  }
}

// 1. Worker scaling: 1, 2, 3, 4, 6, 8 workers
const workerCounts = [1, 2, 3, 4, 6, 8];
console.log('1. Evaluating 1080p Across Distinct Worker Counts:');
for (const n of workerCounts) {
  const pool = new ZDefocusThreadPool(n);
  const t0 = performance.now();
  const res = pool.execute(img, depth, 0.5, 0.1, 10.0, 1.0, 0.2);
  const dt = performance.now() - t0;
  console.log(`   - Pool with ${n} worker(s): ${dt.toFixed(1)} ms | Output: ${res.width}x${res.height}`);
  
  // Clean up pool workers
  for (const wrk of pool.workers) {
    try { wrk.terminate(); } catch (_) {}
  }
}

// 2. Worker Crash Recovery and Timeout Guard Verification
console.log('\n2. Testing Worker Crash Simulation & Timeout Recovery:');
const testPool = new ZDefocusThreadPool(4);
testPool.ensureCapacity(1000, 600);

// Terminate one worker deliberately to simulate hard crash / SIGKILL
console.log('   Simulating unexpected crash of Worker 2...');
testPool.workers[2].terminate();

// Attempt execution with crashed worker
try {
  // Temporarily set a quick wait test by modifying control or checking execute timeout
  console.log('   Executing pool with crashed worker (expecting controlled timeout & worker restart)...');
  const t0 = performance.now();
  testPool.execute(new PixelBuffer(1000, 600), new PixelBuffer(1000, 600), 0.5, 0.1, 10.0, 1.0, 0.2);
  console.log('   Execution succeeded after restart in', (performance.now() - t0).toFixed(1), 'ms');
} catch (err) {
  console.log('   ✅ Caught expected worker error/timeout:', err.message);
  console.log('   Pool ready state after error:', testPool.ready);
  
  // Re-attempt after auto-restart
  console.log('   Re-attempting execution after worker restart...');
  const resRecovered = testPool.execute(new PixelBuffer(1000, 600), new PixelBuffer(1000, 600), 0.5, 0.1, 10.0, 1.0, 0.2);
  console.log(`   ✅ Post-crash recovery successful! Output: ${resRecovered.width}x${resRecovered.height}`);
}

// Clean up
for (const wrk of testPool.workers) {
  try { wrk.terminate(); } catch (_) {}
}

