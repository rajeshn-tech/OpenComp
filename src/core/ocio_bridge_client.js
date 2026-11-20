/**
 * OpenComp - OpenColorIO v2 Bridge Client (Node.js)
 * High-performance subprocess bridge executing PyOpenColorIO transforms.
 * Communicates via binary packets with zero-loss 32-bit floating-point precision.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let cachedConfigMetadata = null;
let lastConfigPath = undefined;

export class OCIOBridgeClient {
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
    return path.resolve('src/core/ocio_bridge.py');
  }

  /**
   * Inspect active or specified OCIO configuration
   * @param {string|null} [configPath=null]
   * @returns {Object} Config metadata (color spaces, displays, views)
   */
  static inspect(configPath = null) {
    if (cachedConfigMetadata && configPath === lastConfigPath) {
      return cachedConfigMetadata;
    }

    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();
    const args = [bridge, '--inspect'];
    if (configPath) args.push(path.resolve(configPath));

    const proc = spawnSync(pyExe, args, { encoding: 'utf8' });
    if (proc.status !== 0) {
      throw new Error(`OCIO inspection failed: ${proc.stderr || proc.stdout}`);
    }

    try {
      const parsed = JSON.parse(proc.stdout.trim());
      if (parsed.status === 'ok') {
        cachedConfigMetadata = parsed;
        lastConfigPath = configPath;
        return parsed;
      }
      throw new Error(parsed.error || 'Unknown OCIO inspection error');
    } catch (err) {
      throw new Error(`Failed to parse OCIO inspection output: ${err.message}`);
    }
  }

  /**
   * Apply ColorSpaceTransform to an RGBA PixelBuffer
   * Strictly preserves Alpha channel and extraChannels.
   * @param {import('./PixelBuffer.js').PixelBuffer} buffer
   * @param {string} srcSpace
   * @param {string} dstSpace
   * @param {string|null} [configPath=null]
   * @returns {import('./PixelBuffer.js').PixelBuffer}
   */
  static transform(buffer, srcSpace, dstSpace, configPath = null) {
    if (!buffer) return null;
    const numPixels = buffer.width * buffer.height;
    if (numPixels === 0) return buffer;

    // Extract contiguous RGB float32 array
    const srcData = buffer.data;
    const rgbFloats = new Float32Array(numPixels * 3);
    for (let i = 0, j = 0; i < srcData.length; i += 4, j += 3) {
      rgbFloats[j] = srcData[i];
      rgbFloats[j + 1] = srcData[i + 1];
      rgbFloats[j + 2] = srcData[i + 2];
    }

    const cmdHeader = {
      action: 'transform',
      num_pixels: numPixels,
      src_space: srcSpace,
      dst_space: dstSpace,
      config_path: configPath ? path.resolve(configPath) : null
    };

    const transformedBytes = this._executeBridge(cmdHeader, Buffer.from(rgbFloats.buffer, rgbFloats.byteOffset, rgbFloats.byteLength));
    const outFloats = new Float32Array(transformedBytes.buffer, transformedBytes.byteOffset, numPixels * 3);

    // Write back transformed RGB into buffer.data, preserving Alpha
    for (let i = 0, j = 0; i < srcData.length; i += 4, j += 3) {
      srcData[i] = outFloats[j];
      srcData[i + 1] = outFloats[j + 1];
      srcData[i + 2] = outFloats[j + 2];
    }

    return buffer;
  }

  /**
   * Apply DisplayViewTransform to an RGBA PixelBuffer
   * @param {import('./PixelBuffer.js').PixelBuffer} buffer
   * @param {string} srcSpace
   * @param {string} display
   * @param {string} view
   * @param {string|null} [configPath=null]
   * @returns {import('./PixelBuffer.js').PixelBuffer}
   */
  static displayTransform(buffer, srcSpace, display, view, configPath = null) {
    if (!buffer) return null;
    const numPixels = buffer.width * buffer.height;
    if (numPixels === 0) return buffer;

    const srcData = buffer.data;
    const rgbFloats = new Float32Array(numPixels * 3);
    for (let i = 0, j = 0; i < srcData.length; i += 4, j += 3) {
      rgbFloats[j] = srcData[i];
      rgbFloats[j + 1] = srcData[i + 1];
      rgbFloats[j + 2] = srcData[i + 2];
    }

    const cmdHeader = {
      action: 'display_transform',
      num_pixels: numPixels,
      src_space: srcSpace,
      display: display,
      view: view,
      config_path: configPath ? path.resolve(configPath) : null
    };

    const transformedBytes = this._executeBridge(cmdHeader, Buffer.from(rgbFloats.buffer, rgbFloats.byteOffset, rgbFloats.byteLength));
    const outFloats = new Float32Array(transformedBytes.buffer, transformedBytes.byteOffset, numPixels * 3);

    for (let i = 0, j = 0; i < srcData.length; i += 4, j += 3) {
      srcData[i] = outFloats[j];
      srcData[i + 1] = outFloats[j + 1];
      srcData[i + 2] = outFloats[j + 2];
    }

    return buffer;
  }

  /**
   * Internal subprocess invocation over stdin/stdout
   */
  static _executeBridge(cmdHeader, pixelBytes) {
    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();

    const headerJson = JSON.stringify(cmdHeader);
    const headerBuf = Buffer.from(headerJson, 'utf8');

    // Packet: 'OCTF' (4) + headerLen (4 uint32LE) + headerJson + pixelBytes
    const packetHeader = Buffer.alloc(8);
    packetHeader.write('OCTF', 0, 4, 'ascii');
    packetHeader.writeUInt32LE(headerBuf.length, 4);

    const fullInput = Buffer.concat([packetHeader, headerBuf, pixelBytes]);

    const proc = spawnSync(pyExe, [bridge], {
      input: fullInput,
      maxBuffer: 1024 * 1024 * 512, // 512 MB buffer limit
      windowsHide: true
    });

    if (proc.status !== 0) {
      throw new Error(`OCIO bridge error (exit ${proc.status}): ${proc.stderr.toString('utf8') || proc.stdout.toString('utf8')}`);
    }

    const outBuf = proc.stdout;
    if (outBuf.length < 8) {
      throw new Error(`OCIO bridge returned invalid packet length: ${outBuf.length} bytes`);
    }

    const magic = outBuf.toString('ascii', 0, 4);
    if (magic !== 'OCTF') {
      throw new Error(`Invalid OCIO bridge packet magic: "${magic}"`);
    }

    const respHeaderLen = outBuf.readUInt32LE(4);
    const respHeaderStr = outBuf.toString('utf8', 8, 8 + respHeaderLen);
    const resp = JSON.parse(respHeaderStr);

    if (resp.status !== 'ok') {
      throw new Error(`OCIO transform failed: ${resp.error}`);
    }

    const payloadOffset = 8 + respHeaderLen;
    return outBuf.subarray(payloadOffset);
  }
}

