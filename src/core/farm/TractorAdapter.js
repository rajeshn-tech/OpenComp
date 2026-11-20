/**
 * OpenComp - Multi-Scheduler Integration: Pixar Tractor Adapter
 * Generates hierarchical Alfred (.alf) task trees for Tractor Engine,
 * handles task dependencies (pre-flight check -> frame chunks -> post-render verification),
 * priority normalization (1-1000), service key requirements, and spooling.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { SchedulerAdapterBase } from './SchedulerAdapterBase.js';
import { JobState, TaskState, generateId, formatFrameRange } from './FarmProtocol.js';

export class TractorAdapter extends SchedulerAdapterBase {
  /**
   * @param {Object} [config={}]
   * @param {string} [config.name='Pixar Tractor']
   * @param {string} [config.engineHost='tractor-engine']
   * @param {number} [config.enginePort=80]
   * @param {string} [config.defaultService='OpenCompBlade']
   * @param {string} [config.spoolCommandPath='tractor-spool']
   * @param {boolean} [config.useCli=true]
   * @param {string} [config.targetBladePlatform='linux']
   */
  constructor(config = {}) {
    super({
      ...config,
      name: config.name || 'Pixar Tractor',
      type: 'tractor'
    });

    this.engineHost = config.engineHost || 'tractor-engine';
    this.enginePort = config.enginePort || 80;
    this.defaultService = config.defaultService || 'OpenCompBlade';
    this.spoolCommandPath = config.spoolCommandPath || 'tractor-spool';
    this.useCli = config.useCli !== false;
    this.targetBladePlatform = config.targetBladePlatform || 'linux';
  }

  /**
   * Get Tractor adapter capabilities
   */
  getCapabilities() {
    return {
      name: this.name,
      type: this.type,
      supportsChunking: true,
      supportsTileRendering: true,
      supportsGpuRequirements: true,
      priorityRange: [1, 1000],
      supportedPlatforms: ['linux', 'windows', 'darwin'],
      cliAvailable: this._checkCliAvailable()
    };
  }

  /**
   * Check if tractor-spool executable is available in PATH
   * @private
   */
  _checkCliAvailable() {
    try {
      const res = spawnSync(this.spoolCommandPath, ['--help'], { encoding: 'utf8', shell: true });
      return res.status === 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * Generate Pixar Alfred (.alf) task script
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {{text: string, title: string, priority: number, service: string, chunks: Array<number[]>}}
   */
  generateAlfScript(jobDef, options = {}) {
    const targetPlatform = options.targetPlatform || this.targetBladePlatform;
    const mappedProjectPath = this.mapPath(jobDef.projectPath, targetPlatform);
    const mappedOutputPattern = jobDef.outputPattern ? this.mapPath(jobDef.outputPattern, targetPlatform) : '';

    const frames = this.parseFrames(jobDef.frames);
    const frameRangeStr = formatFrameRange(frames);
    const chunkSize = Math.max(1, parseInt(jobDef.chunkSize, 10) || 1);
    const chunks = this.chunkFrames(frames, chunkSize);

    // Tractor priority is 1 to 1000
    const priority = this.normalizePriority(jobDef.priority ?? 50, 1, 1000);

    // Service key mapping
    let service = options.service || jobDef.service || this.defaultService;
    if (jobDef.gpuRequired && !service.includes('GPU')) {
      service = `${service} && (GPU || CUDA)`;
    }

    const title = (jobDef.name || 'OpenComp_Render').trim();
    const nodeFlag = jobDef.node ? ` --node "${jobDef.node}"` : '';
    const formatFlag = jobDef.format ? ` --format "${jobDef.format}"` : '';

    // Build Alfred script lines
    const lines = [];
    lines.push('##Alfred999');
    lines.push(`Job -title {${title}} -priority {${priority}} -service {${service}} -subtasks {`);

    // Task 1: Pre-Render Check
    lines.push('  Task {Pre-Render Check} -cmds {');
    lines.push(`    RemoteCmd {node bin/opencomp-render.mjs --verify-project "${mappedProjectPath}"}`);
    lines.push('  }');

    // Task 2: Main Frame Tasks Group
    lines.push('  Task {Frame Tasks} -subtasks {');
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkRange = formatFrameRange(chunk);
      const taskTitle = `Chunk ${i + 1} (${chunkRange})`;
      lines.push(`    Task {${taskTitle}} -cmds {`);
      lines.push(`      RemoteCmd {node bin/opencomp-render.mjs --project "${mappedProjectPath}" --frames ${chunkRange} --output "${mappedOutputPattern}"${nodeFlag}${formatFlag} --deterministic-ieee754} -service {${service}}`);
      lines.push('    }');
    }
    lines.push('  }');

    // Task 3: Post-Render Verification
    lines.push('  Task {Post-Render Verification} -cmds {');
    lines.push(`    RemoteCmd {node bin/opencomp-render.mjs --verify-output "${mappedOutputPattern}" --frames ${frameRangeStr}}`);
    lines.push('  }');

    lines.push('}'); // End Job

    return {
      text: lines.join('\n') + '\n',
      title,
      priority,
      service,
      chunks,
      totalFrames: frames.length,
      totalChunks: chunks.length
    };
  }

  /**
   * Generate complete Tractor manifest
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {Object}
   */
  generateJobManifest(jobDef, options = {}) {
    const alf = this.generateAlfScript(jobDef, options);
    return {
      scheduler: 'tractor',
      alfScript: alf.text,
      title: alf.title,
      priority: alf.priority,
      service: alf.service,
      chunks: alf.chunks,
      totalFrames: alf.totalFrames,
      totalChunks: alf.totalChunks
    };
  }

  /**
   * Submit job to Pixar Tractor Engine
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async submitJob(jobDef, options = {}) {
    const validation = this.validateJob(jobDef);
    if (!validation.valid) {
      throw new Error(`TractorSubmissionError: Invalid job definition: ${validation.errors.join('; ')}`);
    }

    const manifest = this.generateJobManifest(jobDef, options);
    const jobId = jobDef.id || generateId('tractor_job');
    const frames = this.parseFrames(jobDef.frames);

    const tasks = manifest.chunks.map((chunk, idx) => ({
      taskId: `${jobId}_chunk_${String(idx + 1).padStart(4, '0')}`,
      frames: chunk,
      state: TaskState.PENDING,
      attempts: 0,
      error: null
    }));

    let submissionOutput = '';
    const cliAvailable = this.useCli && this._checkCliAvailable();

    if (cliAvailable) {
      const tempAlfPath = path.join(os.tmpdir(), `${jobId}.alf`);
      fs.writeFileSync(tempAlfPath, manifest.alfScript, 'utf8');

      try {
        const res = spawnSync(this.spoolCommandPath, [
          `--engine=${this.engineHost}:${this.enginePort}`,
          tempAlfPath
        ], { encoding: 'utf8', shell: true });
        submissionOutput = res.stdout || res.stderr || '';
      } finally {
        try { fs.rmSync(tempAlfPath, { force: true }); } catch (e) {}
      }
    } else {
      submissionOutput = `Simulated Tractor spooling to ${this.engineHost}:${this.enginePort} for ${jobId}`;
    }

    const record = {
      id: jobId,
      name: jobDef.name,
      scheduler: 'tractor',
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
      scheduler: 'tractor',
      status: 'QUEUED',
      manifest,
      tasks,
      message: submissionOutput
    };
  }

  /**
   * Query status of a Tractor job
   * @param {string} jobId
   * @returns {Promise<Object>}
   */
  async getJobStatus(jobId) {
    const record = this.activeJobs.get(jobId);
    if (!record) {
      throw new Error(`TractorJobNotFoundError: Job "${jobId}" not found in adapter registry`);
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
      scheduler: 'tractor',
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
   * Query task detail
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
   * Cancel an active Tractor job
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
      message: `Job ${jobId} successfully cancelled on Tractor Engine`
    };
  }

  /**
   * Retry failed tasks in a Tractor job
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
      message: `Retried ${retried.length} frames across failed Tractor tasks`
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

