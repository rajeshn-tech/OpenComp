/**
 * OpenComp - Render Farm Worker Node Implementation
 * Handles worker identity, hardware capability discovery, heartbeat,
 * headless rendering execution via opencomp-render, and output integrity validation.
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import {
  WorkerState,
  generateId,
  verifyOutputIntegrity
} from './FarmProtocol.js';
import { renderBatch, formatSequencePath } from '../../../bin/opencomp-render.mjs';

/**
 * Worker node representing a compute blade or local rendering process
 */
export class Worker {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.id]
   * @param {string} [options.name]
   * @param {string} [options.host]
   * @param {number} [options.port]
   * @param {string|null} [options.gpuDevice=null] - Optional GPU renderer string (CPU-first: null supported)
   * @param {number|null} [options.vramBytes=null] - Optional VRAM in bytes
   * @param {string[]} [options.tags=[]]
   * @param {'in-process'|'subprocess'} [options.executionMode='in-process']
   */
  constructor(options = {}) {
    this.id = options.id || generateId(`worker_${os.hostname().toLowerCase()}`);
    this.name = options.name || `${os.hostname()}-Blade`;
    this.host = options.host || '127.0.0.1';
    this.port = options.port || null;
    this.state = WorkerState.IDLE;
    this.executionMode = options.executionMode || 'in-process';

    // Hardware capabilities
    this.cpuCores = os.cpus().length;
    this.cpuModel = os.cpus()[0]?.model || 'Generic CPU';
    this.ramTotal = os.totalmem();
    this.ramFree = os.freemem();
    this.gpuDevice = options.gpuDevice || null; // Null indicates pure CPU blade
    this.vramBytes = options.vramBytes || null;
    this.osPlatform = process.platform;
    this.osRelease = os.release();
    this.osArch = process.arch;
    this.runtimeVersion = process.version;
    this.opencompVersion = '1.3.1';
    this.tags = Array.isArray(options.tags) ? [...options.tags] : ['cpu', 'openexr'];

    this.currentTask = null;
    this.lastHeartbeat = Date.now();
    this.consecutiveFailures = 0;
    this.activeChildProc = null;
    this.isDraining = false;
  }

  /**
   * Refresh dynamic memory telemetry and return capability report
   * @returns {Object}
   */
  getCapabilities() {
    this.ramFree = os.freemem();
    return {
      id: this.id,
      name: this.name,
      host: this.host,
      port: this.port,
      state: this.state,
      cpuCores: this.cpuCores,
      cpuModel: this.cpuModel,
      ramTotal: this.ramTotal,
      ramFree: this.ramFree,
      gpuDevice: this.gpuDevice,
      vramBytes: this.vramBytes,
      osPlatform: this.osPlatform,
      osRelease: this.osRelease,
      osArch: this.osArch,
      runtimeVersion: this.runtimeVersion,
      opencompVersion: this.opencompVersion,
      tags: this.tags,
      currentTaskId: this.currentTask ? this.currentTask.taskId : null,
      lastHeartbeat: this.lastHeartbeat
    };
  }

  /**
   * Execute assigned task using OpenComp batch renderer
   * @param {Object} task - RenderTask instance or plain object
   * @param {Object} jobDef - Parent job definition
   * @param {Function} [onProgress] - Optional progress callback
   * @returns {Promise<{success: boolean, outputFiles: string[], durationMs: number}>}
   */
  async executeTask(task, jobDef, onProgress = null) {
    if (this.state === WorkerState.BUSY) {
      throw new Error(`WorkerBusyError: Worker "${this.id}" is already executing task "${this.currentTask?.taskId}"`);
    }
    if (this.state === WorkerState.OFFLINE || this.state === WorkerState.DRAINING) {
      throw new Error(`WorkerUnavailableError: Worker "${this.id}" is in state "${this.state}"`);
    }

    this.state = WorkerState.BUSY;
    this.currentTask = {
      taskId: task.id,
      jobId: jobDef.id,
      startedAt: Date.now()
    };

    const startTime = performance.now();
    const frameRangeStr = task.frames.join(',');

    try {
      let outputFiles = [];

      if (this.executionMode === 'subprocess') {
        outputFiles = await this._executeViaSubprocess(task, jobDef, onProgress);
      } else {
        outputFiles = await this._executeInProcess(task, jobDef, onProgress);
      }

      // Output Integrity Verification on all rendered frames
      for (const file of outputFiles) {
        const check = verifyOutputIntegrity(file);
        if (!check.valid) {
          throw new Error(`OutputIntegrityFailure: Rendered file "${file}" failed integrity verification: ${check.error}`);
        }
      }

      const durationMs = performance.now() - startTime;
      this.state = this.isDraining ? WorkerState.DRAINING : WorkerState.IDLE;
      this.currentTask = null;
      this.consecutiveFailures = 0;

      return {
        success: true,
        outputFiles,
        durationMs
      };
    } catch (err) {
      this.consecutiveFailures++;
      this.state = this.isDraining ? WorkerState.DRAINING : WorkerState.IDLE;
      this.currentTask = null;
      throw err;
    }
  }

  /**
   * In-process render execution using renderBatch
   */
  async _executeInProcess(task, jobDef, onProgress) {
    const config = {
      project: jobDef.projectPath,
      output: jobDef.outputPattern,
      frames: task.frames.join(','),
      node: jobDef.node,
      format: jobDef.format,
      compression: jobDef.compression,
      bitdepth: jobDef.bitdepth,
      quality: jobDef.quality,
      tokens: jobDef.tokens,
      colorspace: jobDef.colorspace,
      ocio: jobDef.ocio,
      overwrite: true,
      verbose: false
    };

    const renderedPaths = [];
    const progressHandler = (p) => {
      renderedPaths.push(p.path);
      if (onProgress) {
        onProgress({
          taskId: task.id,
          jobId: jobDef.id,
          frame: p.frame,
          index: p.index,
          total: p.total,
          percent: Math.round((p.index / p.total) * 100),
          path: p.path
        });
      }
    };

    await renderBatch(config, progressHandler);

    // If no files recorded by callback, calculate expected output files
    if (renderedPaths.length === 0) {
      for (const f of task.frames) {
        const p = formatSequencePath(jobDef.outputPattern || 'renders/output.####.exr', f);
        renderedPaths.push(path.resolve(p));
      }
    }

    return renderedPaths;
  }

  /**
   * Headless subprocess execution via child_process.spawn
   */
  async _executeViaSubprocess(task, jobDef, onProgress) {
    return new Promise((resolve, reject) => {
      const renderScript = path.resolve('bin', 'opencomp-render.mjs');
      const args = [
        renderScript,
        '--project', jobDef.projectPath,
        '--frames', task.frames.join(','),
        '--overwrite'
      ];

      if (jobDef.outputPattern) {
        args.push('--output', jobDef.outputPattern);
      }
      if (jobDef.node) {
        args.push('--node', jobDef.node);
      }
      if (jobDef.format) {
        args.push('--format', jobDef.format);
      }
      if (jobDef.compression) {
        args.push('--compression', jobDef.compression);
      }
      if (jobDef.bitdepth) {
        args.push('--bitdepth', jobDef.bitdepth);
      }
      if (jobDef.tokens) {
        for (const [k, v] of Object.entries(jobDef.tokens)) {
          args.push('--token', `${k}=${v}`);
        }
      }

      // Safe execution without shell: true to prevent command injection
      const child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        shell: false,
        env: { ...process.env }
      });

      this.activeChildProc = child;
      let stderr = '';
      let stdout = '';

      child.stdout.on('data', data => {
        const text = data.toString('utf8');
        stdout += text;
        // Parse frame progress lines
        const match = text.match(/\[FRAME\s+(\d+)\]\s+\((\d+)\/(\d+),\s+([\d.]+)%\)\s+->\s+"([^"]+)"/);
        if (match && onProgress) {
          onProgress({
            taskId: task.id,
            jobId: jobDef.id,
            frame: parseInt(match[1], 10),
            index: parseInt(match[2], 10),
            total: parseInt(match[3], 10),
            percent: parseFloat(match[4]),
            path: match[5]
          });
        }
      });

      child.stderr.on('data', data => {
        stderr += data.toString('utf8');
      });

      child.on('error', err => {
        this.activeChildProc = null;
        reject(new Error(`WorkerSubprocessSpawnError: ${err.message}`));
      });

      child.on('close', code => {
        this.activeChildProc = null;
        if (code === 0) {
          // Resolve output paths
          const expectedPaths = [];
          for (const f of task.frames) {
            const p = formatSequencePath(jobDef.outputPattern || 'renders/output.####.exr', f);
            expectedPaths.push(path.resolve(p));
          }
          resolve(expectedPaths);
        } else {
          reject(new Error(`WorkerExecutionFailed (Exit Code ${code}): ${stderr || stdout}`));
        }
      });
    });
  }

  /**
   * Abort currently running task
   */
  abortCurrentTask() {
    if (this.activeChildProc) {
      try {
        this.activeChildProc.kill('SIGTERM');
      } catch (e) {}
      this.activeChildProc = null;
    }
    this.state = WorkerState.IDLE;
    this.currentTask = null;
  }

  /**
   * Graceful shutdown of worker node
   * @param {boolean} [drain=true]
   */
  shutdown(drain = true) {
    if (!drain) {
      this.abortCurrentTask();
      this.state = WorkerState.OFFLINE;
      return;
    }

    if (this.state === WorkerState.BUSY) {
      this.isDraining = true;
      this.state = WorkerState.DRAINING;
    } else {
      this.state = WorkerState.OFFLINE;
    }
  }
}

