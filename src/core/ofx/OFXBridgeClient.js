/**
 * OpenComp - OpenFX (OFX) 1.4 Bridge Client (Node.js)
 * High-performance subprocess bridge to ofx_bridge.py for discovery, description,
 * Region of Definition (RoD) queries, and out-of-process render action execution.
 * Isolates Node built-in modules via process.getBuiltinModule for browser safety.
 */

const spawnSync = (typeof process !== 'undefined' && process.getBuiltinModule) 
  ? process.getBuiltinModule('node:child_process').spawnSync 
  : null;
const fs = (typeof process !== 'undefined' && process.getBuiltinModule) 
  ? process.getBuiltinModule('node:fs') 
  : null;
const path = (typeof process !== 'undefined' && process.getBuiltinModule) 
  ? process.getBuiltinModule('node:path') 
  : null;
const os = (typeof process !== 'undefined' && process.getBuiltinModule) 
  ? process.getBuiltinModule('node:os') 
  : null;

import { PixelBuffer } from '../PixelBuffer.js';

const MAGIC_OFXBUF = 'OFXB';

export class OFXBridgeClient {
  /**
   * Resolve Python executable
   */
  static getPythonExecutable() {
    if (process.platform === 'win32') {
      const venvPy = path.resolve('.venv/Scripts/python.exe');
      if (fs.existsSync(venvPy)) return venvPy;
    } else {
      const venvPy = path.resolve('.venv/bin/python');
      if (fs.existsSync(venvPy)) return venvPy;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  static getBridgeScriptPath() {
    return path.resolve('src/core/ofx/ofx_bridge.py');
  }

  /**
   * Discover available OFX plugins across filesystem and built-in reference suites
   * @param {Array<string>|null} [searchPaths=null]
   * @returns {Object}
   */
  static discover(searchPaths = null) {
    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();
    const args = [bridge, 'discover'];

    if (searchPaths && Array.isArray(searchPaths) && searchPaths.length > 0) {
      args.push('--paths', searchPaths.join(path.delimiter));
    }

    const proc = spawnSync(pyExe, args, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });

    if (proc.status !== 0) {
      try {
        const errJson = JSON.parse(proc.stderr || proc.stdout);
        throw new Error(`OFX discovery error: ${errJson.error || errJson.message}`);
      } catch (_) {
        throw new Error(`OFX discovery failed (${proc.status}): ${proc.stderr || proc.stdout}`);
      }
    }

    return JSON.parse(proc.stdout.trim());
  }

  /**
   * Describe plugin capabilities, declared parameters, and clips
   * @param {string} pluginId
   * @returns {Object}
   */
  static describe(pluginId) {
    if (!pluginId || typeof pluginId !== 'string') {
      throw new Error('Valid plugin identifier is required');
    }

    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();

    const proc = spawnSync(pyExe, [bridge, 'describe', '--plugin', pluginId], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });

    if (proc.status !== 0) {
      try {
        const errJson = JSON.parse(proc.stderr || proc.stdout);
        throw new Error(`OFX describe error: ${errJson.error || errJson.message}`);
      } catch (_) {
        throw new Error(`OFX describe failed (${proc.status}): ${proc.stderr || proc.stdout}`);
      }
    }

    return JSON.parse(proc.stdout.trim());
  }

  /**
   * Query Region of Definition (RoD) for a plugin given input dimensions and parameters
   * @param {string} pluginId
   * @param {number} width
   * @param {number} height
   * @param {Object} [params={}]
   * @returns {{x1: number, y1: number, x2: number, y2: number}}
   */
  static getRegionOfDefinition(pluginId, width, height, params = {}) {
    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();

    const proc = spawnSync(pyExe, [
      bridge, 'rod',
      '--plugin', pluginId,
      '--width', String(width),
      '--height', String(height),
      '--params', JSON.stringify(params)
    ], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });

    if (proc.status !== 0) {
      try {
        const errJson = JSON.parse(proc.stderr || proc.stdout);
        throw new Error(`OFX RoD error: ${errJson.error || errJson.message}`);
      } catch (_) {
        throw new Error(`OFX RoD failed (${proc.status}): ${proc.stderr || proc.stdout}`);
      }
    }

