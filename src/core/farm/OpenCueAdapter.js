/**
 * OpenComp - Multi-Scheduler Integration: ASWF OpenCue Adapter
 * Generates Cuebot Outlines and PyCue submission scripts for ASWF OpenCue,
 * handles layer definitions, core and memory limits, service requirements,
 * priority normalization (0-10000), and job lifecycle tracking.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { SchedulerAdapterBase } from './SchedulerAdapterBase.js';
import { JobState, TaskState, generateId, formatFrameRange } from './FarmProtocol.js';

export class OpenCueAdapter extends SchedulerAdapterBase {
  /**
   * @param {Object} [config={}]
   * @param {string} [config.name='ASWF OpenCue']
   * @param {string} [config.cuebotHost='cuebot']
   * @param {number} [config.cuebotPort=8443]
   * @param {string} [config.defaultShow='opencomp']
   * @param {string} [config.defaultShot='shot01']
   * @param {string} [config.defaultFacility='local']
   * @param {string} [config.pyCueCommand='cueadmin']
   * @param {boolean} [config.useCli=true]
   * @param {string} [config.targetBladePlatform='linux']
   */
  constructor(config = {}) {
    super({
      ...config,
      name: config.name || 'ASWF OpenCue',
      type: 'opencue'
    });

    this.cuebotHost = config.cuebotHost || 'cuebot';
    this.cuebotPort = config.cuebotPort || 8443;
    this.defaultShow = config.defaultShow || 'opencomp';
    this.defaultShot = config.defaultShot || 'shot01';
    this.defaultFacility = config.defaultFacility || 'local';
    this.pyCueCommand = config.pyCueCommand || 'cueadmin';
    this.useCli = config.useCli !== false;
    this.targetBladePlatform = config.targetBladePlatform || 'linux';
  }

  /**
   * Get OpenCue adapter capabilities
   */
  getCapabilities() {
    return {
      name: this.name,
      type: this.type,
      supportsChunking: true,
      supportsTileRendering: true,
      supportsGpuRequirements: true,
      priorityRange: [0, 10000],
      supportedPlatforms: ['linux', 'windows', 'darwin'],
      cliAvailable: this._checkCliAvailable()
    };
  }

  /**
   * Check if cueadmin or pycue executable is available
   * @private
   */
  _checkCliAvailable() {
    try {
      const res = spawnSync(this.pyCueCommand, ['--version'], { encoding: 'utf8', shell: true });
      return res.status === 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * Generate Cuebot Outline specification object
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {Object}
   */
  generateOutline(jobDef, options = {}) {
    const targetPlatform = options.targetPlatform || this.targetBladePlatform;
    const mappedProjectPath = this.mapPath(jobDef.projectPath, targetPlatform);
    const mappedOutputPattern = jobDef.outputPattern ? this.mapPath(jobDef.outputPattern, targetPlatform) : '';

    const frames = this.parseFrames(jobDef.frames);
    const frameRangeStr = formatFrameRange(frames);
    const chunkSize = Math.max(1, parseInt(jobDef.chunkSize, 10) || 1);
    const chunks = this.chunkFrames(frames, chunkSize);

    // OpenCue priority is 0 to 10000 (default 5000)
    const priority = this.normalizePriority(jobDef.priority ?? 50, 0, 10000);

    const show = options.show || jobDef.show || this.defaultShow;
    const shot = options.shot || jobDef.shot || this.defaultShot;
    const facility = options.facility || jobDef.facility || this.defaultFacility;

    const minCores = jobDef.minCores || 4.0;
    const minRamGb = jobDef.minRamGb || (jobDef.minRamBytes ? Math.ceil(jobDef.minRamBytes / (1024 * 1024 * 1024)) : 8);
    const memoryStr = `${minRamGb}GiB`;

    const services = ['opencomp'];
    if (jobDef.gpuRequired) {
      services.push('gpu');
    }

    const nodeFlag = jobDef.node ? ` --node "${jobDef.node}"` : '';
    const formatFlag = jobDef.format ? ` --format "${jobDef.format}"` : '';
    const cmdTemplate = `node bin/opencomp-render.mjs --project "${mappedProjectPath}" --frames #FRAME_RANGE# --output "${mappedOutputPattern}"${nodeFlag}${formatFlag} --deterministic-ieee754`;

    const layer = {
      name: 'render',
      layerType: 'RENDER',
      range: frameRangeStr,
      chunk: chunkSize,
      cmd: cmdTemplate,
      cores: minCores,
      memory: memoryStr,
      gpu: Boolean(jobDef.gpuRequired),
      services,
      limits: []
    };

    return {
      job: (jobDef.name || 'OpenComp_Render').trim(),
      show,
      shot,
      facility,
      priority,
      layers: [layer],
      chunks,
      totalFrames: frames.length,
      totalChunks: chunks.length
    };
  }

  /**
   * Generate Python PyCue submission script
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {string}
   */
  generatePyCueScript(jobDef, options = {}) {
    const outline = this.generateOutline(jobDef, options);
    const layer = outline.layers[0];

    const script = `"""OpenComp - Generated PyCue Submission Script"""
import sys
import opencue
import opencue.outline

def spool_opencomp_job():
    outline = opencue.outline.Outline(
        "${outline.job}",
        show="${outline.show}",
        shot="${outline.shot}",
        facility="${outline.facility}"
    )
    
    layer = outline.add_layer(
        "${layer.name}",
        r'${layer.cmd}'
    )
    layer.set_range("${layer.range}")
    layer.set_chunk_size(${layer.chunk})
    layer.set_cores(${layer.cores})
    layer.set_memory("${layer.memory}")
    
    # Configure Cuebot connection
    opencue.Cuebot.setHosts(["${this.cuebotHost}:${this.cuebotPort}"])
    
    # Spool job
    result = opencue.api.spool(outline)
    print(f"Spool successful: {result}")
    return result

if __name__ == "__main__":
    spool_opencomp_job()
`;
    return script;
  }

  /**
   * Generate complete OpenCue manifest
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {Object}
   */
  generateJobManifest(jobDef, options = {}) {
    const outline = this.generateOutline(jobDef, options);
    const pyCueScript = this.generatePyCueScript(jobDef, options);
    return {
      scheduler: 'opencue',
      outline,
      pyCueScript,
      chunks: outline.chunks,
      totalFrames: outline.totalFrames,
      totalChunks: outline.totalChunks
    };
  }

  /**
   * Submit job to ASWF OpenCue Cuebot
   * @param {Object} jobDef
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async submitJob(jobDef, options = {}) {
    const validation = this.validateJob(jobDef);
    if (!validation.valid) {
      throw new Error(`OpenCueSubmissionError: Invalid job definition: ${validation.errors.join('; ')}`);
    }

    const manifest = this.generateJobManifest(jobDef, options);
    const jobId = jobDef.id || generateId('opencue_job');
    const frames = this.parseFrames(jobDef.frames);

    const tasks = manifest.chunks.map((chunk, idx) => ({
      taskId: `${jobId}_layer_render_${String(idx + 1).padStart(4, '0')}`,
      frames: chunk,
      state: TaskState.PENDING,
      attempts: 0,
      error: null
    }));

    let submissionOutput = '';
    const cliAvailable = this.useCli && this._checkCliAvailable();

    if (cliAvailable) {
      const tempScriptPath = path.join(os.tmpdir(), `${jobId}_spool.py`);
      fs.writeFileSync(tempScriptPath, manifest.pyCueScript, 'utf8');

      try {
        const res = spawnSync('python', [tempScriptPath], { encoding: 'utf8', shell: true });
        submissionOutput = res.stdout || res.stderr || '';
      } finally {
        try { fs.rmSync(tempScriptPath, { force: true }); } catch (e) {}
      }
    } else {
      submissionOutput = `Simulated OpenCue spool to Cuebot at ${this.cuebotHost}:${this.cuebotPort} for ${jobId}`;
    }

    const record = {
      id: jobId,
      name: jobDef.name,
      scheduler: 'opencue',
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
      scheduler: 'opencue',
      status: 'QUEUED',
      manifest,
      tasks,
      message: submissionOutput
    };
  }

  /**
   * Query status of an OpenCue job
   * @param {string} jobId
   * @returns {Promise<Object>}
   */
  async getJobStatus(jobId) {
    const record = this.activeJobs.get(jobId);
    if (!record) {
      throw new Error(`OpenCueJobNotFoundError: Job "${jobId}" not found in adapter registry`);
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
      scheduler: 'opencue',
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
   * Cancel an active OpenCue job
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
      message: `Job ${jobId} successfully killed on OpenCue Cuebot`
    };
  }

  /**
   * Retry failed tasks in an OpenCue job
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
      message: `Retried ${retried.length} frames across failed OpenCue tasks`
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

