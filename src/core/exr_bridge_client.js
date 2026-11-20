/**
 * OpenComp - OpenEXR Bridge Client (Node.js)
 * Executes bridge subprocess calls to exr_bridge.py using native spawnSync.
 * Completely isolates Node.js built-ins from browser modules.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class EXRBridgeClient {
  /**
   * Resolve Python executable with OpenEXR installed (.venv or system)
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
    return path.resolve('src/core/exr_bridge.py');
  }

  /**
   * Inspect OpenEXR file headers and channel list
   */
  static inspect(exrPath) {
    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();
    const proc = spawnSync(pyExe, [bridge, 'inspect', '--input', path.resolve(exrPath)], { encoding: 'utf8' });
    if (proc.status !== 0) {
      throw new Error(`EXR inspection failed: ${proc.stderr || proc.stdout}`);
    }
    return JSON.parse(proc.stdout.trim());
  }

  /**
   * Read any compressed or multi-layer EXR file into raw channel data
   */
  static read(exrPathOrBuffer) {
    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();

    let tempExr = null;
    let inputPath = exrPathOrBuffer;

    if (typeof exrPathOrBuffer !== 'string') {
      tempExr = path.join(os.tmpdir(), `opencomp_read_${process.pid}_${Date.now()}.exr`);
      fs.writeFileSync(tempExr, exrPathOrBuffer);
      inputPath = tempExr;
    }

    const tempBin = path.join(os.tmpdir(), `opencomp_ch_${process.pid}_${Date.now()}.bin`);

    try {
      const proc = spawnSync(pyExe, [bridge, 'read', '--input', path.resolve(inputPath), '--output', tempBin], { encoding: 'utf8' });
      if (proc.status !== 0) {
        throw new Error(`EXR bridge read failed: ${proc.stderr || proc.stdout}`);
      }

      if (!fs.existsSync(tempBin)) {
        throw new Error('EXR bridge failed to produce binary channel packet');
      }

      const binBuf = fs.readFileSync(tempBin);
      const view = new DataView(binBuf.buffer, binBuf.byteOffset, binBuf.byteLength);

      const magic = String.fromCharCode(binBuf[0], binBuf[1], binBuf[2], binBuf[3]);
      if (magic !== 'OCEX') {
        throw new Error(`Invalid OCEX packet magic: ${magic}`);
      }

      const width = view.getUint32(4, true);
      const height = view.getUint32(8, true);
      const numChannels = view.getUint32(12, true);

      const channels = {};
      let offset = 16;
      const len = width * height;

      for (let c = 0; c < numChannels; c++) {
        const nameLen = view.getUint16(offset, true);
        offset += 2;
        const nameBytes = binBuf.subarray(offset, offset + nameLen);
        const name = new TextDecoder('utf-8').decode(nameBytes);
        offset += nameLen;
        const slice = binBuf.buffer.slice(binBuf.byteOffset + offset, binBuf.byteOffset + offset + len * 4);
        const copyArr = new Float32Array(slice);
        offset += len * 4;
        channels[name] = copyArr;
      }

      let metadata = {};
      const metaPath = tempBin + '.meta.json';
      if (fs.existsSync(metaPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch (e) {}
        try { fs.unlinkSync(metaPath); } catch (e) {}
      }

      return { width, height, channels, metadata };
    } finally {
      if (tempExr && fs.existsSync(tempExr)) {
        try { fs.unlinkSync(tempExr); } catch (e) {}
      }
      if (fs.existsSync(tempBin)) {
        try { fs.unlinkSync(tempBin); } catch (e) {}
      }
    }
  }

  /**
   * Write channels to compressed OpenEXR file (DWAA, DWAB, ZIP, etc.)
   */
  static write(width, height, channelsMap, compression = 'dwaa', quality = 45.0, isHalf = false, outPath = null) {
    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();

    const tempBin = path.join(os.tmpdir(), `opencomp_write_${process.pid}_${Date.now()}.bin`);
    const finalExr = outPath ? path.resolve(outPath) : path.join(os.tmpdir(), `opencomp_final_${process.pid}_${Date.now()}.exr`);

    try {
      const len = width * height;
      const channelNames = Object.keys(channelsMap).sort();

      let totalSize = 16;
      for (const ch of channelNames) {
        const nBytes = new TextEncoder().encode(ch);
        totalSize += 2 + nBytes.length + len * 4;
      }

      const binBytes = new Uint8Array(totalSize);
      const view = new DataView(binBytes.buffer);

      // Magic 'OCEX'
      binBytes.set([0x4F, 0x43, 0x45, 0x58], 0);
      view.setUint32(4, width, true);
      view.setUint32(8, height, true);
      view.setUint32(12, channelNames.length, true);

      let offset = 16;
      for (const ch of channelNames) {
        const nBytes = new TextEncoder().encode(ch);
        view.setUint16(offset, nBytes.length, true);
        offset += 2;
        binBytes.set(nBytes, offset);
        offset += nBytes.length;

        const chData = channelsMap[ch] || new Float32Array(len);
        const chUint8 = new Uint8Array(chData.buffer, chData.byteOffset, chData.byteLength);
        binBytes.set(chUint8, offset);
        offset += len * 4;
      }

      fs.writeFileSync(tempBin, binBytes);

      const args = [
        bridge, 'write',
        '--input', tempBin,
        '--output', finalExr,
        '--compression', compression,
        '--quality', String(quality)
      ];
      if (isHalf) args.push('--half');

      const proc = spawnSync(pyExe, args, { encoding: 'utf8' });
      if (proc.status !== 0) {
        throw new Error(`OpenEXR bridge write failed: ${proc.stderr || proc.stdout}`);
      }

      if (outPath) {
        return { status: 'ok', path: finalExr, size: fs.statSync(finalExr).size };
      } else {
        const resultBytes = fs.readFileSync(finalExr);
        return resultBytes;
      }
    } finally {
      if (fs.existsSync(tempBin)) {
        try { fs.unlinkSync(tempBin); } catch (e) {}
      }
      if (!outPath && fs.existsSync(finalExr)) {
        try { fs.unlinkSync(finalExr); } catch (e) {}
      }
    }
  }
}