    const res = JSON.parse(proc.stdout.trim());
    return res.rod;
  }

  /**
   * Serialize PixelBuffer to binary OFXBUF file
   * @param {PixelBuffer} pixelBuffer
   * @param {string} filePath
   */
  static writePixelBufferToOFXBUF(pixelBuffer, filePath) {
    const width = pixelBuffer.width;
    const height = pixelBuffer.height;
    const channels = 4;
    const numFloats = width * height * channels;

    const header = Buffer.alloc(16);
    header.write(MAGIC_OFXBUF, 0, 4, 'ascii');
    header.writeUInt32LE(width, 4);
    header.writeUInt32LE(height, 8);
    header.writeUInt32LE(channels, 12);

    const rawFloats = pixelBuffer.data;
    const byteLength = numFloats * 4;
    // Safe buffer copy
    const floatBuffer = Buffer.from(rawFloats.buffer, rawFloats.byteOffset, byteLength);

    const fd = fs.openSync(filePath, 'w');
    fs.writeSync(fd, header);
    fs.writeSync(fd, floatBuffer);
    fs.closeSync(fd);
  }

  /**
   * Deserialize binary OFXBUF file into PixelBuffer
   * @param {string} filePath
   * @returns {PixelBuffer}
   */
  static readPixelBufferFromOFXBUF(filePath) {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 16) {
      throw new Error('Malformed OFXBUF container: file too small');
    }

    const magic = buf.subarray(0, 4).toString('ascii');
    if (magic !== MAGIC_OFXBUF) {
      throw new Error(`Invalid OFXBUF container magic: ${magic}, expected 'OFXB'`);
    }

    const width = buf.readUInt32LE(4);
    const height = buf.readUInt32LE(8);
    const channels = buf.readUInt32LE(12);

    const numFloats = width * height * channels;
    const dataSub = buf.subarray(16, 16 + numFloats * 4);
    // Align Float32Array to 4 bytes
    const floatArr = new Float32Array(dataSub.buffer.slice(dataSub.byteOffset, dataSub.byteOffset + numFloats * 4));

    const pixelBuffer = new PixelBuffer(width, height);
    pixelBuffer.data.set(floatArr);
    return pixelBuffer;
  }

  /**
   * Execute OpenFX image effect render action
   * @param {string} pluginId
   * @param {PixelBuffer} inputBuffer
   * @param {Object} [options={}]
   * @param {number} [options.frame=1.0]
   * @param {Object} [options.params={}]
   * @param {Array<number>} [options.renderWindow=null] - [x1, y1, x2, y2]
   * @returns {{pixelBuffer: PixelBuffer, durationMs: number}}
   */
  static render(pluginId, inputBuffer, options = {}) {
    if (!inputBuffer || !(inputBuffer instanceof PixelBuffer)) {
      throw new Error('Valid input PixelBuffer is required for OFX render');
    }

    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();

    const nonce = `${process.pid}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const tempIn = path.join(os.tmpdir(), `opencomp_ofx_in_${nonce}.ofxbuf`);
    const tempOut = path.join(os.tmpdir(), `opencomp_ofx_out_${nonce}.ofxbuf`);

    try {
      // 1. Write input pixel buffer
      this.writePixelBufferToOFXBUF(inputBuffer, tempIn);

      // 2. Prepare command args
      const frame = options.frame !== undefined ? options.frame : 1.0;
      const params = options.params || {};

      const args = [
        bridge, 'render',
        '--input', tempIn,
        '--output', tempOut,
        '--plugin', pluginId,
        '--frame', String(frame),
        '--params', JSON.stringify(params)
      ];

      if (options.renderWindow && Array.isArray(options.renderWindow) && options.renderWindow.length === 4) {
        args.push('--render-window', options.renderWindow.join(','));
      }

      // 3. Execute bridge action
      const proc = spawnSync(pyExe, args, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      });

      if (proc.status !== 0 || !fs.existsSync(tempOut)) {
        let errMsg = `OFX plugin execution failed with exit code ${proc.status}`;
        try {
          const errJson = JSON.parse(proc.stderr || proc.stdout);
          errMsg = errJson.error || errMsg;
        } catch (_) {
          if (proc.stderr && proc.stderr.trim()) {
            errMsg = proc.stderr.trim();
          }
        }
        throw new Error(`[OFX Host] Render action failed for plugin '${pluginId}': ${errMsg}`);
      }

      // 4. Read output pixel buffer
      const outputBuffer = this.readPixelBufferFromOFXBUF(tempOut);
      let durationMs = 0;
      try {
        const outMeta = JSON.parse(proc.stdout.trim());
        durationMs = outMeta.durationMs || 0;
      } catch (_) {}

      return {
        pixelBuffer: outputBuffer,
        durationMs
      };
    } finally {
      // Always clean up temporary files
      try { if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn); } catch (_) {}
      try { if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut); } catch (_) {}
    }
  }
}

