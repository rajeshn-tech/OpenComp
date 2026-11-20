import { spawnSync } from 'node:child_process';
import { ZDefocusNode } from '../src/nodes/ZDefocusNode.js';
import { PixelBuffer } from '../src/core/PixelBuffer.js';

console.log('======================================================================');
console.log('🔬 AUDIT SECTION 3: LIFECYCLE, RESOURCE USAGE & LEAK AUDIT');
console.log('======================================================================\n');

// 1. Process Exit Test: Verify wrk.unref() allows Node to terminate naturally without process.exit()
console.log('▶ [Test 3.1] Verifying natural process termination (wrk.unref behavior)...');
const t0 = performance.now();
const proc = spawnSync('node', ['scratch/test_unref_node.mjs'], {
  timeout: 10000,
  encoding: 'utf8'
});
const dt = performance.now() - t0;

if (proc.status === 0) {
  console.log(`   ✅ Process exited cleanly in ${dt.toFixed(1)} ms. stdout: "${proc.stdout.trim()}"`);
} else {
  console.log('   ❌ Process timed out or failed to exit! stderr:', proc.stderr);
}

// 2. Memory Growth & Leak Test: 100 Consecutive Evaluations
console.log('\n▶ [Test 3.2] Memory stability across 100 evaluations (detecting SAB / Worker leaks)...');
const W = 1000, H = 600;
const img = new PixelBuffer(W, H);
const depth = new PixelBuffer(W, H);
depth.data.fill(0.7);
img.data.fill(0.3);

const node = new ZDefocusNode('leak_test');
// Warmup
node.compute({ in: img, depth });
if (global.gc) global.gc();

const initialMem = process.memoryUsage();
console.log(`   Initial RSS:       ${(initialMem.rss / 1024 / 1024).toFixed(2)} MB`);
console.log(`   Initial Heap:      ${(initialMem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
console.log(`   Initial ArrayBuf:  ${(initialMem.external / 1024 / 1024).toFixed(2)} MB`);

for (let i = 1; i <= 100; i++) {
  node.setKnobValue('focusPlane', 0.1 + (i % 8) * 0.1);
  node.compute({ in: img, depth });
}

if (global.gc) global.gc();
const finalMem = process.memoryUsage();
const rssDelta = (finalMem.rss - initialMem.rss) / (1024 * 1024);
const heapDelta = (finalMem.heapUsed - initialMem.heapUsed) / (1024 * 1024);
const extDelta = (finalMem.external - initialMem.external) / (1024 * 1024);

console.log(`   Final RSS:         ${(finalMem.rss / 1024 / 1024).toFixed(2)} MB (Delta: ${rssDelta >= 0 ? '+' : ''}${rssDelta.toFixed(2)} MB)`);
console.log(`   Final Heap:        ${(finalMem.heapUsed / 1024 / 1024).toFixed(2)} MB (Delta: ${heapDelta >= 0 ? '+' : ''}${heapDelta.toFixed(2)} MB)`);
console.log(`   Final ArrayBuf:    ${(finalMem.external / 1024 / 1024).toFixed(2)} MB (Delta: ${extDelta >= 0 ? '+' : ''}${extDelta.toFixed(2)} MB)`);

// 3. Application Startup Overhead Test (with vs without ZDefocus import)
console.log('\n▶ [Test 3.3] Startup overhead measurement (with vs without ZDefocus import)...');
const runsWithout = [];
for (let i = 0; i < 5; i++) {
  const s0 = performance.now();
  spawnSync('node', ['-e', "console.log('bare');"], { encoding: 'utf8' });
  runsWithout.push(performance.now() - s0);
}

const runsWith = [];
for (let i = 0; i < 5; i++) {
  const s0 = performance.now();
  spawnSync('node', ['scratch/test_import_zd.mjs'], { encoding: 'utf8' });
  runsWith.push(performance.now() - s0);
}

const avgWithout = runsWithout.reduce((a, b) => a + b, 0) / 5;
const avgWith = runsWith.reduce((a, b) => a + b, 0) / 5;
console.log(`   Startup without ZDefocus: ${avgWithout.toFixed(1)} ms`);
console.log(`   Startup with ZDefocus:    ${avgWith.toFixed(1)} ms`);
console.log(`   Overhead of ZDefocus:     ${(avgWith - avgWithout).toFixed(1)} ms`);
