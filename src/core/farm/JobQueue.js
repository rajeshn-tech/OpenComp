/**
 * OpenComp - Render Farm Job & Task Queue Engine
 * Handles job validation, priority-based scheduling, frame-range splitting,
 * state machine transitions, retry on failure, and job resumption.
 */

import path from 'node:path';
import { parseFrameRange } from '../../../bin/opencomp-render.mjs';
import {
  JobState,
  TaskState,
  generateId,
  validateJobDefinition,
  formatFrameRange
} from './FarmProtocol.js';

/**
 * Discrete chunk of frames assigned to a single worker
 */
export class RenderTask {
  /**
   * @param {Object} options
   * @param {string} options.id
   * @param {string} options.jobId
   * @param {number[]} options.frames
   * @param {number} [options.maxAttempts=3]
   */
  constructor(options) {
    this.id = options.id || generateId('task');
    this.jobId = options.jobId;
    this.frames = [...options.frames];
    this.state = TaskState.PENDING;
    this.workerId = null;
    this.attempts = 0;
    this.maxAttempts = options.maxAttempts || 3;
    this.assignedAt = null;
    this.startedAt = null;
    this.completedAt = null;
    this.durationMs = 0;
    this.error = null;
    this.outputFiles = [];
    this.progress = { currentFrame: null, percent: 0 };
  }

  /**
   * Safe serialization of task status
   */
  toJSON() {
    return {
      id: this.id,
      jobId: this.jobId,
      frames: this.frames,
      frameRangeString: formatFrameRange(this.frames),
      state: this.state,
      workerId: this.workerId,
      attempts: this.attempts,
      maxAttempts: this.maxAttempts,
      assignedAt: this.assignedAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      durationMs: this.durationMs,
      error: this.error,
      outputFiles: this.outputFiles,
      progress: this.progress
    };
  }
}

/**
 * Complete batch render job definition and task collection
 */
export class RenderJob {
  /**
   * @param {Object} jobDef
   */
  constructor(jobDef) {
    this.id = jobDef.id || generateId('job');
    this.name = jobDef.name.trim();
    this.projectPath = path.resolve(jobDef.projectPath);
    this.outputPattern = jobDef.outputPattern || null;
    this.chunkSize = Math.max(1, parseInt(jobDef.chunkSize, 10) || 1);
    this.priority = Math.min(100, Math.max(0, parseInt(jobDef.priority, 10) || 50));
    this.tokens = jobDef.tokens ? { ...jobDef.tokens } : {};
    this.node = jobDef.node || null;
    this.format = jobDef.format || null;
    this.compression = jobDef.compression || null;
    this.bitdepth = jobDef.bitdepth || 'float32';
    this.quality = jobDef.quality || 45.0;
    this.colorspace = jobDef.colorspace || null;
    this.ocio = jobDef.ocio || null;
    this.maxRetries = jobDef.maxRetries !== undefined ? parseInt(jobDef.maxRetries, 10) : 3;

    // Parse frames into unique sorted integers
    if (Array.isArray(jobDef.frames)) {
      this.frames = Array.from(new Set(jobDef.frames.map(f => parseInt(f, 10)))).sort((a, b) => a - b);
    } else {
      this.frames = parseFrameRange(jobDef.frames);
    }

    this.state = JobState.QUEUED;
    this.tasks = new Map();
    this.createdAt = Date.now();
    this.startedAt = null;
    this.finishedAt = null;
    this.error = null;

    // Generate task chunks
    this.splitTasks();
  }

  /**
   * Partition frame range into discrete task chunks based on chunkSize
   */
  splitTasks() {
    this.tasks.clear();
    const count = this.frames.length;
    let taskIdx = 1;

    for (let i = 0; i < count; i += this.chunkSize) {
      const chunkFrames = this.frames.slice(i, i + this.chunkSize);
      const taskId = `${this.id}_task_${String(taskIdx++).padStart(4, '0')}`;
      const task = new RenderTask({
        id: taskId,
        jobId: this.id,
        frames: chunkFrames,
        maxAttempts: this.maxRetries
      });
      this.tasks.set(taskId, task);
    }
  }

