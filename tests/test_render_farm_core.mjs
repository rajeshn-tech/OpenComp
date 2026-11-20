/**
 * OpenComp - Test Suite 54: Render Farm Core & Native LAN Dispatcher
 * Validates worker discovery, capability reporting, heartbeat & timeout,
 * job submission, validation, chunking, priority dispatch, retry, resume,
 * cancellation, output integrity, and multi-worker execution parity.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  JobState,
  TaskState,
  WorkerState,
  validateAuthToken,
  validateJobDefinition,
  verifyOutputIntegrity,
  formatFrameRange
} from '../src/core/farm/FarmProtocol.js';

import {
  RenderTask,
  RenderJob,
  JobQueue
} from '../src/core/farm/JobQueue.js';

import { Worker } from '../src/core/farm/Worker.js';
import { LANDispatcher } from '../src/core/farm/LANDispatcher.js';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';

const tempDir = path.join(os.tmpdir(), `opencomp_farm_test_${Date.now()}`);
fs.mkdirSync(tempDir, { recursive: true });

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ Farm Core: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: Farm Core: ${name}`);
    console.error(err);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ Farm Core: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: Farm Core: ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_render_farm_core.mjs');
console.log('----------------------------------------------------');

// Helper to create synthetic OpenComp project file
function createTestProject(filePath) {
  const g = new Graph();
  const r = createNode('Read', 'Read1');
  r.setKnobValue('sourceType', 'ramp');
  r.setKnobValue('format', '64x64');
  const inv = createNode('Invert', 'Invert1');
  const wr = createNode('Write', 'Write1');
  wr.setKnobValue('fileType', 'image/exr');
  g.addNode(r);
  g.addNode(inv);
  g.addNode(wr);
  g.connect('Read1', 'out', 'Invert1', 'in');
  g.connect('Invert1', 'out', 'Write1', 'in');
  fs.writeFileSync(filePath, JSON.stringify(g.serialize()));
  return filePath;
}

const sampleProject = createTestProject(path.join(tempDir, 'sample_scene.opencomp'));

// 1. Worker Capabilities & CPU-First Reporting
runTest('Worker Identity & Capability Reporting (CPU-First + Optional GPU)', () => {
  // Pure CPU worker (no dedicated GPU)
  const cpuWorker = new Worker({
    name: 'Blade-CPU-01',
    gpuDevice: null,
    vramBytes: null
  });

  const cpuCaps = cpuWorker.getCapabilities();
  assert.equal(cpuCaps.name, 'Blade-CPU-01');
  assert.ok(cpuCaps.cpuCores > 0, 'CPU cores count must be > 0');
  assert.ok(cpuCaps.ramTotal > 0, 'RAM total must be > 0');
  assert.ok(cpuCaps.ramFree > 0, 'RAM free must be > 0');
  assert.equal(cpuCaps.gpuDevice, null, 'CPU worker must report null GPU device');
  assert.equal(cpuCaps.vramBytes, null, 'CPU worker must report null VRAM');
  assert.equal(cpuCaps.osPlatform, process.platform);
  assert.equal(cpuCaps.runtimeVersion, process.version);
  assert.equal(cpuCaps.state, WorkerState.IDLE);

  // Hybrid worker with GPU metadata
  const gpuWorker = new Worker({
    name: 'Blade-GPU-02',
    gpuDevice: 'NVIDIA RTX 4090',
    vramBytes: 24 * 1024 * 1024 * 1024
  });

  const gpuCaps = gpuWorker.getCapabilities();
  assert.equal(gpuCaps.name, 'Blade-GPU-02');
  assert.equal(gpuCaps.gpuDevice, 'NVIDIA RTX 4090');
  assert.equal(gpuCaps.vramBytes, 25769803776);
});

// 2. Local Network Security & Authentication
runTest('LAN Authentication & Token Verification', () => {
  const secret = 'VFX_STUDIO_AUTH_TOKEN_9988';

  // Disabled auth allows any request
  assert.equal(validateAuthToken({}, null), true);

  // Missing header with active secret
  assert.equal(validateAuthToken({}, secret), false);

  // Invalid secret
  assert.equal(validateAuthToken({ 'x-opencomp-auth': 'WRONG_SECRET' }, secret), false);

  // Valid secret via custom header
  assert.equal(validateAuthToken({ 'x-opencomp-auth': secret }, secret), true);

  // Valid secret via Bearer Authorization header
  assert.equal(validateAuthToken({ 'authorization': `Bearer ${secret}` }, secret), true);
});

// 3. Job Definition Validation
runTest('Job Submission Validation & Safe Path Rejection', () => {
  // Empty / Null
  assert.equal(validateJobDefinition(null).valid, false);

  // Missing name
  const noName = validateJobDefinition({ projectPath: sampleProject, frames: '1-10' });
  assert.equal(noName.valid, false);
  assert.ok(noName.errors.some(e => e.includes('Job name is required')));

  // Non-existent project
  const badProj = validateJobDefinition({ name: 'Job1', projectPath: '/non/existent/path.nk', frames: '1-10' });
  assert.equal(badProj.valid, false);
  assert.ok(badProj.errors.some(e => e.includes('Project file does not exist')));

  // Invalid chunk size
  const badChunk = validateJobDefinition({ name: 'Job1', projectPath: sampleProject, frames: '1-10', chunkSize: 0 });
  assert.equal(badChunk.valid, false);
  assert.ok(badChunk.errors.some(e => e.includes('chunkSize must be a positive integer')));

  // Valid definition
  const ok = validateJobDefinition({ name: 'ValidJob', projectPath: sampleProject, frames: '1001-1010', chunkSize: 5 });
  assert.equal(ok.valid, true);
  assert.equal(ok.errors.length, 0);
});

// 4. Frame Range Splitting & Task Generation
runTest('Frame Range Splitting & Chunk Partitioning', () => {
  const job = new RenderJob({
    name: 'ChunkTestJob',
    projectPath: sampleProject,
    frames: [1001, 1002, 1003, 1004, 1005, 1006, 1007],
    chunkSize: 2
  });

  assert.equal(job.tasks.size, 4, '7 frames with chunk size 2 must produce 4 tasks');
  const tasks = Array.from(job.tasks.values());

  assert.deepEqual(tasks[0].frames, [1001, 1002]);
  assert.deepEqual(tasks[1].frames, [1003, 1004]);
  assert.deepEqual(tasks[2].frames, [1005, 1006]);
  assert.deepEqual(tasks[3].frames, [1007]);

  for (const t of tasks) {
    assert.equal(t.state, TaskState.PENDING);
    assert.equal(t.attempts, 0);
  }
});

// 5. Duplicate Job Prevention
runTest('Duplicate Job Submission Prevention', () => {
  const queue = new JobQueue({ preventDuplicates: true });

  const jobDef = {
    name: 'Comp_VFX_Shot01',
    projectPath: sampleProject,
    frames: '1-5'
  };

  const job1 = queue.submitJob(jobDef);
  assert.ok(job1.id);

  // Submitting identical active job name + project must throw DuplicateJobError
  assert.throws(() => {
    queue.submitJob(jobDef);
  }, /DuplicateJobError/);
});

// 6. Priority-Based Scheduling & Worker Assignment
runTest('Priority Scheduling Order', () => {
  const queue = new JobQueue();

  const lowPrio = queue.submitJob({
    name: 'LowPriorityBackground',
    projectPath: sampleProject,
    frames: '1-2',
    priority: 10
  });

  const highPrio = queue.submitJob({
    name: 'HighPriorityDirectorReview',
    projectPath: sampleProject,
    frames: '1-2',
    priority: 90
  });

  // Next pending task must come from high priority job
  const next = queue.getNextPendingTask();
  assert.ok(next);
  assert.equal(next.job.id, highPrio.id, 'High priority job tasks must be dispatched first');
  assert.equal(next.task.state, TaskState.ASSIGNED);
  assert.equal(next.job.state, JobState.RUNNING);
});

// 7. Job Cancellation & State Propagation
runTest('Job Cancellation & Task State Propagation', () => {
  const queue = new JobQueue();
  const job = queue.submitJob({
    name: 'JobToCancel',
    projectPath: sampleProject,
    frames: '1-10',
    chunkSize: 2
  });

  assert.equal(job.state, JobState.QUEUED);
  const cancelled = queue.cancelJob(job.id, 'User clicked stop');
  assert.equal(cancelled, true);

  const updated = queue.getJob(job.id);
  assert.equal(updated.state, JobState.CANCELLED);
  for (const t of updated.tasks.values()) {
    assert.equal(t.state, TaskState.CANCELLED);
  }
});

// 8. Automated Task Failure Retry & Threshold
runTest('Automated Task Failure & Retry Limit', () => {
  const queue = new JobQueue();
  const job = queue.submitJob({
    name: 'RetryTestJob',
    projectPath: sampleProject,
    frames: '1-2',
    maxRetries: 3
  });

  const next = queue.getNextPendingTask();
  const taskId = next.task.id;
  queue.markTaskStarted(taskId, 'Worker-Fail-01');

  // Attempt 1 Failure -> Requeued as PENDING
  const r1 = queue.markTaskFailed(taskId, 'Simulated Node crash 1');
  assert.equal(r1.retried, true);
  assert.equal(r1.task.state, TaskState.PENDING);
  assert.equal(r1.task.attempts, 1);

  // Attempt 2 Failure -> Requeued as PENDING
  queue.markTaskStarted(taskId, 'Worker-Fail-02');
  const r2 = queue.markTaskFailed(taskId, 'Simulated Node crash 2');
  assert.equal(r2.retried, true);
  assert.equal(r2.task.state, TaskState.PENDING);
  assert.equal(r2.task.attempts, 2);

  // Attempt 3 Failure -> Exceeded maxRetries -> FAILED
  queue.markTaskStarted(taskId, 'Worker-Fail-03');
  const r3 = queue.markTaskFailed(taskId, 'Simulated Node crash 3');
  assert.equal(r3.retried, false);
  assert.equal(r3.task.state, TaskState.FAILED);
  assert.equal(r3.task.attempts, 3);
  assert.equal(job.state, JobState.FAILED);
});

// 9. Job Resumption of Unrendered Frames
runTest('Resume Incomplete Job (Unrendered Frames Only)', () => {
  const queue = new JobQueue();
  const job = queue.submitJob({
    name: 'ResumeJob',
    projectPath: sampleProject,
    frames: '1-6',
    chunkSize: 2 // 3 tasks: [1,2], [3,4], [5,6]
  });

  const tasks = Array.from(job.tasks.values());
  // Complete task 0
  tasks[0].state = TaskState.COMPLETED;
  // Fail task 1 permanently
  tasks[1].state = TaskState.FAILED;
  // Leave task 2 cancelled
  tasks[2].state = TaskState.CANCELLED;
  job.state = JobState.FAILED;

  // Unfinished frames before resume should be 3, 4, 5, 6
  assert.deepEqual(job.getUnfinishedFrames(), [3, 4, 5, 6]);

  const resumed = queue.resumeJob(job.id);
  assert.equal(resumed.state, JobState.QUEUED);

  // Task 0 must remain COMPLETED
  assert.equal(tasks[0].state, TaskState.COMPLETED);
  // Task 1 and 2 must be reset to PENDING
  assert.equal(tasks[1].state, TaskState.PENDING);
  assert.equal(tasks[2].state, TaskState.PENDING);
});

// 10. Worker Disconnection & Heartbeat Timeout Reassignment
runTest('Worker Heartbeat Timeout & Task Reassignment', () => {
  const queue = new JobQueue();
  const job = queue.submitJob({
    name: 'DisconnectJob',
    projectPath: sampleProject,
    frames: '1-4',
    chunkSize: 2
  });

  const next = queue.getNextPendingTask();
  const taskId = next.task.id;
  queue.markTaskStarted(taskId, 'worker_dead_node');

  assert.equal(next.task.state, TaskState.RUNNING);
  assert.equal(next.task.workerId, 'worker_dead_node');

  // Simulate worker disconnection sweep
  const reassigned = queue.reassignWorkerTasks('worker_dead_node', 'Simulated LAN disconnect');
  assert.equal(reassigned, 1);
  assert.equal(next.task.state, TaskState.PENDING);
  assert.equal(next.task.workerId, null);
  assert.ok(next.task.error.includes('Simulated LAN disconnect'));
});

// 11. Output Integrity Verification
runTest('Output Integrity Verification (Undersized & Corrupt Files)', () => {
  const missingFile = path.join(tempDir, 'does_not_exist.exr');
  assert.equal(verifyOutputIntegrity(missingFile).valid, false);

  // Zero-byte file
  const emptyFile = path.join(tempDir, 'empty.exr');
  fs.writeFileSync(emptyFile, Buffer.alloc(0));
  const emptyCheck = verifyOutputIntegrity(emptyFile);
  assert.equal(emptyCheck.valid, false);
  assert.ok(emptyCheck.error.includes('truncated or undersized'));

  // Corrupt header file (bad magic number)
  const corruptFile = path.join(tempDir, 'corrupt.exr');
  fs.writeFileSync(corruptFile, Buffer.from('NOT_AN_OPENEXR_FILE_AT_ALL_CORRUPT_BUFFER_PADDING_OVER_64_BYTES_LONG'));
  const corruptCheck = verifyOutputIntegrity(corruptFile);
  assert.equal(corruptCheck.valid, false);
  assert.ok(corruptCheck.error.includes('magic header bytes'));

  // Valid EXR header bytes (0x76, 0x2f, 0x31, 0x01)
  const validExr = path.join(tempDir, 'valid_header.exr');
  const validBuf = Buffer.alloc(128);
  validBuf[0] = 0x76;
  validBuf[1] = 0x2f;
  validBuf[2] = 0x31;
  validBuf[3] = 0x01;
  fs.writeFileSync(validExr, validBuf);
  assert.equal(verifyOutputIntegrity(validExr).valid, true);
});

// 12. Localhost Multi-Worker Rendering Simulation over REST API
await runAsyncTest('Localhost Multi-Worker Rendering & Dispatcher REST Lifecycle', async () => {
  const dispatcher = new LANDispatcher({
    host: '127.0.0.1',
    port: 8092,
    authSecret: 'TEST_SECRET_FARM_123',
    heartbeatTimeoutMs: 2000,
    pollIntervalMs: 100
  });

  const { port } = await dispatcher.start();
  assert.ok(port > 0);

  // Register two compute workers
  const worker1 = new Worker({
    name: 'Worker-Blade-01',
    host: '127.0.0.1',
    port: 9001,
    gpuDevice: null // CPU-only
  });

  const worker2 = new Worker({
    name: 'Worker-Blade-02',
    host: '127.0.0.1',
    port: 9002,
    gpuDevice: null // CPU-only
  });

  dispatcher.registerWorker(worker1);
  dispatcher.registerWorker(worker2);

  const outPattern = path.join(tempDir, 'renders', 'farm_frame.####.exr');

  // Submit 4-frame job with chunkSize 1 (4 discrete tasks)
  const job = dispatcher.submitJob({
    name: 'MultiWorkerCompTest',
    projectPath: sampleProject,
    outputPattern: outPattern,
    frames: '1-4',
    chunkSize: 1,
    format: '64x64',
    priority: 80
  });

  assert.equal(job.tasks.size, 4);

  // Poll until job completes
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let attempts = 0;
  while (job.state !== JobState.COMPLETED && attempts < 50) {
    await sleep(200);
    attempts++;
  }

  assert.equal(job.state, JobState.COMPLETED, `Job must complete successfully (Current state: ${job.state})`);

  // Verify all 4 output frames exist and pass integrity checks
  for (let f = 1; f <= 4; f++) {
    const frameFile = path.join(tempDir, 'renders', `farm_frame.${String(f).padStart(4, '0')}.exr`);
    assert.ok(fs.existsSync(frameFile), `Rendered frame file must exist: "${frameFile}"`);
    const check = verifyOutputIntegrity(frameFile);
    assert.equal(check.valid, true, `Frame ${f} failed integrity check: ${check.error}`);
    assert.ok(check.size > 200, `Frame ${f} file size must be valid (>200 bytes)`);
  }

  // Verify job progress metrics
  const progress = job.getProgress();
  assert.equal(progress.completedTasks, 4);
  assert.equal(progress.failedTasks, 0);
  assert.equal(progress.percent, 100);

  // Stop dispatcher
  await dispatcher.stop();
});

// 13. Headless Worker Subprocess Execution Mode
await runAsyncTest('Headless Worker Subprocess Execution Mode (Spawn Isolation)', async () => {
  const subprocWorker = new Worker({
    name: 'Subprocess-Worker-01',
    executionMode: 'subprocess'
  });

  const outPattern = path.join(tempDir, 'subproc_renders', 'subproc.####.exr');
  const task = new RenderTask({
    id: 'subproc_task_01',
    jobId: 'subproc_job_01',
    frames: [1, 2]
  });

  const jobDef = {
    id: 'subproc_job_01',
    projectPath: sampleProject,
    outputPattern: outPattern,
    format: '64x64'
  };

  const progressEvents = [];
  const result = await subprocWorker.executeTask(task, jobDef, (p) => {
    progressEvents.push(p);
  });

  assert.equal(result.success, true);
  assert.equal(result.outputFiles.length, 2);

  for (const f of result.outputFiles) {
    assert.ok(fs.existsSync(f), `Subprocess rendered file must exist: "${f}"`);
    const check = verifyOutputIntegrity(f);
    assert.equal(check.valid, true, `File failed integrity check: ${check.error}`);
  }

  assert.equal(progressEvents.length, 2, 'Subprocess worker must report progress events for both frames');
  assert.equal(subprocWorker.state, WorkerState.IDLE);
});

console.log('----------------------------------------------------');
console.log('🎉 test_render_farm_core.mjs PASSED: All 13 test suites succeeded!');
console.log('----------------------------------------------------');

// Cleanup temporary test directory
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch (e) {}
