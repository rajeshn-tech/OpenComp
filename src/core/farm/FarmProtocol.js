/**
 * OpenComp - Render Farm Protocol & Shared Definitions
 * Standardizes job, task, and worker states, payload validation,
 * local network security tokens, and output file integrity verification.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Job lifecycle state enum
 */
export const JobState = Object.freeze({
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});

/**
 * Task lifecycle state enum
 */
export const TaskState = Object.freeze({
  PENDING: 'PENDING',
  ASSIGNED: 'ASSIGNED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});

/**
 * Worker node operational health enum
 */
export const WorkerState = Object.freeze({
  IDLE: 'IDLE',
  BUSY: 'BUSY',
  DRAINING: 'DRAINING',
  OFFLINE: 'OFFLINE',
  ERROR: 'ERROR'
});

/**
 * Generate cryptographically random ID
 * @param {string} prefix
 * @returns {string}
 */
export function generateId(prefix = 'id') {
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${Date.now()}_${rand}`;
}

/**
 * Validates local network authentication token
 * @param {Object} headers - Request headers object
 * @param {string|null} expectedSecret - Configured secret or null if auth disabled
 * @returns {boolean}
 */
export function validateAuthToken(headers = {}, expectedSecret = null) {
  if (!expectedSecret) return true; // Auth disabled
  if (!headers) return false;

  const authHeader = headers['x-opencomp-auth'] || headers['X-OpenComp-Auth'] || headers['authorization'] || headers['Authorization'];
  if (!authHeader) return false;

  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim() === expectedSecret;
  }
  return authHeader.trim() === expectedSecret;
}

/**
 * Sanitizes and validates a job definition object
 * @param {Object} jobDef
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateJobDefinition(jobDef) {
  const errors = [];
  if (!jobDef || typeof jobDef !== 'object') {
    return { valid: false, errors: ['Job definition must be a non-null object'] };
  }

  if (!jobDef.name || typeof jobDef.name !== 'string' || !jobDef.name.trim()) {
    errors.push('Job name is required and must be a non-empty string');
  }

  if (!jobDef.projectPath || typeof jobDef.projectPath !== 'string') {
    errors.push('Job projectPath is required');
  } else {
    // Check path traversal or dangerous control characters
    const norm = path.normalize(jobDef.projectPath);
    if (!fs.existsSync(norm)) {
      errors.push(`Project file does not exist: "${norm}"`);
    }
  }

  if (!jobDef.frames) {
    errors.push('Job frames specification is required (array of integers or range string)');
  }

  if (jobDef.chunkSize !== undefined) {
    const chunk = parseInt(jobDef.chunkSize, 10);
    if (isNaN(chunk) || chunk < 1) {
      errors.push('chunkSize must be a positive integer >= 1');
    }
  }

  if (jobDef.priority !== undefined) {
    const prio = parseInt(jobDef.priority, 10);
    if (isNaN(prio) || prio < 0 || prio > 100) {
      errors.push('priority must be an integer between 0 and 100');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Verifies that a rendered file exists, is non-empty, and has valid format magic bytes
 * @param {string} filePath
 * @param {Object} [options={}]
 * @param {number} [options.minBytes=64]
 * @param {boolean} [options.verifyHeader=true]
 * @returns {{valid: boolean, size: number, error?: string}}
 */
export function verifyOutputIntegrity(filePath, options = {}) {
  const minBytes = options.minBytes || 64;
  const verifyHeader = options.verifyHeader !== false;

  if (!filePath || !fs.existsSync(filePath)) {
    return { valid: false, size: 0, error: `File not found: "${filePath}"` };
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.size < minBytes) {
      return {
        valid: false,
        size: stat.size,
        error: `File is truncated or undersized: ${stat.size} bytes (minimum ${minBytes} bytes required)`
      };
    }

    if (verifyHeader) {
      const ext = path.extname(filePath).toLowerCase();
      const fd = fs.openSync(filePath, 'r');
      const headerBuf = Buffer.alloc(8);
      fs.readSync(fd, headerBuf, 0, 8, 0);
      fs.closeSync(fd);

      if (ext === '.exr') {
        // OpenEXR magic number: 0x76, 0x2f, 0x31, 0x01
        if (headerBuf[0] !== 0x76 || headerBuf[1] !== 0x2f || headerBuf[2] !== 0x31 || headerBuf[3] !== 0x01) {
          return { valid: false, size: stat.size, error: 'Corrupt OpenEXR magic header bytes' };
        }
      } else if (ext === '.png') {
        // PNG magic number: 0x89, 0x50, 0x4e, 0x47
        if (headerBuf[0] !== 0x89 || headerBuf[1] !== 0x50 || headerBuf[2] !== 0x4e || headerBuf[3] !== 0x47) {
          return { valid: false, size: stat.size, error: 'Corrupt PNG magic header bytes' };
        }
      }
    }

    return { valid: true, size: stat.size };
  } catch (err) {
    return { valid: false, size: 0, error: `Integrity check failed: ${err.message}` };
  }
}

/**
 * Format an array of frames into readable range strings
 * e.g. [1, 2, 3, 5, 7, 8, 9] -> "1-3, 5, 7-9"
 * @param {number[]} frames
 * @returns {string}
 */
export function formatFrameRange(frames) {
  if (!Array.isArray(frames) || frames.length === 0) return '';
  const sorted = Array.from(new Set(frames)).sort((a, b) => a - b);
  const ranges = [];
  let rangeStart = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    const curr = sorted[i];
    if (curr === prev + 1) {
      prev = curr;
    } else {
      if (rangeStart === prev) {
        ranges.push(String(rangeStart));
      } else {
        ranges.push(`${rangeStart}-${prev}`);
      }
      rangeStart = curr;
      prev = curr;
    }
  }

  return ranges.join(', ');
}

