/**
 * OpenComp - Test Suite 58: Multi-Scheduler Integration & Studio Render Pipeline
 * Validates AWS Thinkbox Deadline, Pixar Tractor, ASWF OpenCue, and Native LAN
 * adapters, resource-aware blade filtering, UNC <-> NFS path mapping,
 * output integrity, incomplete frame recovery, duplicate prevention, and local fallback.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  JobState,
  TaskState,
  WorkerState,
  verifyOutputIntegrity,
  formatFrameRange
} from '../src/core/farm/FarmProtocol.js';

import {
  SchedulerAdapterBase,
  DeadlineAdapter,
  TractorAdapter,
  OpenCueAdapter,
  NativeLANAdapter,
  SchedulerManager,
  JobQueue,
  Worker,
  LANDispatcher
} from '../src/core/farm/index.js';

import { PipelineTokens } from '../src/core/PipelineTokens.js';
import { Graph } from '../src/core/Graph.js';
import { createNode } from '../src/nodes/index.js';

const tempDir = path.join(os.tmpdir(), `opencomp_scheduler_test_${Date.now()}`);
fs.mkdirSync(tempDir, { recursive: true });

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ Multi-Scheduler: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: Multi-Scheduler: ${name}`);
    console.error(err);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ Multi-Scheduler: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: Multi-Scheduler: ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('----------------------------------------------------');
console.log('🧪 RUNNING: tests/test_scheduler_integrations.mjs');
console.log('----------------------------------------------------');

// Helper to create synthetic OpenComp project file
function createTestProject(filePath) {
  const g = new Graph();
  const r = createNode('Read', 'Read1');
  r.setKnobValue('sourceType', 'ramp');
  r.setKnobValue('format', '32x32');
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

const sampleProject = createTestProject(path.join(tempDir, 'scheduler_scene.opencomp'));

// 1. Common Scheduler Interface Enforcement
runTest('Requirement 1: Common Scheduler Interface Enforcement & Base Utilities', () => {
  const base = new SchedulerAdapterBase({ name: 'GenericScheduler', type: 'generic' });
  assert.equal(base.name, 'GenericScheduler');
  assert.equal(base.type, 'generic');

  // Verify abstract methods throw when called directly on base
  assert.throws(() => base.generateJobManifest({}), /must be implemented/);
  assert.rejects(async () => await base.submitJob({}));
  assert.rejects(async () => await base.getJobStatus('job1'));
  assert.rejects(async () => await base.getTaskStatus('job1', 'task1'));
  assert.rejects(async () => await base.cancelJob('job1'));
  assert.rejects(async () => await base.retryFailedTasks('job1'));

  // Test frame range parsing
  assert.deepEqual(base.parseFrames('1001-1005'), [1001, 1002, 1003, 1004, 1005]);
  assert.deepEqual(base.parseFrames('1, 3, 5-7'), [1, 3, 5, 6, 7]);
  assert.deepEqual(base.parseFrames([10, 11, 12]), [10, 11, 12]);

  // Test frame chunking
  const chunks = base.chunkFrames([1, 2, 3, 4, 5, 6, 7], 3);
  assert.deepEqual(chunks, [[1, 2, 3], [4, 5, 6], [7]]);

  // Test priority normalization
  assert.equal(base.normalizePriority(50, 0, 100), 50);
  assert.equal(base.normalizePriority(0, 1, 1000), 1);
  assert.equal(base.normalizePriority(100, 1, 1000), 1000);
  assert.equal(base.normalizePriority(50, 0, 10000), 5000);
});

// 2. Deadline Adapter (.job Generation, Chunking, Priority)
runTest('Requirement 2: AWS Thinkbox Deadline Adapter (.job generation, chunking, priority)', () => {
  const deadline = new DeadlineAdapter({
    pathMappings: [{ windows: 'C:/projects', linux: '/mnt/storage/projects' }]
  });

  const jobDef = {
    name: 'Shot010_Comp',
    projectPath: sampleProject,
    outputPattern: 'C:/projects/renders/shot010.####.exr',
    frames: '1001-1020',
    chunkSize: 5,
    priority: 80,
    gpuRequired: true,
    minVramBytes: 8 * 1024 * 1024 * 1024
  };

  const manifest = deadline.generateJobManifest(jobDef, { targetPlatform: 'linux' });
  assert.equal(manifest.scheduler, 'deadline');
  assert.equal(manifest.totalFrames, 20);
  assert.equal(manifest.totalChunks, 4);
  assert.deepEqual(manifest.chunks[0], [1001, 1002, 1003, 1004, 1005]);

  // Validate Job Info text
  assert.ok(manifest.jobInfoText.includes('Plugin=OpenComp'));
  assert.ok(manifest.jobInfoText.includes('Name=Shot010_Comp'));
  assert.ok(manifest.jobInfoText.includes('Frames=1001-1020'));
  assert.ok(manifest.jobInfoText.includes('ChunkSize=5'));
  assert.ok(manifest.jobInfoText.includes('Priority=80'));
  assert.ok(manifest.jobInfoText.includes('Pool=gpu'));
  assert.ok(manifest.jobInfoText.includes('ExtraInfo0=GPU=Required'));

  // Validate Plugin Info text
  assert.ok(manifest.pluginInfoText.includes('DeterministicMath=true'));
  assert.ok(manifest.pluginInfoText.includes('GpuAcceleration=true'));
  assert.ok(manifest.pluginInfoText.includes('Executable=node bin/opencomp-render.mjs'));
  assert.ok(manifest.pluginInfoText.includes('OutputPattern=/mnt/storage/projects/renders/shot010.####.exr'));
});

// 3. Tractor Adapter (.alf Task Tree Generation, Remote Commands)
runTest('Requirement 3: Pixar Tractor Adapter (.alf task tree generation, remote commands)', () => {
  const tractor = new TractorAdapter({
    pathMappings: [{ windows: 'C:/projects', linux: '/mnt/storage/projects' }],
    engineHost: 'tractor01.studio.internal',
    enginePort: 80
  });

  const jobDef = {
    name: 'Shot020_FinalComp',
    projectPath: sampleProject,
    outputPattern: 'C:/projects/renders/shot020.####.exr',
    frames: '101-115',
    chunkSize: 5,
    priority: 75,
    gpuRequired: true
  };

  const manifest = tractor.generateJobManifest(jobDef, { targetPlatform: 'linux' });
  assert.equal(manifest.scheduler, 'tractor');
  assert.equal(manifest.totalFrames, 15);
  assert.equal(manifest.totalChunks, 3);
  assert.equal(manifest.priority, 750); // 75% of 1000

  // Validate Alfred script structure
  const alf = manifest.alfScript;
  assert.ok(alf.startsWith('##Alfred999'));
  assert.ok(alf.includes('Job -title {Shot020_FinalComp} -priority {750}'));
  assert.ok(alf.includes('OpenCompBlade && (GPU || CUDA)'));
  assert.ok(alf.includes('Task {Pre-Render Check}'));
  assert.ok(alf.includes('Task {Frame Tasks}'));
  assert.ok(alf.includes('Task {Post-Render Verification}'));
  assert.ok(alf.includes('RemoteCmd {node bin/opencomp-render.mjs'));
  assert.ok(alf.includes('--deterministic-ieee754'));
});

// 4. OpenCue Adapter (Layer Outline, Frame Spec & PyCue Script)
runTest('Requirement 4: ASWF OpenCue Adapter (layer outline, frame spec & PyCue script)', () => {
  const opencue = new OpenCueAdapter({
    cuebotHost: 'cuebot.studio.internal',
    defaultShow: 'feature_film',
    defaultShot: 'sh050'
  });

  const jobDef = {
    name: 'Shot050_Comp',
    projectPath: sampleProject,
    outputPattern: '/mnt/storage/renders/shot050.####.exr',
    frames: '1001-1050',
    chunkSize: 10,
    priority: 60,
    minCores: 8,
    minRamGb: 16,
    gpuRequired: true
  };

  const manifest = opencue.generateJobManifest(jobDef);
  assert.equal(manifest.scheduler, 'opencue');
  assert.equal(manifest.outline.priority, 6000); // 60% of 10000
  assert.equal(manifest.outline.show, 'feature_film');
  assert.equal(manifest.outline.shot, 'sh050');

  const layer = manifest.outline.layers[0];
  assert.equal(layer.name, 'render');
  assert.equal(layer.range, '1001-1050');
  assert.equal(layer.chunk, 10);
  assert.equal(layer.cores, 8);
  assert.equal(layer.memory, '16GiB');
  assert.deepEqual(layer.services, ['opencomp', 'gpu']);

  // Validate Python PyCue script
  assert.ok(manifest.pyCueScript.includes('import opencue'));
  assert.ok(manifest.pyCueScript.includes('import opencue.outline'));
  assert.ok(manifest.pyCueScript.includes('outline.add_layer'));
  assert.ok(manifest.pyCueScript.includes('layer.set_chunk_size(10)'));
  assert.ok(manifest.pyCueScript.includes('layer.set_cores(8)'));
  assert.ok(manifest.pyCueScript.includes('layer.set_memory("16GiB")'));
});

// 5. Job Submission & Status Synchronization
await runAsyncTest('Requirement 5: Job Submission & Status Synchronization', async () => {
  const manager = new SchedulerManager();

  const jobDef = {
    name: 'BatchSubmissionTest',
    projectPath: sampleProject,
    outputPattern: path.join(tempDir, 'sync.####.exr'),
    frames: [1, 2, 3, 4],
    chunkSize: 2,
    priority: 50
  };

  // Submit to Deadline adapter
  const deadlineRes = await manager.submitJob(jobDef, 'deadline');
  assert.equal(deadlineRes.success, true);
  assert.equal(deadlineRes.status, 'QUEUED');
  assert.equal(deadlineRes.tasks.length, 2);

  const status1 = await manager.getJobStatus(deadlineRes.jobId);
  assert.equal(status1.state, JobState.QUEUED);
  assert.equal(status1.progress.totalTasks, 2);
  assert.equal(status1.progress.percent, 0);

  // Simulate task progression
  const deadlineAdapter = manager.getAdapter('deadline');
  deadlineAdapter.simulateTaskResult(deadlineRes.jobId, deadlineRes.tasks[0].taskId, true);

  const status2 = await manager.getJobStatus(deadlineRes.jobId);
  assert.equal(status2.progress.completedTasks, 1);
  assert.equal(status2.progress.percent, 50);
  assert.deepEqual(status2.completedFrames, [1, 2]);

  deadlineAdapter.simulateTaskResult(deadlineRes.jobId, deadlineRes.tasks[1].taskId, true);
  const status3 = await manager.getJobStatus(deadlineRes.jobId);
  assert.equal(status3.state, JobState.COMPLETED);
  assert.equal(status3.progress.percent, 100);
  assert.deepEqual(status3.completedFrames, [1, 2, 3, 4]);
});

// 6. Frame-Range Distribution and Chunking
runTest('Requirement 6: Frame-Range Distribution and Arbitrary Chunking', () => {
  const adapter = new SchedulerAdapterBase();

  // Test single frame
  assert.deepEqual(adapter.chunkFrames([101], 5), [[101]]);

  // Test 10 frames with chunk 3
  const chunks3 = adapter.chunkFrames([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
  assert.equal(chunks3.length, 4);
  assert.deepEqual(chunks3[0], [1, 2, 3]);
  assert.deepEqual(chunks3[1], [4, 5, 6]);
  assert.deepEqual(chunks3[2], [7, 8, 9]);
  assert.deepEqual(chunks3[3], [10]);

  // Test discrete discontinuous frames
  const discontinuous = adapter.parseFrames('1-3, 10, 20-22');
  assert.deepEqual(discontinuous, [1, 2, 3, 10, 20, 21, 22]);
  const discChunks = adapter.chunkFrames(discontinuous, 2);
  assert.equal(discChunks.length, 4);
  assert.deepEqual(discChunks[0], [1, 2]);
  assert.deepEqual(discChunks[1], [3, 10]);
  assert.deepEqual(discChunks[2], [20, 21]);
  assert.deepEqual(discChunks[3], [22]);
});

// 7. Priority and Resource Mapping (CPU / RAM / GPU)
runTest('Requirement 7: Priority and Resource Mapping', () => {
  const manager = new SchedulerManager();
  const deadline = manager.getAdapter('deadline');
  const tractor = manager.getAdapter('tractor');
  const opencue = manager.getAdapter('opencue');

  // Verify normalized priority scaling
  assert.equal(deadline.normalizePriority(0), 0);
  assert.equal(deadline.normalizePriority(50), 50);
  assert.equal(deadline.normalizePriority(100), 100);

  assert.equal(tractor.normalizePriority(0, 1, 1000), 1);
  assert.equal(tractor.normalizePriority(50, 1, 1000), 501);
  assert.equal(tractor.normalizePriority(100, 1, 1000), 1000);

  assert.equal(opencue.normalizePriority(0, 0, 10000), 0);
  assert.equal(opencue.normalizePriority(50, 0, 10000), 5000);
  assert.equal(opencue.normalizePriority(100, 0, 10000), 10000);
});

// 8. Worker Capability Filtering (GPU Tasks vs CPU Workers)
runTest('Requirement 8: Resource-Aware Worker Capability Filtering (GPU vs CPU)', () => {
  const manager = new SchedulerManager();

  const workers = [
    {
      id: 'blade_cpu_01',
      cpuCores: 8,
      ramTotal: 16 * 1024 * 1024 * 1024,
      gpuDevice: null, // CPU blade
      vramBytes: null,
      tags: ['cpu', 'openexr'],
      osPlatform: 'linux'
    },
    {
      id: 'blade_cpu_02',
      cpuCores: 64,
      ramTotal: 128 * 1024 * 1024 * 1024,
      gpuDevice: null, // High RAM CPU blade
      tags: ['cpu', 'openexr', 'heavy'],
      osPlatform: 'linux'
    },
    {
      id: 'blade_gpu_01',
      cpuCores: 16,
      ramTotal: 32 * 1024 * 1024 * 1024,
      gpuDevice: 'NVIDIA RTX A5000',
      vramBytes: 24 * 1024 * 1024 * 1024,
      tags: ['gpu', 'openexr', 'cuda'],
      osPlatform: 'win32'
    }
  ];

  // 1. General CPU task
  const cpuMatch = manager.filterCompatibleWorkers(workers, { minCores: 4 });
  assert.equal(cpuMatch.length, 3);

  // 2. Heavy memory task requiring 64GB
  const heavyMatch = manager.filterCompatibleWorkers(workers, { minRamBytes: 64 * 1024 * 1024 * 1024 });
  assert.equal(heavyMatch.length, 1);
  assert.equal(heavyMatch[0].id, 'blade_cpu_02');

  // 3. GPU task (must filter out CPU blades)
  const gpuMatch = manager.filterCompatibleWorkers(workers, { gpuRequired: true });
  assert.equal(gpuMatch.length, 1);
  assert.equal(gpuMatch[0].id, 'blade_gpu_01');

  // 4. GPU task requiring 32GB VRAM (exceeds 24GB blade)
  const gpuOverMatch = manager.filterCompatibleWorkers(workers, { gpuRequired: true, minVramBytes: 32 * 1024 * 1024 * 1024 });
  assert.equal(gpuOverMatch.length, 0);

  // 5. Tag filtering
  const tagMatch = manager.filterCompatibleWorkers(workers, { requiredTags: ['cuda'] });
  assert.equal(tagMatch.length, 1);
  assert.equal(tagMatch[0].id, 'blade_gpu_01');
});

// 9. Path Mapping (Windows UNC <-> Linux NFS) & PipelineTokens
runTest('Requirement 9: Cross-Platform Path Mapping & PipelineTokens Resolution', () => {
  const pathMappings = [
    { windows: '\\\\studio-storage\\projects', linux: '/mnt/storage/projects', name: 'Projects' },
    { windows: 'Z:\\assets', linux: '/mnt/assets', name: 'Assets' }
  ];

  const tokens = new PipelineTokens({
    pathMappings,
    tokens: {
      SHOW: 'avatar',
      SHOT: 'sh010',
      VERSION: 'v002'
    }
  });

  const manager = new SchedulerManager({ pathMappings, pipelineTokens: tokens });
  const deadline = manager.getAdapter('deadline');

  // Test UNC to Linux NFS translation
  const winUnc = '\\\\studio-storage\\projects\\avatar\\sh010\\scene.opencomp';
  const linuxMapped = deadline.mapPath(winUnc, 'linux');
  assert.equal(linuxMapped, '/mnt/storage/projects/avatar/sh010/scene.opencomp');

  // Test Linux NFS to Windows UNC translation
  const linuxPath = '/mnt/storage/projects/avatar/sh010/renders/out.####.exr';
  const winMapped = deadline.mapPath(linuxPath, 'windows');
  assert.equal(winMapped, '\\\\studio-storage\\projects\\avatar\\sh010\\renders\\out.####.exr');

  // Test PipelineTokens resolution
  const template = '${SHOW}/${SHOT}/${VERSION}/render.####.exr';
  const resolved = tokens.resolve(template, { frame: 1042 });
  assert.equal(resolved, 'avatar/sh010/v002/render.1042.exr');
});

// 10. Job Cancellation and Task Abort
await runAsyncTest('Requirement 10: Job Cancellation and Task Abort', async () => {
  const manager = new SchedulerManager();
  const jobDef = {
    name: 'CancelTestJob',
    projectPath: sampleProject,
    outputPattern: path.join(tempDir, 'cancel.####.exr'),
    frames: '1-10',
    chunkSize: 2
  };

  const tractor = manager.getAdapter('tractor');
  const sub = await tractor.submitJob(jobDef);
  assert.equal(sub.status, 'QUEUED');

  // Cancel job
  const cancelRes = await tractor.cancelJob(sub.jobId);
  assert.equal(cancelRes.success, true);

  const status = await tractor.getJobStatus(sub.jobId);
  assert.equal(status.state, JobState.CANCELLED);
  for (const t of sub.tasks) {
    const taskStatus = await tractor.getTaskStatus(sub.jobId, t.taskId);
    assert.equal(taskStatus.state, TaskState.CANCELLED);
  }
});

// 11. Network Failure Handling and Retry
await runAsyncTest('Requirement 11: Failure Handling & Failed Task Retry', async () => {
  const manager = new SchedulerManager();
  const jobDef = {
    name: 'RetryTestJob',
    projectPath: sampleProject,
    outputPattern: path.join(tempDir, 'retry.####.exr'),
    frames: '1-6',
    chunkSize: 2
  };

  const opencue = manager.getAdapter('opencue');
  const sub = await opencue.submitJob(jobDef);

  // Simulate chunk 2 failure
  opencue.simulateTaskResult(sub.jobId, sub.tasks[0].taskId, true);
  opencue.simulateTaskResult(sub.jobId, sub.tasks[1].taskId, false, 'Network timeout to blade');

  let status = await opencue.getJobStatus(sub.jobId);
  assert.equal(status.state, JobState.FAILED);
  assert.equal(status.progress.failedTasks, 1);
  assert.deepEqual(status.failedFrames, [3, 4]);

  // Execute retry
  const retryRes = await opencue.retryFailedTasks(sub.jobId);
  assert.equal(retryRes.success, true);
  assert.deepEqual(retryRes.retriedTasks, [3, 4]);

  status = await opencue.getJobStatus(sub.jobId);
  assert.equal(status.state, JobState.QUEUED);
  assert.equal(status.progress.failedTasks, 0);
});

// 12. Frame Output Integrity Validation
runTest('Requirement 12: Frame Output Integrity Validation (Magic Bytes & Size)', () => {
  const manager = new SchedulerManager();

  // Create valid OpenEXR file (magic bytes: 0x76, 0x2f, 0x31, 0x01)
  const validExrPath = path.join(tempDir, 'valid.exr');
  const exrBuf = Buffer.alloc(128);
  exrBuf[0] = 0x76; exrBuf[1] = 0x2f; exrBuf[2] = 0x31; exrBuf[3] = 0x01;
  fs.writeFileSync(validExrPath, exrBuf);

  // Create valid PNG file (magic bytes: 0x89, 0x50, 0x4e, 0x47)
  const validPngPath = path.join(tempDir, 'valid.png');
  const pngBuf = Buffer.alloc(128);
  pngBuf[0] = 0x89; pngBuf[1] = 0x50; pngBuf[2] = 0x4e; pngBuf[3] = 0x47;
  fs.writeFileSync(validPngPath, pngBuf);

  // Create corrupt EXR (bad header)
  const corruptExrPath = path.join(tempDir, 'corrupt.exr');
  const badBuf = Buffer.alloc(128);
  badBuf[0] = 0x00; badBuf[1] = 0x00; badBuf[2] = 0x00; badBuf[3] = 0x00;
  fs.writeFileSync(corruptExrPath, badBuf);

  // Create truncated file (< 64 bytes)
  const truncPath = path.join(tempDir, 'trunc.exr');
  fs.writeFileSync(truncPath, Buffer.alloc(16));

  const nonExistentPath = path.join(tempDir, 'missing.exr');

  const check = manager.validateOutputs([
    validExrPath,
    validPngPath,
    corruptExrPath,
    truncPath,
    nonExistentPath
  ]);

  assert.equal(check.valid, false);
  assert.equal(check.totalFiles, 5);
  assert.equal(check.validFiles.length, 2);
  assert.equal(check.corruptFiles.length, 2);
  assert.equal(check.missingFiles.length, 1);
  assert.equal(check.missingFiles[0], nonExistentPath);
});

// 13. Duplicate Frame Prevention
await runAsyncTest('Requirement 13: Duplicate Active Job Prevention', async () => {
  const manager = new SchedulerManager();
  const outPattern = path.join(tempDir, 'nodup.####.exr');

  const job1 = {
    name: 'PrimaryJob',
    projectPath: sampleProject,
    outputPattern: outPattern,
    frames: [101, 102, 103, 104, 105],
    chunkSize: 1
  };

  const res1 = await manager.submitJob(job1, 'deadline');
  assert.equal(res1.success, true);

  // Attempt duplicate job with overlapping frames
  const job2 = {
    name: 'OverlappingJob',
    projectPath: sampleProject,
    outputPattern: outPattern,
    frames: [103, 104, 105, 106],
    chunkSize: 1
  };

  await assert.rejects(
    async () => await manager.submitJob(job2, 'deadline'),
    /DuplicateJobError/
  );

  // Allow duplicate if explicitly overridden
  const res2 = await manager.submitJob(job2, 'deadline', { allowDuplicate: true });
  assert.equal(res2.success, true);
});

// 14. Incomplete-Frame Recovery
await runAsyncTest('Requirement 14: Incomplete-Frame Detection and Targeted Recovery', async () => {
  const manager = new SchedulerManager();
  const outDir = path.join(tempDir, 'recovery_seq');
  fs.mkdirSync(outDir, { recursive: true });
  const outPattern = path.join(outDir, 'shot.####.exr');

  // Create intact frames 1, 2, 4, 5 (Frame 3 missing, Frame 5 corrupted)
  const exrHeader = Buffer.alloc(128);
  exrHeader[0] = 0x76; exrHeader[1] = 0x2f; exrHeader[2] = 0x31; exrHeader[3] = 0x01;

  fs.writeFileSync(path.join(outDir, 'shot.0001.exr'), exrHeader);
  fs.writeFileSync(path.join(outDir, 'shot.0002.exr'), exrHeader);
  // shot.0003.exr is missing
  fs.writeFileSync(path.join(outDir, 'shot.0004.exr'), exrHeader);
  fs.writeFileSync(path.join(outDir, 'shot.0005.exr'), Buffer.alloc(10)); // Truncated

  const missing = manager.findIncompleteFrames([1, 2, 3, 4, 5], outPattern);
  assert.deepEqual(missing.missingFrames, [3]);
  assert.deepEqual(missing.corruptFrames, [5]);
  assert.deepEqual(missing.intactFrames, [1, 2, 4]);

  // Submit original job record to manager
  const originalJob = await manager.submitJob({
    name: 'SequenceToRecover',
    projectPath: sampleProject,
    outputPattern: outPattern,
    frames: [1, 2, 3, 4, 5]
  }, 'deadline');

  // Trigger targeted recovery
  const recovery = await manager.recoverIncompleteJob(originalJob.jobId);
  assert.equal(recovery.recovered, true);
  assert.deepEqual(recovery.framesToRender, [3, 5]);
  assert.equal(recovery.missingCount, 1);
  assert.equal(recovery.corruptCount, 1);
});

// 15. Project Dependency Consistency
runTest('Requirement 15: Project Dependency & File Consistency Validation', () => {
  const manager = new SchedulerManager();
  const deadline = manager.getAdapter('deadline');

  // Valid project
  const validCheck = deadline.validateJob({
    name: 'ValidJob',
    projectPath: sampleProject,
    frames: [1, 2]
  });
  assert.equal(validCheck.valid, true);

  // Missing project file
  const invalidCheck = deadline.validateJob({
    name: 'BadJob',
    projectPath: path.join(tempDir, 'does_not_exist.opencomp'),
    frames: [1, 2]
  });
  assert.equal(invalidCheck.valid, false);
  assert.ok(invalidCheck.errors.some(e => e.includes('does not exist')));
});

// 16. Local Rendering Fallback
await runAsyncTest('Requirement 16: Local Rendering Fallback Execution', async () => {
  const manager = new SchedulerManager();
  const localOutPattern = path.join(tempDir, 'local_fallback.####.exr');

  const jobDef = {
    name: 'LocalFallbackJob',
    projectPath: sampleProject,
    outputPattern: localOutPattern,
    frames: [1, 2],
    format: 'exr'
  };

  const res = await manager.fallbackToLocal(jobDef);
  assert.equal(res.success, true);
  assert.equal(res.mode, 'local_fallback');
  assert.equal(res.renderedFiles.length, 2);

  // Verify rendered files exist and have OpenEXR magic bytes
  for (const fp of res.renderedFiles) {
    assert.ok(fs.existsSync(fp), `Rendered file must exist: ${fp}`);
    const check = verifyOutputIntegrity(fp);
    assert.equal(check.valid, true, `Rendered file integrity failure: ${check.error}`);
  }
});

// 17. Scheduler Capability Reporting
runTest('Requirement 17: Scheduler Capability & Profile Reporting', () => {
  const manager = new SchedulerManager();
  const schedulers = manager.listSchedulers();
  assert.equal(schedulers.length, 4);

  const ids = schedulers.map(s => s.id);
  assert.ok(ids.includes('deadline'));
  assert.ok(ids.includes('tractor'));
  assert.ok(ids.includes('opencue'));
  assert.ok(ids.includes('native_lan'));

  for (const s of schedulers) {
    assert.ok(s.capabilities.supportsChunking);
    assert.ok(s.capabilities.supportsTileRendering);
    assert.ok(s.capabilities.supportsGpuRequirements);
    assert.ok(Array.isArray(s.capabilities.priorityRange));
  }
});

// 18. Full Regression with Native Render Farm Core
await runAsyncTest('Requirement 18: Full Regression with Native Render Farm Core (JobQueue, Worker, LANDispatcher)', async () => {
  const manager = new SchedulerManager();
  const nativeAdapter = manager.getAdapter('native_lan');
  assert.ok(nativeAdapter instanceof NativeLANAdapter);

  const dispatcher = nativeAdapter.dispatcher;
  assert.ok(dispatcher instanceof LANDispatcher);

  // Register in-process worker
  const worker = new Worker({
    name: 'InProcessBlade01',
    executionMode: 'in-process'
  });
  dispatcher.registerWorker(worker);

  const outPattern = path.join(tempDir, 'native_farm.####.exr');
  const jobDef = {
    name: 'NativeLANFarmTest',
    projectPath: sampleProject,
    outputPattern: outPattern,
    frames: [1, 2],
    chunkSize: 1,
    priority: 80
  };

  const sub = await nativeAdapter.submitJob(jobDef);
  assert.equal(sub.success, true);
  assert.equal(sub.scheduler, 'native_lan');

  // Run dispatch tick
  await dispatcher.tick();

  const status = await nativeAdapter.getJobStatus(sub.jobId);
  assert.ok([JobState.QUEUED, JobState.RUNNING, JobState.COMPLETED].includes(status.state));
  assert.equal(status.progress.totalTasks, 2);

  // Clean shutdown
  await dispatcher.stop();
});

// Cleanup temp test directory
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch (e) {}

console.log('----------------------------------------------------');
console.log('🎉 ALL 18 SCHEDULER INTEGRATION CHECKS PASSED!');
console.log('----------------------------------------------------');