  /**
   * Calculate current aggregate job progress
   */
  getProgress() {
    let completedCount = 0;
    let failedCount = 0;
    let runningCount = 0;
    let pendingCount = 0;
    let assignedCount = 0;
    const completedFrames = [];
    const failedFrames = [];

    for (const task of this.tasks.values()) {
      if (task.state === TaskState.COMPLETED) {
        completedCount++;
        completedFrames.push(...task.frames);
      } else if (task.state === TaskState.FAILED) {
        failedCount++;
        failedFrames.push(...task.frames);
      } else if (task.state === TaskState.RUNNING) {
        runningCount++;
      } else if (task.state === TaskState.ASSIGNED) {
        assignedCount++;
      } else {
        pendingCount++;
      }
    }

    const totalTasks = this.tasks.size;
    const totalFrames = this.frames.length;
    const percent = totalFrames > 0 ? (completedFrames.length / totalFrames) * 100 : 0;

    return {
      totalTasks,
      completedTasks: completedCount,
      failedTasks: failedCount,
      runningTasks: runningCount,
      pendingTasks: pendingCount,
      assignedTasks: assignedCount,
      totalFrames,
      completedFramesCount: completedFrames.length,
      failedFramesCount: failedFrames.length,
      percent: Math.round(percent * 10) / 10,
      isComplete: completedCount === totalTasks,
      hasFailed: failedCount > 0
    };
  }

  /**
   * Returns list of frames not yet successfully completed
   * @returns {number[]}
   */
  getUnfinishedFrames() {
    const finished = new Set();
    for (const task of this.tasks.values()) {
      if (task.state === TaskState.COMPLETED) {
        for (const f of task.frames) finished.add(f);
      }
    }
    return this.frames.filter(f => !finished.has(f));
  }

  /**
   * Serialized summary representation
   */
  toSummary() {
    const progress = this.getProgress();
    return {
      id: this.id,
      name: this.name,
      projectPath: this.projectPath,
      outputPattern: this.outputPattern,
      state: this.state,
      priority: this.priority,
      chunkSize: this.chunkSize,
      totalFrames: this.frames.length,
      frameRangeString: formatFrameRange(this.frames),
      progress,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      error: this.error
    };
  }
}

/**
 * In-memory thread-safe priority render job queue
 */
export class JobQueue {
  constructor(options = {}) {
    this.jobs = new Map();
    this.preventDuplicates = options.preventDuplicates !== false;
  }

  /**
   * Submit a new job to the queue
   * @param {Object} jobDef
   * @returns {RenderJob}
   */
  submitJob(jobDef) {
    const { valid, errors } = validateJobDefinition(jobDef);
    if (!valid) {
      throw new Error(`JobValidationError: ${errors.join('; ')}`);
    }

    const normProject = path.resolve(jobDef.projectPath);

    // Duplicate check: prevent submitting duplicate active job with same name and project
    if (this.preventDuplicates) {
      for (const existing of this.jobs.values()) {
        const isActive = existing.state === JobState.QUEUED || existing.state === JobState.RUNNING || existing.state === JobState.PENDING;
        if (isActive && existing.name === jobDef.name.trim() && existing.projectPath === normProject) {
          throw new Error(`DuplicateJobError: An active job with name "${jobDef.name}" and project "${normProject}" is already queued (ID: ${existing.id})`);
        }
      }
    }

    const job = new RenderJob(jobDef);
    this.jobs.set(job.id, job);
    return job;
  }

  /**
   * Get job by ID
   * @param {string} jobId
   * @returns {RenderJob|null}
   */
  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * List all jobs, optionally filtered by state
   * @param {Object} [filter={}]
   * @returns {Object[]} Array of job summaries
   */
  listJobs(filter = {}) {
    let list = Array.from(this.jobs.values());
    if (filter.state) {
      list = list.filter(j => j.state === filter.state);
    }
    // Sort by priority descending, then createdAt ascending
    list.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    return list.map(j => j.toSummary());
  }

  /**
   * Cancel an active or queued job
   * @param {string} jobId
   * @param {string} [reason='Cancelled by operator']
   * @returns {boolean}
   */
  cancelJob(jobId, reason = 'Cancelled by operator') {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.state === JobState.COMPLETED || job.state === JobState.CANCELLED) {
      return false;
    }

    job.state = JobState.CANCELLED;
    job.finishedAt = Date.now();
    job.error = reason;

    for (const task of job.tasks.values()) {
      if (task.state === TaskState.PENDING || task.state === TaskState.ASSIGNED) {
        task.state = TaskState.CANCELLED;
      }
    }

