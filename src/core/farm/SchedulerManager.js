/**
 * OpenComp - Multi-Scheduler Integration: Unified Scheduler Manager
 * Central orchestrator managing Deadline, Tractor, OpenCue, and Native LAN dispatchers.
 * 
 * Provides:
 * 1. Unified scheduler registration and selection.
 * 2. Resource-aware worker capability filtering (CPU cores, RAM, GPU/VRAM, OS, tags).
 * 3. Cross-platform storage and PipelineTokens path translation.
 * 4. Output integrity validation (OpenEXR/PNG headers, non-zero size).
 * 5. Incomplete-frame detection and targeted recovery.
 * 6. Duplicate job / frame clash prevention.
 * 7. Local rendering fallback.
 */

import path from 'node:path';
import fs from 'node:fs';

import { PipelineTokens } from '../PipelineTokens.js';
import {
  JobState,
  TaskState,
  generateId,
  validateJobDefinition,
  verifyOutputIntegrity,
  formatFrameRange
} from './FarmProtocol.js';

import { SchedulerAdapterBase } from './SchedulerAdapterBase.js';
import { DeadlineAdapter } from './DeadlineAdapter.js';
import { TractorAdapter } from './TractorAdapter.js';
import { OpenCueAdapter } from './OpenCueAdapter.js';
import { NativeLANAdapter } from './NativeLANAdapter.js';
import { renderBatch } from '../../../bin/opencomp-render.mjs';

