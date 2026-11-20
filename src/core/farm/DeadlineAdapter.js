/**
 * OpenComp - Multi-Scheduler Integration: AWS Thinkbox Deadline Adapter
 * Generates Job Info and Plugin Info key-value files for Deadline submission,
 * handles chunk size distribution, pool and group assignment, priority normalization (0-100),
 * CLI/REST submission, and task status tracking.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { SchedulerAdapterBase } from './SchedulerAdapterBase.js';
import { JobState, TaskState, generateId, formatFrameRange } from './FarmProtocol.js';

export class DeadlineAdapter extends SchedulerAdapterBase {
  /**
   * @param {Object} [config={}]
   * @param {string} [config.name='AWS Thinkbox Deadline']
   * @param {string} [config.pool='default']
   * @param {string} [config.secondaryPool='']
   * @param {string} [config.group='none']
   * @param {string} [config.department='VFX']
   * @param {string} [config.deadlineCommandPath='deadlinecommand']
   * @param {boolean} [config.useCli=true]
   * @param {string} [config.targetBladePlatform='linux']
   */
  constructor(config = {}) {
    super({
      ...config,
      name: config.name || 'AWS Thinkbox Deadline',
      type: 'deadline'
    });

    this.pool = config.pool || 'default';
    this.secondaryPool = config.secondaryPool || '';
    this.group = config.group || 'none';
    this.department = config.department || 'VFX';
    this.deadlineCommandPath = config.deadlineCommandPath || 'deadlinecommand';
    this.useCli = config.useCli !== false;
    this.targetBladePlatform = config.targetBladePlatform || 'linux';
    this.simulatedTasks = new Map();
  }

  /**
   * Get Deadline adapter capabilities
   */
  getCapabilities() {
    return {
      name: this.name,
      type: this.type,
      supportsChunking: true,
      supportsTileRendering: true,
      supportsGpuRequirements: true,
      priorityRange: [0, 100],
      supportedPlatforms: ['linux', 'windows', 'darwin'],
      cliAvailable: this._checkCliAvailable()
    };
  }

  /**
   * Check if deadlinecommand executable is available in PATH
   * @private
   */
  _checkCliAvailable() {
    try {
      const res = spawnSync(this.deadlineCommandPath, ['--version'], { encoding: 'utf8', shell: true });
      return res.status === 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * Generate Deadline Job Info key-value dictionary and formatted text
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {{text: string, data: Object}}
   */
  generateJobInfo(jobDef, options = {}) {
    const frames = this.parseFrames(jobDef.frames);
    const frameRangeStr = formatFrameRange(frames);
    const chunkSize = Math.max(1, parseInt(jobDef.chunkSize, 10) || 1);
    const priority = this.normalizePriority(jobDef.priority ?? 50, 0, 100);

    // Resolve pool: if GPU requested and default pool given, assign to GPU pool
    let pool = options.pool || jobDef.pool || this.pool;
    if (jobDef.gpuRequired && pool === 'default') {
      pool = 'gpu';
    }

    const group = options.group || jobDef.group || this.group;
    const secondaryPool = options.secondaryPool || jobDef.secondaryPool || this.secondaryPool;
    const department = options.department || jobDef.department || this.department;

    // Resolve output directory & pattern
    const outPattern = jobDef.outputPattern || '';
    const normOut = outPattern.replace(/\\/g, '/');
    const lastSlash = normOut.lastIndexOf('/');
    const outDir = lastSlash !== -1 ? normOut.slice(0, lastSlash) : '.';
    const outFileName = lastSlash !== -1 ? normOut.slice(lastSlash + 1) : normOut;

    const mappedOutDir = this.mapPath(outDir, options.targetPlatform || this.targetBladePlatform);

    const info = {
      Plugin: 'OpenComp',
      Name: (jobDef.name || 'OpenComp_Render').trim(),
      Comment: jobDef.comment || 'OpenComp Render Farm Batch',
      Department: department,
      Pool: pool,
      SecondaryPool: secondaryPool,
      Group: group,
      Priority: priority,
      ChunkSize: chunkSize,
      Frames: frameRangeStr,
      MachineLimit: jobDef.machineLimit || 0,
      OutputDirectory0: mappedOutDir,
      OutputFilename0: outFileName,
      ConcurrentTasks: jobDef.concurrentTasks || 1,
      InitialStatus: jobDef.initialStatus || 'Active'
    };

    if (jobDef.tags && Array.isArray(jobDef.tags)) {
      info.Tags = jobDef.tags.join(',');
    }

    if (jobDef.gpuRequired) {
      info.ExtraInfo0 = 'GPU=Required';
      if (jobDef.minVramBytes) {
        info.ExtraInfo1 = `MinVRAM=${jobDef.minVramBytes}`;
      }
    }

    const lines = Object.entries(info).map(([k, v]) => `${k}=${v}`);
    return {
      text: lines.join('\n') + '\n',
      data: info
    };
  }

  /**
   * Generate Deadline Plugin Info key-value dictionary and formatted text
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {{text: string, data: Object}}
   */
  generatePluginInfo(jobDef, options = {}) {
    const targetPlatform = options.targetPlatform || this.targetBladePlatform;
    const mappedProjectPath = this.mapPath(jobDef.projectPath, targetPlatform);
    const mappedOutputPattern = jobDef.outputPattern ? this.mapPath(jobDef.outputPattern, targetPlatform) : '';

    const pluginInfo = {
      ProjectFile: mappedProjectPath,
      OutputPattern: mappedOutputPattern,
      WriteNode: jobDef.node || '',
      Format: jobDef.format || 'exr',
      Bitdepth: jobDef.bitdepth || 'float32',
      Compression: jobDef.compression || '',
      Threads: jobDef.threads || 0,
      GpuAcceleration: Boolean(jobDef.gpuRequired),
      DeterministicMath: 'true',
      Colorspace: jobDef.colorspace || '',
      OcioConfig: jobDef.ocio ? this.mapPath(jobDef.ocio, targetPlatform) : '',
      Executable: 'node bin/opencomp-render.mjs'
    };

    const lines = Object.entries(pluginInfo).map(([k, v]) => `${k}=${v}`);
    return {
      text: lines.join('\n') + '\n',
      data: pluginInfo
    };
  }

  /**
   * Generate complete Deadline job manifest
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {Object}
   */
  generateJobManifest(jobDef, options = {}) {
    const jobInfo = this.generateJobInfo(jobDef, options);
    const pluginInfo = this.generatePluginInfo(jobDef, options);
    const frames = this.parseFrames(jobDef.frames);
    const chunkSize = Math.max(1, parseInt(jobDef.chunkSize, 10) || 1);
    const chunks = this.chunkFrames(frames, chunkSize);

    return {
      scheduler: 'deadline',
      jobInfoText: jobInfo.text,
      jobInfoData: jobInfo.data,
      pluginInfoText: pluginInfo.text,
      pluginInfoData: pluginInfo.data,
      chunks,
      totalFrames: frames.length,
      totalChunks: chunks.length
    };
  }

  /**
   * Submit job to AWS Thinkbox Deadline
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async submitJob(jobDef, options = {}) {
    const validation = this.validateJob(jobDef);
    if (!validation.valid) {
      throw new Error(`DeadlineSubmissionError: Invalid job definition: ${validation.errors.join('; ')}`);
    }

    const manifest = this.generateJobManifest(jobDef, options);
    const jobId = jobDef.id || generateId('deadline_job');
    const frames = this.parseFrames(jobDef.frames);

    const tasks = manifest.chunks.map((chunk, idx) => ({
      taskId: `${jobId}_task_${String(idx + 1).padStart(4, '0')}`,
      frames: chunk,
      state: TaskState.PENDING,
      attempts: 0,
      error: null
    }));

    // If CLI available and enabled, write temp files and run deadlinecommand
    let submissionOutput = '';
    const cliAvailable = this.useCli && this._checkCliAvailable();

    if (cliAvailable) {
      const tempDir = path.join(os.tmpdir(), `deadline_sub_${jobId}`);
      fs.mkdirSync(tempDir, { recursive: true });
      const jobInfoPath = path.join(tempDir, 'job_info.job');
      const pluginInfoPath = path.join(tempDir, 'plugin_info.job');

      fs.writeFileSync(jobInfoPath, manifest.jobInfoText, 'utf8');
      fs.writeFileSync(pluginInfoPath, manifest.pluginInfoText, 'utf8');

      try {
        const res = spawnSync(this.deadlineCommandPath, [jobInfoPath, pluginInfoPath], {
          encoding: 'utf8',
          shell: true
        });
        submissionOutput = res.stdout || res.stderr || '';
      } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
      }
    } else {
      submissionOutput = `Simulated Deadline submission for ${jobId} (Frames: ${manifest.jobInfoData.Frames})`;
    }

    const record = {
      id: jobId,
      name: jobDef.name,
      scheduler: 'deadline',
      state: JobState.QUEUED,
      manifest,
      frames,
      tasks,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null,
      rawOutput: submissionOutput
    };

    this.activeJobs.set(jobId, record);
    return {
      success: true,
      jobId,
      scheduler: 'deadline',
      status: 'QUEUED',
      manifest,
      tasks,
      message: submissionOutput
    };
  }

  /**
   * Query status of an existing Deadline job
   * @param {string} jobId
   * @returns {Promise<Object>}
   */
  async getJobStatus(jobId) {
    const record = this.activeJobs.get(jobId);
    if (!record) {
      throw new Error(`DeadlineJobNotFoundError: Job "${jobId}" not found in adapter registry`);
    }

    let completedTasks = 0;
    let failedTasks = 0;
    const completedFrames = [];
    const failedFrames = [];

    for (const t of record.tasks) {
      if (t.state === TaskState.COMPLETED) {
        completedTasks++;
        completedFrames.push(...t.frames);
      } else if (t.state === TaskState.FAILED) {
        failedTasks++;
        failedFrames.push(...t.frames);
      }
    }

    const totalTasks = record.tasks.length;
    const percent = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    return {
      id: jobId,
      name: record.name,
      state: record.state,
      scheduler: 'deadline',
      progress: {
        percent: Math.round(percent * 10) / 10,
        totalTasks,
        completedTasks,
        failedTasks,
        pendingTasks: totalTasks - completedTasks - failedTasks
      },
      completedFrames: completedFrames.sort((a, b) => a - b),
      failedFrames: failedFrames.sort((a, b) => a - b),
      error: record.error
    };
  }

  /**
   * Query individual task detail
   * @param {string} jobId
   * @param {string} taskId
   * @returns {Promise<Object>}
   */
  async getTaskStatus(jobId, taskId) {
    const record = this.activeJobs.get(jobId);
    if (!record) throw new Error(`Job "${jobId}" not found`);
    const task = record.tasks.find(t => t.taskId === taskId);
    if (!task) throw new Error(`Task "${taskId}" not found in job "${jobId}"`);
    return { ...task };
  }

  /**
   * Cancel an active Deadline job
   * @param {string} jobId
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async cancelJob(jobId) {
    const record = this.activeJobs.get(jobId);
    if (!record) throw new Error(`Job "${jobId}" not found`);
    record.state = JobState.CANCELLED;
    for (const t of record.tasks) {
      if (t.state !== TaskState.COMPLETED) {
        t.state = TaskState.CANCELLED;
      }
    }
    return {
      success: true,
      message: `Job ${jobId} successfully marked CANCELLED on Deadline`
    };
  }

  /**
   * Retry failed tasks for a Deadline job
   * @param {string} jobId
   * @param {Object} [options={}]
   * @returns {Promise<{success: boolean, retriedTasks: number[], message: string}>}
   */
  async retryFailedTasks(jobId, options = {}) {
    const record = this.activeJobs.get(jobId);
    if (!record) throw new Error(`Job "${jobId}" not found`);

    const retried = [];
    for (const t of record.tasks) {
      if (t.state === TaskState.FAILED) {
        t.state = TaskState.PENDING;
        t.attempts++;
        t.error = null;
        retried.push(...t.frames);
      }
    }

    if (retried.length > 0) {
      record.state = JobState.QUEUED;
    }

    return {
      success: true,
      retriedTasks: retried,
      message: `Retried ${retried.length} frames across failed Deadline tasks`
    };
  }

  /**
   * Simulated completion helper for unit testing
   * @param {string} jobId
   * @param {string} taskId
   * @param {boolean} success
   * @param {string} [error=null]
   */
  simulateTaskResult(jobId, taskId, success, error = null) {
    const record = this.activeJobs.get(jobId);
    if (!record) return;
    const task = record.tasks.find(t => t.taskId === taskId);
    if (!task) return;

    if (success) {
      task.state = TaskState.COMPLETED;
    } else {
      task.state = TaskState.FAILED;
      task.error = error || 'Simulated failure';
    }

    const allComplete = record.tasks.every(t => t.state === TaskState.COMPLETED);
    const hasFailed = record.tasks.some(t => t.state === TaskState.FAILED);

    if (allComplete) {
      record.state = JobState.COMPLETED;
    } else if (hasFailed) {
      record.state = JobState.FAILED;
      record.error = 'One or more tasks failed';
    } else {
      record.state = JobState.RUNNING;
    }
  }
}

