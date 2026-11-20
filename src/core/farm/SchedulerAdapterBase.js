/**
 * OpenComp - Multi-Scheduler Integration: Base Scheduler Adapter
 * Defines the abstract interface and common utilities for render farm schedulers
 * (Deadline, Tractor, OpenCue, Native LAN).
 * 
 * Provides standardized priority normalization, frame chunking, path translation,
 * hardware capability reporting, and job lifecycle management.
 */

import {
  JobState,
  TaskState,
  generateId,
  validateJobDefinition,
  formatFrameRange
} from './FarmProtocol.js';
import { PipelineTokens } from '../PipelineTokens.js';

export class SchedulerAdapterBase {
  /**
   * @param {Object} [config={}]
   * @param {string} [config.name='BaseScheduler'] - Human-readable name
   * @param {string} [config.type='base'] - Machine-readable scheduler type
   * @param {Array<{windows: string, linux: string, name?: string}>} [config.pathMappings=[]] - Cross-platform storage rules
   * @param {PipelineTokens|null} [config.pipelineTokens=null] - Optional pipeline tokens resolver
   * @param {Object} [config.options={}] - Custom scheduler-specific settings
   */
  constructor(config = {}) {
    this.name = config.name || 'BaseScheduler';
    this.type = config.type || 'base';
    this.config = { ...config };
    this.pathMappings = Array.isArray(config.pathMappings) ? [...config.pathMappings] : [];
    this.pipelineTokens = config.pipelineTokens || new PipelineTokens({ pathMappings: this.pathMappings });
    this.activeJobs = new Map();
  }