export class SchedulerManager {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.defaultScheduler='native_lan']
   * @param {Array<{windows: string, linux: string, name?: string}>} [options.pathMappings=[]]
   * @param {PipelineTokens|null} [options.pipelineTokens=null]
   * @param {boolean} [options.preventDuplicates=true]
   */
  constructor(options = {}) {
    this.adapters = new Map();
    this.defaultScheduler = options.defaultScheduler || 'native_lan';
    this.pathMappings = Array.isArray(options.pathMappings) ? [...options.pathMappings] : [];
    this.pipelineTokens = options.pipelineTokens || new PipelineTokens({ pathMappings: this.pathMappings });
    this.preventDuplicates = options.preventDuplicates !== false;
    this.jobs = new Map();

    // Register standard adapters
    this.registerAdapter('deadline', new DeadlineAdapter({
      pathMappings: this.pathMappings,
      pipelineTokens: this.pipelineTokens
    }));
    this.registerAdapter('tractor', new TractorAdapter({
      pathMappings: this.pathMappings,
      pipelineTokens: this.pipelineTokens
    }));
    this.registerAdapter('opencue', new OpenCueAdapter({
      pathMappings: this.pathMappings,
      pipelineTokens: this.pipelineTokens
    }));
    this.registerAdapter('native_lan', new NativeLANAdapter({
      pathMappings: this.pathMappings,
      pipelineTokens: this.pipelineTokens
    }));
  }

  /**
   * Register a scheduler adapter
   * @param {string} name
   * @param {SchedulerAdapterBase} adapter
   */
  registerAdapter(name, adapter) {
    if (!adapter || !(adapter instanceof SchedulerAdapterBase)) {
      throw new TypeError(`Invalid adapter for "${name}": must extend SchedulerAdapterBase`);
    }
    this.adapters.set(name.toLowerCase(), adapter);
  }

  /**
   * Retrieve registered adapter by type name
   * @param {string} name
   * @returns {SchedulerAdapterBase|null}
   */
  getAdapter(name) {
    if (!name) return this.adapters.get(this.defaultScheduler) || null;
    return this.adapters.get(name.toLowerCase()) || null;
  }

  /**
   * List all registered schedulers and their capabilities
   * @returns {Array<{id: string, capabilities: Object}>}
   */
  listSchedulers() {
    const list = [];
    for (const [id, adapter] of this.adapters.entries()) {
      list.push({
        id,
        capabilities: adapter.getCapabilities()
      });
    }
    return list;
  }

  /**
   * Set default scheduler
   * @param {string} name
   */
  setDefaultScheduler(name) {
    const key = name.toLowerCase();
    if (!this.adapters.has(key)) {
      throw new Error(`Cannot set default scheduler: "${name}" is not registered`);
    }
    this.defaultScheduler = key;
  }

  /**
   * Filter compute workers based on job hardware requirements
   * (Resource-Aware Scheduling)
   * @param {Array<Object>} workers - Array of worker capability reports or Worker instances
   * @param {Object} [requirements={}]
   * @param {number} [requirements.minCores=1]
   * @param {number} [requirements.minRamBytes=0]
   * @param {boolean} [requirements.gpuRequired=false]
   * @param {number} [requirements.minVramBytes=0]
   * @param {string[]} [requirements.requiredTags=[]]
   * @param {string|null} [requirements.targetPlatform=null]
   * @returns {Array<Object>} - Filtered list of matching workers
   */
  filterCompatibleWorkers(workers, requirements = {}) {
    if (!Array.isArray(workers)) return [];

    const minCores = requirements.minCores || 1;
    const minRam = requirements.minRamBytes || 0;
    const gpuRequired = Boolean(requirements.gpuRequired);
    const minVram = requirements.minVramBytes || 0;
    const requiredTags = Array.isArray(requirements.requiredTags) ? requirements.requiredTags : [];
    const targetPlatform = requirements.targetPlatform || null;

    return workers.filter((w) => {
      // Normalise worker object (could be Worker instance or capabilities dict)
      const caps = typeof w.getCapabilities === 'function' ? w.getCapabilities() : w;

      // 1. CPU cores check
      if (caps.cpuCores < minCores) return false;

      // 2. RAM check
      if (minRam > 0 && caps.ramTotal < minRam) return false;

      // 3. GPU device requirement
      if (gpuRequired) {
        if (!caps.gpuDevice) return false; // Reject pure CPU blades
        if (minVram > 0 && (!caps.vramBytes || caps.vramBytes < minVram)) return false;
      }

      // 4. Platform check
      if (targetPlatform && caps.osPlatform && caps.osPlatform !== targetPlatform) {
        return false;
      }

      // 5. Tags check
      if (requiredTags.length > 0) {
        const workerTags = new Set(caps.tags || []);
        for (const reqTag of requiredTags) {
          if (!workerTags.has(reqTag)) return false;
        }
      }

      return true;
    });
  }

  /**
   * Checks for duplicate active jobs with overlapping frames and identical output
   * @param {Object} jobDef
   * @returns {{duplicate: boolean, existingJobId?: string}}
   */
  checkDuplicateJob(jobDef) {
    if (!this.preventDuplicates || !jobDef.outputPattern) {
      return { duplicate: false };
    }

    const adapter = this.getAdapter();
    const newFrames = new Set(adapter.parseFrames(jobDef.frames));

    for (const [id, rec] of this.jobs.entries()) {
      if (rec.state === JobState.QUEUED || rec.state === JobState.RUNNING) {
        if (rec.outputPattern === jobDef.outputPattern && rec.projectPath === jobDef.projectPath) {
          const overlap = rec.frames.some(f => newFrames.has(f));
          if (overlap) {
            return { duplicate: true, existingJobId: id };
          }
        }
      }
    }

    return { duplicate: false };
  }

  /**
   * Submit a job to the render farm
   * @param {Object} jobDef - Job definition
   * @param {string|null} [schedulerType=null] - Schedular target ('deadline', 'tractor', 'opencue', 'native_lan')
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async submitJob(jobDef, schedulerType = null, options = {}) {
    const targetType = (schedulerType || this.defaultScheduler).toLowerCase();
    const adapter = this.getAdapter(targetType);
    if (!adapter) {
      throw new Error(`Scheduler "${targetType}" is not registered`);
    }

    // 1. Validate job definition
    const validation = adapter.validateJob(jobDef);
    if (!validation.valid) {
      throw new Error(`JobValidationError: ${validation.errors.join('; ')}`);
    }

    // 2. Check duplicate jobs
    if (!options.allowDuplicate) {
      const dup = this.checkDuplicateJob(jobDef);
      if (dup.duplicate) {
        throw new Error(`DuplicateJobError: An active job (${dup.existingJobId}) is already rendering overlapping frames for this output pattern`);
      }
    }

    // 3. Resolve pipeline tokens in job parameters if provided
    let resolvedJobDef = { ...jobDef };
    if (this.pipelineTokens && jobDef.tokens) {
      this.pipelineTokens.setTokens(jobDef.tokens);
    }

    // Parse frames
    const frames = adapter.parseFrames(jobDef.frames);
    resolvedJobDef.frames = frames;

    // 4. Submit to target adapter
    const result = await adapter.submitJob(resolvedJobDef, options);

    // 5. Store in unified registry
    this.jobs.set(result.jobId, {
      id: result.jobId,
      name: jobDef.name,
      scheduler: targetType,
      projectPath: jobDef.projectPath,
      outputPattern: jobDef.outputPattern,
      frames,
      state: result.status || JobState.QUEUED,
      adapter,
      createdAt: Date.now()
    });

    return {
      ...result,
      scheduler: targetType
    };
  }

  /**
   * Query status of any job across all schedulers
   * @param {string} jobId
   * @returns {Promise<Object>}
   */
  async getJobStatus(jobId) {
    const record = this.jobs.get(jobId);
    if (!record) {
      // Try querying each adapter directly
      for (const adapter of this.adapters.values()) {
        try {
          return await adapter.getJobStatus(jobId);
        } catch (e) {}
      }
      throw new Error(`JobNotFoundError: Job "${jobId}" not found in any registered scheduler`);
    }

    const status = await record.adapter.getJobStatus(jobId);
    record.state = status.state;
    return status;
  }

  /**
   * Cancel an active job
   * @param {string} jobId
   * @returns {Promise<Object>}
   */
  async cancelJob(jobId) {
    const record = this.jobs.get(jobId);
    if (!record) {
      throw new Error(`Job "${jobId}" not found`);
    }
    const res = await record.adapter.cancelJob(jobId);
    record.state = JobState.CANCELLED;
    return res;
  }

  /**
   * Validate integrity of rendered output files on disk
   * @param {string[]} filePaths
   * @param {Object} [options={}]
   * @returns {{
   *   valid: boolean,
   *   totalFiles: number,
   *   validFiles: string[],
   *   corruptFiles: Array<{path: string, error: string}>,
   *   missingFiles: string[]
   * }}
   */
  validateOutputs(filePaths, options = {}) {
    if (!Array.isArray(filePaths)) {
      return { valid: false, totalFiles: 0, validFiles: [], corruptFiles: [], missingFiles: [] };
    }

    const validFiles = [];
    const corruptFiles = [];
    const missingFiles = [];

    for (const fp of filePaths) {
      if (!fs.existsSync(fp)) {
        missingFiles.push(fp);
        continue;
      }
      const check = verifyOutputIntegrity(fp, options);
      if (check.valid) {
        validFiles.push(fp);
      } else {
        corruptFiles.push({ path: fp, error: check.error || 'Integrity check failed' });
      }
    }

    return {
      valid: missingFiles.length === 0 && corruptFiles.length === 0,
      totalFiles: filePaths.length,
      validFiles,
      corruptFiles,
      missingFiles
    };
  }

  /**
   * Inspect output sequence on disk and return array of missing or corrupt frame numbers
   * (Incomplete-Frame Recovery)
   * @param {number[]} expectedFrames
   * @param {string} outputPattern - e.g. "/path/to/shot.####.exr"
   * @param {Object} [tokens={}]
   * @returns {{missingFrames: number[], corruptFrames: number[], intactFrames: number[]}}
   */
  findIncompleteFrames(expectedFrames, outputPattern, tokens = {}) {
    if (!Array.isArray(expectedFrames) || !outputPattern) {
      return { missingFrames: [], corruptFrames: [], intactFrames: [] };
    }

    const missingFrames = [];
    const corruptFrames = [];
    const intactFrames = [];

    for (const frame of expectedFrames) {
      let resolvedPath = outputPattern;
      if (this.pipelineTokens) {
        resolvedPath = this.pipelineTokens.resolve(outputPattern, { ...tokens, frame });
      } else {
        resolvedPath = outputPattern.replace(/####/g, String(frame).padStart(4, '0'));
      }

      if (!fs.existsSync(resolvedPath)) {
        missingFrames.push(frame);
      } else {
        const check = verifyOutputIntegrity(resolvedPath);
        if (check.valid) {
          intactFrames.push(frame);
        } else {
          corruptFrames.push(frame);
        }
      }
    }

    return {
      missingFrames,
      corruptFrames,
      intactFrames
    };
  }

  /**
   * Resubmit only missing and corrupted frames for an existing job
   * @param {string} jobId
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async recoverIncompleteJob(jobId, options = {}) {
    const record = this.jobs.get(jobId);
    if (!record) {
      throw new Error(`Cannot recover job "${jobId}": record not found`);
    }

    const incomplete = this.findIncompleteFrames(record.frames, record.outputPattern, options.tokens || {});
    const framesToRender = Array.from(new Set([...incomplete.missingFrames, ...incomplete.corruptFrames])).sort((a, b) => a - b);

    if (framesToRender.length === 0) {
      return {
        recovered: false,
        message: 'All expected frames exist and pass output integrity validation',
        framesToRender: []
      };
    }

    const recoveryJobDef = {
      name: `${record.name}_Recovery_${Date.now()}`,
      projectPath: record.projectPath,
      outputPattern: record.outputPattern,
      frames: framesToRender,
      chunkSize: options.chunkSize || 1,
      priority: Math.min(100, (options.priority || 60) + 10), // Boost priority for recovery
      comment: `Automated recovery of missing frames: ${formatFrameRange(framesToRender)}`
    };

    const result = await this.submitJob(recoveryJobDef, record.scheduler, { allowDuplicate: true });

    return {
      recovered: true,
      recoveryJobId: result.jobId,
      scheduler: record.scheduler,
      framesToRender,
      missingCount: incomplete.missingFrames.length,
      corruptCount: incomplete.corruptFrames.length
    };
  }

  /**
   * Fallback to local rendering when external scheduler is unavailable
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {Promise<{success: boolean, renderedFiles: string[], durationMs: number}>}
   */
  async fallbackToLocal(jobDef, options = {}) {
    const frames = this.getAdapter().parseFrames(jobDef.frames);
    const start = performance.now();

    const renderOpts = {
      project: jobDef.projectPath,
      frames,
      output: jobDef.outputPattern,
      node: jobDef.node || null,
      format: jobDef.format || null,
      compression: jobDef.compression || null,
      bitdepth: jobDef.bitdepth || 'float32',
      quality: jobDef.quality || 45.0,
      colorspace: jobDef.colorspace || null,
      ocio: jobDef.ocio || null
    };

    const batchRes = await renderBatch(renderOpts);
    const durationMs = Math.round(performance.now() - start);

    return {
      success: true,
      mode: 'local_fallback',
      renderedFiles: batchRes.renderedFiles || [],
      framesRendered: batchRes.framesRendered || 0,
      durationMs
    };
  }
}
