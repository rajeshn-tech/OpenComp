/**
 * OpenComp - Native LAN Render Farm Dispatcher
 * Coordinates worker nodes, job queuing, task distribution,
 * heartbeat monitoring, and HTTP REST interface for studio local networks.
 */

import http from 'node:http';
import {
  JobState,
  TaskState,
  WorkerState,
  validateAuthToken
} from './FarmProtocol.js';
import { JobQueue } from './JobQueue.js';

export class LANDispatcher {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.host='127.0.0.1'] - Bind address for local network
   * @param {number} [options.port=8088] - Port for dispatcher HTTP service
   * @param {string|null} [options.authSecret=null] - Local network shared secret token
   * @param {number} [options.heartbeatTimeoutMs=10000] - Threshold before marking worker OFFLINE
   * @param {number} [options.pollIntervalMs=500] - Dispatch scheduling loop frequency
   * @param {boolean} [options.preventDuplicates=true] - Prevent duplicate active jobs
   */
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port !== undefined ? options.port : 8088;
    this.authSecret = options.authSecret || null;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs || 10000;
    this.pollIntervalMs = options.pollIntervalMs || 500;

    this.queue = new JobQueue({ preventDuplicates: options.preventDuplicates !== false });
    this.workers = new Map();
    this.inProcessWorkers = new Map();

    this.server = null;
    this.timer = null;
    this.isRunning = false;
    this.startTime = null;
  }

  /**
   * Start the dispatcher HTTP service and background scheduling loop
   * @returns {Promise<{host: string, port: number}>}
   */
  async start() {
    if (this.isRunning) return { host: this.host, port: this.port };

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));

      this.server.on('error', (err) => {
        reject(new Error(`LANDispatcherServerError: ${err.message}`));
      });

      this.server.listen(this.port, this.host, () => {
        const addr = this.server.address();
        this.port = typeof addr === 'object' && addr ? addr.port : this.port;
        this.isRunning = true;
        this.startTime = Date.now();

        // Start background dispatch loop
        this.timer = setInterval(() => this.tick(), this.pollIntervalMs);

        resolve({ host: this.host, port: this.port });
      });
    });
  }

  /**
   * Stop the dispatcher service and cleanup timers
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) return;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.isRunning = false;

    // Shutdown registered in-process workers
    for (const w of this.inProcessWorkers.values()) {
      try { w.shutdown(false); } catch (e) {}
    }

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Register a local Worker instance directly with the dispatcher
   * @param {Worker} workerInstance
   */
  registerWorker(workerInstance) {
    if (!workerInstance || !workerInstance.id) {
      throw new Error('Invalid worker instance: missing worker ID');
    }
    this.inProcessWorkers.set(workerInstance.id, workerInstance);
    this.workers.set(workerInstance.id, workerInstance.getCapabilities());
  }

  /**
   * Submit a new job to the queue
   * @param {Object} jobDef
   * @returns {RenderJob}
   */
  submitJob(jobDef) {
    const job = this.queue.submitJob(jobDef);
    // Immediate tick to assign tasks if idle workers exist
    this.tick();
    return job;
  }

  /**
   * Get job by ID
   * @param {string} jobId
   */
  getJob(jobId) {
    return this.queue.getJob(jobId);
  }

  /**
   * List all jobs
   * @param {Object} [filter]
   */
  listJobs(filter) {
    return this.queue.listJobs(filter);
  }

  /**
   * Cancel job by ID
   * @param {string} jobId
   * @param {string} [reason]
   */
  cancelJob(jobId, reason) {
    const result = this.queue.cancelJob(jobId, reason);
    if (result) {
      // Abort active tasks on in-process workers
      for (const w of this.inProcessWorkers.values()) {
        if (w.currentTask && w.currentTask.jobId === jobId) {
          w.abortCurrentTask();
        }
      }
    }
    return result;
  }

  /**
   * Resume an incomplete or failed job
   * @param {string} jobId
   */
  resumeJob(jobId) {
    const job = this.queue.resumeJob(jobId);
    this.tick();
    return job;
  }

  /**
   * Get list of all registered workers and health statuses
   */
  getWorkers() {
    return Array.from(this.workers.values());
  }

  /**
   * Periodic scheduling and worker health maintenance loop
   */
  tick() {
    const now = Date.now();

    // 1. Worker Health & Timeout Sweep
    for (const [wId, wInfo] of this.workers.entries()) {
      if (wInfo.state !== WorkerState.OFFLINE) {
        if (now - wInfo.lastHeartbeat > this.heartbeatTimeoutMs) {
          wInfo.state = WorkerState.OFFLINE;
          const reassigned = this.queue.reassignWorkerTasks(wId, 'Worker heartbeat timeout');
          if (reassigned > 0) {
            console.log(`[LANDispatcher] Worker "${wId}" timed out. Reassigned ${reassigned} active task(s).`);
          }
        }
      }
    }

    // 2. Dispatch Loop: Match Idle Workers to Pending Tasks
    const idleWorkerIds = [];
    for (const [wId, wInfo] of this.workers.entries()) {
      if (wInfo.state === WorkerState.IDLE) {
        idleWorkerIds.push(wId);
      }
    }

    for (const wId of idleWorkerIds) {
      const pending = this.queue.getNextPendingTask();
      if (!pending) break; // No more pending tasks

      const { job, task } = pending;
      const workerInfo = this.workers.get(wId);
      workerInfo.state = WorkerState.BUSY;
      workerInfo.currentTaskId = task.id;

      this.queue.markTaskStarted(task.id, wId);

      // If worker is registered in-process, execute directly
      const inProcWorker = this.inProcessWorkers.get(wId);
      if (inProcWorker) {
        this._dispatchInProcess(inProcWorker, task, job);
      } else {
        // Remote worker assignment: stored in workerInfo for retrieval on next poll/heartbeat
        workerInfo.assignedTask = {
          task: task.toJSON(),
          job: job.toSummary()
        };
      }
    }
  }

  /**
   * Asynchronous task execution on in-process worker
   */
  async _dispatchInProcess(worker, task, job) {
    try {
      const result = await worker.executeTask(task, job, (progress) => {
        this.queue.markTaskProgress(task.id, progress);
      });

      this.queue.markTaskComplete(task.id, result);

      const workerInfo = this.workers.get(worker.id);
      if (workerInfo) {
        workerInfo.state = worker.state;
        workerInfo.currentTaskId = null;
        workerInfo.lastHeartbeat = Date.now();
      }

      // Trigger immediate tick for next task
      setImmediate(() => this.tick());
    } catch (err) {
      const { retried } = this.queue.markTaskFailed(task.id, err.message);

      const workerInfo = this.workers.get(worker.id);
      if (workerInfo) {
        workerInfo.state = worker.state;
        workerInfo.currentTaskId = null;
        workerInfo.lastHeartbeat = Date.now();
      }

      setImmediate(() => this.tick());
    }
  }

  /**
   * HTTP REST API Request Handler
   */
  async _handleRequest(req, res) {
    const urlObj = new URL(req.url, `http://${this.host}:${this.port}`);
    const pathname = urlObj.pathname;
    const method = req.method;

    // Helper for JSON responses
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(data));
    };

    // Public health check
    if (pathname === '/health' && method === 'GET') {
      return sendJson(200, {
        status: 'ok',
        app: 'OpenComp LANDispatcher',
        version: '1.3.1',
        uptime: this.startTime ? (Date.now() - this.startTime) / 1000 : 0,
        workersTotal: this.workers.size,
        workersOnline: Array.from(this.workers.values()).filter(w => w.state !== WorkerState.OFFLINE).length,
        jobsCount: this.queue.jobs.size
      });
    }

    // Authenticate all protected /api/ routes
    if (pathname.startsWith('/api/')) {
      if (!validateAuthToken(req.headers, this.authSecret)) {
        return sendJson(401, { error: 'Unauthorized: Invalid or missing X-OpenComp-Auth token' });
      }
    }

    // Parse JSON body for POST requests
    let body = {};
    if (method === 'POST') {
      try {
        body = await this._readJsonBody(req);
      } catch (err) {
        return sendJson(400, { error: `Invalid JSON payload: ${err.message}` });
      }
    }

    try {
      // 1. Worker Registration
      if (pathname === '/api/worker/register' && method === 'POST') {
        const wId = body.id || generateId('worker');
        const workerData = {
          id: wId,
          name: body.name || `Worker-${wId}`,
          host: body.host || req.socket.remoteAddress,
          port: body.port || null,
          state: WorkerState.IDLE,
          cpuCores: body.cpuCores || 1,
          ramTotal: body.ramTotal || 0,
          ramFree: body.ramFree || 0,
          gpuDevice: body.gpuDevice || null,
          vramBytes: body.vramBytes || null,
          osPlatform: body.osPlatform || 'unknown',
          opencompVersion: body.opencompVersion || '1.3.1',
          tags: body.tags || ['cpu'],
          currentTaskId: null,
          assignedTask: null,
          lastHeartbeat: Date.now()
        };

        this.workers.set(wId, workerData);
        setImmediate(() => this.tick());

        return sendJson(200, { success: true, workerId: wId, registered: true });
      }

      // 2. Worker Heartbeat
      if (pathname === '/api/worker/heartbeat' && method === 'POST') {
        const wId = body.id;
        const workerInfo = this.workers.get(wId);
        if (!workerInfo) {
          return sendJson(404, { error: `Worker "${wId}" not found. Must register first.` });
        }

        workerInfo.lastHeartbeat = Date.now();
        if (body.ramFree !== undefined) workerInfo.ramFree = body.ramFree;
        if (body.state && workerInfo.state !== WorkerState.OFFLINE) {
          workerInfo.state = body.state;
        }

        // Return assigned task if pending for this worker
        const taskPayload = workerInfo.assignedTask || null;
        workerInfo.assignedTask = null; // Clear once handed off

        return sendJson(200, {
          ack: true,
          state: workerInfo.state,
          assignedTask: taskPayload
        });
      }

      // 3. Worker Unregister / Graceful Drain
      if (pathname === '/api/worker/unregister' && method === 'POST') {
        const wId = body.id;
        const workerInfo = this.workers.get(wId);
        if (workerInfo) {
          workerInfo.state = WorkerState.OFFLINE;
          this.queue.reassignWorkerTasks(wId, 'Worker unregistered');
          return sendJson(200, { success: true, unregistered: true });
        }
        return sendJson(404, { error: `Worker "${wId}" not found` });
      }

      // 4. List Workers
      if (pathname === '/api/workers' && method === 'GET') {
        return sendJson(200, { workers: this.getWorkers() });
      }

      // 5. Submit Job
      if (pathname === '/api/job/submit' && method === 'POST') {
        const job = this.submitJob(body);
        return sendJson(201, { success: true, job: job.toSummary() });
      }

      // 6. List Jobs
      if (pathname === '/api/jobs' && method === 'GET') {
        const statusFilter = urlObj.searchParams.get('state');
        const jobs = this.listJobs(statusFilter ? { state: statusFilter } : {});
        return sendJson(200, { jobs });
      }

      // 7. Get Job Status
      if (pathname.startsWith('/api/job/') && method === 'GET') {
        const jobId = pathname.slice('/api/job/'.length);
        const job = this.getJob(jobId);
        if (!job) return sendJson(404, { error: `Job "${jobId}" not found` });
        return sendJson(200, { job: job.toSummary() });
      }

      // 8. Cancel Job
      if (pathname.startsWith('/api/job/') && pathname.endsWith('/cancel') && method === 'POST') {
        const jobId = pathname.slice('/api/job/'.length, -'/cancel'.length);
        const success = this.cancelJob(jobId, body.reason || 'Cancelled via API');
        if (!success) return sendJson(404, { error: `Job "${jobId}" could not be cancelled or not found` });
        return sendJson(200, { success: true, jobId, cancelled: true });
      }

      // 9. Resume Job
      if (pathname.startsWith('/api/job/') && pathname.endsWith('/resume') && method === 'POST') {
        const jobId = pathname.slice('/api/job/'.length, -'/resume'.length);
        const job = this.resumeJob(jobId);
        return sendJson(200, { success: true, job: job.toSummary() });
      }

      // 10. Worker Task Progress Report
      if (pathname === '/api/worker/task/progress' && method === 'POST') {
        const { taskId, progress } = body;
        this.queue.markTaskProgress(taskId, progress);
        return sendJson(200, { ack: true });
      }

      // 11. Worker Task Complete
      if (pathname === '/api/worker/task/complete' && method === 'POST') {
        const { taskId, workerId, result } = body;
        this.queue.markTaskComplete(taskId, result || {});
        const workerInfo = this.workers.get(workerId);
        if (workerInfo) {
          workerInfo.state = WorkerState.IDLE;
          workerInfo.currentTaskId = null;
        }
        setImmediate(() => this.tick());
        return sendJson(200, { ack: true });
      }

      // 12. Worker Task Failed
      if (pathname === '/api/worker/task/failed' && method === 'POST') {
        const { taskId, workerId, error } = body;
        const res = this.queue.markTaskFailed(taskId, error);
        const workerInfo = this.workers.get(workerId);
        if (workerInfo) {
          workerInfo.state = WorkerState.IDLE;
          workerInfo.currentTaskId = null;
        }
        setImmediate(() => this.tick());
        return sendJson(200, { ack: true, retried: res.retried });
      }

      // Unknown route
      return sendJson(404, { error: `Route not found: ${method} ${pathname}` });
    } catch (err) {
      return sendJson(500, { error: `InternalServerError: ${err.message}` });
    }
  }

  /**
   * Read and parse request JSON body buffer
   */
  _readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => {
        data += chunk;
        if (data.length > 10 * 1024 * 1024) { // 10MB limit
          req.destroy();
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        if (!data.trim()) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }
}