  /**
   * Translate file paths between Windows UNC and Linux NFS/POSIX
   * @param {string} sourcePath
   * @param {'windows'|'linux'|'posix'} [targetPlatform='linux']
   * @returns {string}
   */
  mapPath(sourcePath, targetPlatform = 'linux') {
    if (!sourcePath || typeof sourcePath !== 'string') return '';
    if (this.pipelineTokens) {
      return this.pipelineTokens.mapPath(sourcePath, targetPlatform);
    }
    const target = targetPlatform === 'posix' ? 'linux' : targetPlatform;
    for (const rule of this.pathMappings) {
      const from = target === 'windows' ? rule.linux : rule.windows;
      const to = target === 'windows' ? rule.windows : rule.linux;
      if (from && to && sourcePath.startsWith(from)) {
        const rel = sourcePath.slice(from.length);
        const mapped = to + rel;
        return target === 'windows' ? mapped.replace(/\//g, '\\') : mapped.replace(/\\/g, '/');
      }
    }
    return target === 'windows' ? sourcePath.replace(/\//g, '\\') : sourcePath.replace(/\\/g, '/');
  }

  /**
   * Validates job definition against common requirements
   * @param {Object} jobDef
   * @returns {{valid: boolean, errors: string[]}}
   */
  validateJob(jobDef) {
    return validateJobDefinition(jobDef);
  }

  /**
   * Normalize OpenComp standard priority (0 to 100) to scheduler-specific range
   * @param {number} priority - Standard OpenComp priority (0-100)
   * @param {number} [minRange=0]
   * @param {number} [maxRange=100]
   * @returns {number}
   */
  normalizePriority(priority, minRange = 0, maxRange = 100) {
    const raw = typeof priority === 'number' ? priority : 50;
    const clamped = Math.min(100, Math.max(0, raw));
    const normalized = minRange + ((clamped / 100) * (maxRange - minRange));
    return Math.round(normalized);
  }

  /**
   * Decompose an array of sorted frames into chunks of size chunkSize
   * @param {number[]} frames
   * @param {number} [chunkSize=1]
   * @returns {Array<number[]>}
   */
  chunkFrames(frames, chunkSize = 1) {
    if (!Array.isArray(frames) || frames.length === 0) return [];
    const size = Math.max(1, parseInt(chunkSize, 10) || 1);
    const sorted = Array.from(new Set(frames)).sort((a, b) => a - b);
    const chunks = [];
    for (let i = 0; i < sorted.length; i += size) {
      chunks.push(sorted.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Parse frame specification into unique sorted integer array
   * @param {number[]|string} framesSpec
   * @returns {number[]}
   */
  parseFrames(framesSpec) {
    if (Array.isArray(framesSpec)) {
      return Array.from(new Set(framesSpec.map(f => parseInt(f, 10)).filter(f => !isNaN(f)))).sort((a, b) => a - b);
    }
    if (typeof framesSpec === 'string') {
      const frames = [];
      const parts = framesSpec.split(',').map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (part.includes('-')) {
          const [startStr, endStr] = part.split('-');
          const start = parseInt(startStr, 10);
          const end = parseInt(endStr, 10);
          if (!isNaN(start) && !isNaN(end)) {
            const low = Math.min(start, end);
            const high = Math.max(start, end);
            for (let f = low; f <= high; f++) frames.push(f);
          }
        } else {
          const single = parseInt(part, 10);
          if (!isNaN(single)) frames.push(single);
        }
      }
      return Array.from(new Set(frames)).sort((a, b) => a - b);
    }
    return [];
  }

  /**
   * Get scheduler capability report
   * @returns {{
   *   name: string,
   *   type: string,
   *   supportsChunking: boolean,
   *   supportsTileRendering: boolean,
   *   supportsGpuRequirements: boolean,
   *   priorityRange: [number, number],
   *   supportedPlatforms: string[]
   * }}
   */
  getCapabilities() {
    return {
      name: this.name,
      type: this.type,
      supportsChunking: true,
      supportsTileRendering: true,
      supportsGpuRequirements: true,
      priorityRange: [0, 100],
      supportedPlatforms: ['linux', 'windows', 'darwin']
    };
  }

  /**
   * Generate scheduler-specific submission manifest / script
   * @param {Object} jobDef - Standard OpenComp job definition
   * @param {Object} [options={}]
   * @returns {Object}
   * @abstract
   */
  generateJobManifest(jobDef, options = {}) {
    throw new Error(`generateJobManifest() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Submit a job to the scheduler
   * @param {Object} jobDef - Standard OpenComp job definition
   * @param {Object} [options={}]
   * @returns {Promise<{
   *   success: boolean,
   *   jobId: string,
   *   scheduler: string,
   *   status: string,
   *   manifest: Object,
   *   tasks: Array<Object>,
   *   message?: string
   * }>}
   * @abstract
   */
  async submitJob(jobDef, options = {}) {
    throw new Error(`submitJob() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Query status of an existing job
   * @param {string} jobId
   * @returns {Promise<{
   *   id: string,
   *   state: string,
   *   scheduler: string,
   *   progress: { percent: number, totalTasks: number, completedTasks: number, failedTasks: number },
   *   completedFrames: number[],
   *   failedFrames: number[],
   *   error?: string
   * }>}
   * @abstract
   */
  async getJobStatus(jobId) {
    throw new Error(`getJobStatus() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Query individual task status
   * @param {string} jobId
   * @param {string} taskId
   * @returns {Promise<Object>}
   * @abstract
   */
  async getTaskStatus(jobId, taskId) {
    throw new Error(`getTaskStatus() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Cancel or abort an active job
   * @param {string} jobId
   * @returns {Promise<{success: boolean, message: string}>}
   * @abstract
   */
  async cancelJob(jobId) {
    throw new Error(`cancelJob() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Retry failed frames or incomplete tasks in a job
   * @param {string} jobId
   * @param {Object} [options={}]
   * @returns {Promise<{success: boolean, retriedTasks: number[], message: string}>}
   * @abstract
   */
  async retryFailedTasks(jobId, options = {}) {
    throw new Error(`retryFailedTasks() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Fetch logs for a job or task
   * @param {string} jobId
   * @param {string} [taskId]
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  async getJobLogs(jobId, taskId = null) {
    return {
      stdout: `[${this.name}] Logs for job ${jobId}${taskId ? ` task ${taskId}` : ''}`,
      stderr: ''
    };
  }
}