    return true;
  }

  /**
   * Get next pending task across all queued/running jobs
   * @param {Object} [workerCapabilities=null]
   * @returns {{job: RenderJob, task: RenderTask}|null}
   */
  getNextPendingTask(workerCapabilities = null) {
    // Sort active jobs by priority (descending), then createdAt (ascending)
    const activeJobs = Array.from(this.jobs.values())
      .filter(j => j.state === JobState.QUEUED || j.state === JobState.RUNNING)
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

    for (const job of activeJobs) {
      for (const task of job.tasks.values()) {
        if (task.state === TaskState.PENDING) {
          task.state = TaskState.ASSIGNED;
          task.assignedAt = Date.now();
          if (job.state === JobState.QUEUED) {
            job.state = JobState.RUNNING;
            if (!job.startedAt) job.startedAt = Date.now();
          }
          return { job, task };
        }
      }
    }

    return null;
  }

  /**
   * Mark a task as actively running
   * @param {string} taskId
   * @param {string} workerId
   */
  markTaskStarted(taskId, workerId) {
    for (const job of this.jobs.values()) {
      const task = job.tasks.get(taskId);
      if (task) {
        task.state = TaskState.RUNNING;
        task.workerId = workerId;
        task.startedAt = Date.now();
        task.attempts++;
        return true;
      }
    }
    return false;
  }

  /**
   * Update intermediate task progress
   * @param {string} taskId
   * @param {Object} progress
   */
  markTaskProgress(taskId, progress) {
    for (const job of this.jobs.values()) {
      const task = job.tasks.get(taskId);
      if (task) {
        task.progress = { ...task.progress, ...progress };
        return true;
      }
    }
    return false;
  }

  /**
   * Mark a task as completed successfully
   * @param {string} taskId
   * @param {Object} [result={}]
   */
  markTaskComplete(taskId, result = {}) {
    for (const job of this.jobs.values()) {
      const task = job.tasks.get(taskId);
      if (task) {
        task.state = TaskState.COMPLETED;
        task.completedAt = Date.now();
        task.durationMs = task.startedAt ? (task.completedAt - task.startedAt) : 0;
        task.outputFiles = result.outputFiles || [];
        task.progress.percent = 100;

        // Check if all tasks in job are finished
        const progress = job.getProgress();
        if (progress.isComplete) {
          job.state = JobState.COMPLETED;
          job.finishedAt = Date.now();
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Mark a task as failed and trigger automated retry if attempts remain
   * @param {string} taskId
   * @param {string} error
   * @returns {{retried: boolean, task: RenderTask|null}}
   */
  markTaskFailed(taskId, error) {
    for (const job of this.jobs.values()) {
      const task = job.tasks.get(taskId);
      if (task) {
        task.error = error;
        task.workerId = null;

        if (task.attempts < task.maxAttempts) {
          // Re-queue for another attempt
          task.state = TaskState.PENDING;
          task.assignedAt = null;
          task.startedAt = null;
          return { retried: true, task };
        } else {
          // Max attempts reached: mark failed
          task.state = TaskState.FAILED;
          task.completedAt = Date.now();

          job.state = JobState.FAILED;
          job.finishedAt = Date.now();
          job.error = `Task ${taskId} failed permanently: ${error}`;
          return { retried: false, task };
        }
      }
    }
    return { retried: false, task: null };
  }

  /**
   * Reassign all active tasks belonging to a dead or disconnected worker
   * @param {string} workerId
   * @param {string} [reason='Worker disconnected']
   * @returns {number} Count of reassigned tasks
   */
  reassignWorkerTasks(workerId, reason = 'Worker disconnected') {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.state !== JobState.RUNNING && job.state !== JobState.QUEUED) continue;
      for (const task of job.tasks.values()) {
        if (task.workerId === workerId && (task.state === TaskState.ASSIGNED || task.state === TaskState.RUNNING)) {
          task.state = TaskState.PENDING;
          task.workerId = null;
          task.assignedAt = null;
          task.startedAt = null;
          task.error = `Requeued: ${reason}`;
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Resume an incomplete, failed, or cancelled job by re-queuing only unrendered frames
   * @param {string} jobId
   * @returns {RenderJob}
   */
  resumeJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`JobNotFoundError: Cannot resume non-existent job "${jobId}"`);
    }

    const unfinished = job.getUnfinishedFrames();
    if (unfinished.length === 0) {
      job.state = JobState.COMPLETED;
      return job;
    }

    // Reset failed/cancelled tasks that did not complete
    for (const task of job.tasks.values()) {
      if (task.state === TaskState.FAILED || task.state === TaskState.CANCELLED || task.state === TaskState.ASSIGNED) {
        task.state = TaskState.PENDING;
        task.workerId = null;
        task.error = null;
        task.attempts = 0;
      }
    }

    job.state = JobState.QUEUED;
    job.finishedAt = null;
    job.error = null;
    return job;
  }
}
