/**
 * OpenComp - Deep OpenEXR Bridge Client (Node.js)
 * Executes deep_exr_bridge.py via subprocess binary streaming.
 * Provides high-speed read/write for authentic multi-sample DeepScanLine OpenEXR files.
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
import { DeepPixelBuffer } from './DeepPixelBuffer.js';

export class DeepEXRBridgeClient {
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
    return path.resolve('src/core/deep/deep_exr_bridge.py');
  }

  /**
   * Inspects header and sample count metadata of a Deep EXR file
   * @param {string} filePath
   * @returns {Object}
   */
  static inspect(filePath) {
    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();
    const fullPath = path.resolve(filePath);

    const proc = spawnSync(pyExe, [bridge, '--inspect', fullPath], { encoding: 'utf8' });
    if (proc.status !== 0) {
      throw new Error(`Deep EXR inspection failed: ${proc.stderr || proc.stdout}`);
    }

    try {
      const parsed = JSON.parse(proc.stdout.trim());
      if (parsed.status === 'ok') {
        return parsed;
      }
      throw new Error(parsed.error || 'Unknown inspection error');
    } catch (err) {
      throw new Error(`Failed to parse Deep EXR inspection response: ${err.message}`);
    }
  }

  /**
   * Reads a multi-sample DeepScanLine EXR file into a DeepPixelBuffer
   * @param {string} filePath
   * @returns {DeepPixelBuffer}
   */
  static readDeepEXR(filePath) {
    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();
    const fullPath = path.resolve(filePath);

    // Create temporary binary file path
    const tempBin = path.join(os.tmpdir(), `opencomp_deep_read_${Date.now()}_${Math.random().toString(36).substring(2)}.bin`);

    try {
      const proc = spawnSync(pyExe, [bridge, '--read', fullPath, tempBin], { encoding: 'utf8' });
      if (proc.status !== 0) {
        throw new Error(`Deep EXR read failed: ${proc.stderr || proc.stdout}`);
      }

      const res = JSON.parse(proc.stdout.trim());
      if (res.status !== 'ok') {
        throw new Error(res.error || 'Unknown deep read error');
      }

      const rawBytes = fs.readFileSync(tempBin);
      const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);

      const width = view.getUint32(0, true);
      const height = view.getUint32(4, true);
      const totalSamples = view.getUint32(8, true);

      const deepBuf = new DeepPixelBuffer(width, height, totalSamples);
      deepBuf.totalSamples = totalSamples;
      deepBuf.sampleCapacity = totalSamples;

      // Extract sampleOffsets: (width * height + 1) uint32s
      const totalPixels = width * height;
      const offsetsByteStart = 12;
      const offsetsByteLen = (totalPixels + 1) * 4;

      const offsetsSub = new Uint32Array(rawBytes.buffer, rawBytes.byteOffset + offsetsByteStart, totalPixels + 1);
      deepBuf.sampleOffsets.set(offsetsSub);

      // Extract sampleData: totalSamples * 6 float32s
      if (totalSamples > 0) {
        const dataByteStart = offsetsByteStart + offsetsByteLen;
        const dataSub = new Float32Array(rawBytes.buffer, rawBytes.byteOffset + dataByteStart, totalSamples * 6);
        deepBuf.sampleData = new Float32Array(totalSamples * 6);
        deepBuf.sampleData.set(dataSub);
      }

      deepBuf.updateBBox();
      return deepBuf;
    } finally {
      if (fs.existsSync(tempBin)) {
        try { fs.unlinkSync(tempBin); } catch (_) {}
      }
    }
  }

  /**
   * Writes a DeepPixelBuffer to an authentic DeepScanLine OpenEXR file
   * @param {DeepPixelBuffer} deepBuffer
   * @param {string} filePath
   * @param {string} [compression='ZIPS'] 'ZIPS' or 'NONE'
   */
  static writeDeepEXR(deepBuffer, filePath, compression = 'ZIPS') {
    if (!(deepBuffer instanceof DeepPixelBuffer)) {
      throw new Error('DeepEXRBridgeClient.writeDeepEXR: Expected instance of DeepPixelBuffer');
    }

    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();
    const fullPath = path.resolve(filePath);

    // Ensure output parent directory exists
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write binary packet to temporary file
    const tempBin = path.join(os.tmpdir(), `opencomp_deep_write_${Date.now()}_${Math.random().toString(36).substring(2)}.bin`);

    try {
      const W = deepBuffer.width;
      const H = deepBuffer.height;
      const totalSamples = deepBuffer.totalSamples;
      const totalPixels = W * H;

      const headerLen = 12;
      const offsetsLen = (totalPixels + 1) * 4;
      const dataLen = totalSamples * 6 * 4;
      const totalByteLength = headerLen + offsetsLen + dataLen;

      const binBuffer = Buffer.allocUnsafe(totalByteLength);
      binBuffer.writeUInt32LE(W, 0);
      binBuffer.writeUInt32LE(H, 4);
      binBuffer.writeUInt32LE(totalSamples, 8);

      const offsetsBuf = Buffer.from(deepBuffer.sampleOffsets.buffer, deepBuffer.sampleOffsets.byteOffset, offsetsLen);
      offsetsBuf.copy(binBuffer, headerLen);

      if (totalSamples > 0) {
        const dataBuf = Buffer.from(deepBuffer.sampleData.buffer, deepBuffer.sampleData.byteOffset, dataLen);
        dataBuf.copy(binBuffer, headerLen + offsetsLen);
      }

      fs.writeFileSync(tempBin, binBuffer);

      // Execute Python bridge
      const proc = spawnSync(pyExe, [bridge, '--write', tempBin, fullPath, compression], { encoding: 'utf8' });
      if (proc.status !== 0) {
        throw new Error(`Deep EXR write failed: ${proc.stderr || proc.stdout}`);
      }

      const res = JSON.parse(proc.stdout.trim());
      if (res.status !== 'ok') {
        throw new Error(res.error || 'Unknown deep write error');
      }

      return res;
    } finally {
      if (fs.existsSync(tempBin)) {
        try { fs.unlinkSync(tempBin); } catch (_) {}
      }
    }
  }
}

