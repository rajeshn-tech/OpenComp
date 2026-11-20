/**
 * OpenComp - Multi-Scheduler Integration: Native LAN Queue Adapter
 * Adapts the built-in OpenComp Render Farm Core (LANDispatcher and JobQueue)
 * to the standardized SchedulerAdapterBase interface, enabling seamless switching
 * between third-party schedulers and zero-dependency local LAN dispatching.
 */

import { SchedulerAdapterBase } from './SchedulerAdapterBase.js';
import { LANDispatcher } from './LANDispatcher.js';
import { JobState, TaskState, formatFrameRange } from './FarmProtocol.js';

export class NativeLANAdapter extends SchedulerAdapterBase {
  /**
   * @param {Object} [config={}]
   * @param {string} [config.name='OpenComp Native LAN Queue']
   * @param {LANDispatcher|null} [config.dispatcher=null]
   * @param {string} [config.host='127.0.0.1']
   * @param {number} [config.port=8088]
   * @param {string|null} [config.authSecret=null]
   */
  constructor(config = {}) {
    super({
      ...config,
      name: config.name || 'OpenComp Native LAN Queue',
      type: 'native_lan'
    });

    this.dispatcher = config.dispatcher || new LANDispatcher({
      host: config.host || '127.0.0.1',
      port: config.port !== undefined ? config.port : 8088,
      authSecret: config.authSecret || null
    });
  }

  /**
   * Get Native LAN adapter capabilities
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
      isNative: true
    };
  }

  /**
   * Generate Native LAN job manifest
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {Object}
   */
  generateJobManifest(jobDef, options = {}) {
    const frames = this.parseFrames(jobDef.frames);
    const chunkSize = Math.max(1, parseInt(jobDef.chunkSize, 10) || 1);
    const chunks = this.chunkFrames(frames, chunkSize);
    const priority = this.normalizePriority(jobDef.priority ?? 50, 0, 100);

    return {
      scheduler: 'native_lan',
      jobDefinition: {
        ...jobDef,
        frames,
        chunkSize,
        priority
      },
      chunks,
      totalFrames: frames.length,
      totalChunks: chunks.length
    };
  }

  /**
   * Submit job to Native LAN dispatcher queue
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async submitJob(jobDef, options = {}) {
    const validation = this.validateJob(jobDef);
    if (!validation.valid) {
      throw new Error(`NativeLANSubmissionError: Invalid job definition: ${validation.errors.join('; ')}`);
    }

    const manifest = this.generateJobManifest(jobDef, options);
    const rawJob = this.dispatcher.queue.submitJob({
      ...manifest.jobDefinition,
      id: jobDef.id
    });

    const tasks = Array.from(rawJob.tasks.values()).map(t => ({
      taskId: t.id,
      frames: t.frames,
      state: t.state,
      attempts: t.attempts,
      error: t.error
    }));

    return {
      success: true,
      jobId: rawJob.id,
      scheduler: 'native_lan',
      status: rawJob.state,
      manifest,
      tasks,
      message: `Job ${rawJob.id} submitted to Native LAN queue`
    };
  }

  /**
   * Query status of an existing Native LAN job
   * @param {string} jobId
   * @returns {Promise<Object>}
   */
  async getJobStatus(jobId) {
    const rawJob = this.dispatcher.queue.getJob(jobId);
    if (!rawJob) {
      throw new Error(`NativeLANJobNotFoundError: Job "${jobId}" not found in LAN queue`);
    }

    const progress = rawJob.getProgress();
    const completedFrames = [];
    const failedFrames = [];

    for (const t of rawJob.tasks.values()) {
      if (t.state === TaskState.COMPLETED) {
        completedFrames.push(...t.frames);
      } else if (t.state === TaskState.FAILED) {
        failedFrames.push(...t.frames);
      }
    }

    return {
      id: rawJob.id,
      name: rawJob.name,
      state: rawJob.state,
      scheduler: 'native_lan',
      progress: {
        percent: progress.percent,
        totalTasks: progress.totalTasks,
        completedTasks: progress.completedTasks,
        failedTasks: progress.failedTasks,
        pendingTasks: progress.pendingTasks
      },
      completedFrames: completedFrames.sort((a, b) => a - b),
      failedFrames: failedFrames.sort((a, b) => a - b),
      error: rawJob.error
    };
  }

  /**
   * Query individual task detail
   * @param {string} jobId
   * @param {string} taskId
   * @returns {Promise<Object>}
   */
  async getTaskStatus(jobId, taskId) {
    const rawJob = this.dispatcher.queue.getJob(jobId);
    if (!rawJob) throw new Error(`Job "${jobId}" not found`);
    const task = rawJob.tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found in job "${jobId}"`);
    return task.toJSON();
  }

  /**
   * Cancel an active Native LAN job
   * @param {string} jobId
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async cancelJob(jobId) {
    const success = this.dispatcher.queue.cancelJob(jobId);
    if (!success) {
      throw new Error(`Failed to cancel job "${jobId}" in LAN queue`);
    }
    return {
      success: true,
      message: `Job ${jobId} successfully marked CANCELLED in LAN queue`
    };
  }

  /**
   * Retry failed tasks in a Native LAN job
   * @param {string} jobId
   * @param {Object} [options={}]
   * @returns {Promise<{success: boolean, retriedTasks: number[], message: string}>}
   */
  async retryFailedTasks(jobId, options = {}) {
    const rawJob = this.dispatcher.queue.getJob(jobId);
    if (!rawJob) throw new Error(`Job "${jobId}" not found`);

    const retried = [];
    for (const task of rawJob.tasks.values()) {
      if (task.state === TaskState.FAILED) {
        task.state = TaskState.PENDING;
        task.attempts = 0;
        task.error = null;
        task.workerId = null;
        retried.push(...task.frames);
      }
    }

    if (retried.length > 0) {
      rawJob.state = JobState.QUEUED;
    }

    return {
      success: true,
      retriedTasks: retried,
      message: `Retried ${retried.length} frames across failed Native LAN tasks`
    };
  }
}

