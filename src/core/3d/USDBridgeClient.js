/**
 * OpenComp - Production OpenUSD Bridge Client (Node.js)
 * Executes bridge calls to usd_bridge.py using native spawnSync.
 * Parses high-performance binary OC3D containers into native Scene3D, Geometry3D, and Camera3D primitives.
 * Completely isolates Node.js built-ins from browser modules.
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
import { Scene3D } from './Scene3D.js';
import { Geometry3D } from './Geometry3D.js';
import { Camera3D } from './Camera3D.js';
import { Matrix4 } from './Matrix4.js';

export class USDBridgeClient {
  /**
   * Resolve Python executable with pxr (OpenUSD) installed
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
    return path.resolve('src/core/3d/usd_bridge.py');
  }

  /**
   * Inspect USD stage hierarchy and metadata
   * @param {string} usdPath
   * @returns {Object}
   */
  static inspect(usdPath) {
    const absPath = path.resolve(usdPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`USD file not found: ${absPath}`);
    }

    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();

    const proc = spawnSync(pyExe, [bridge, 'inspect', '--input', absPath], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });

    if (proc.status !== 0) {
      // Parse structured error if available
      try {
        const errJson = JSON.parse(proc.stderr || proc.stdout);
        throw new Error(`USD inspection error: ${errJson.error || errJson.message}`);
      } catch (parseErr) {
        throw new Error(`USD inspection failed (${proc.status}): ${proc.stderr || proc.stdout}`);
      }
    }

    return JSON.parse(proc.stdout.trim());
  }

  /**
   * Read USD stage and construct a populated native Scene3D
   * @param {string} usdPath
   * @param {Object} [options={}]
   * @param {string} [options.primPath='/']
   * @param {number} [options.frame=1.0]
   * @param {number} [options.scale=null]
   * @param {string} [options.upAxis='auto']
   * @param {number} [options.stride=1]
   * @param {boolean} [options.readCameras=true]
   * @param {boolean} [options.readMeshes=true]
   * @returns {Scene3D}
   */
  static read(usdPath, options = {}) {
    const absPath = path.resolve(usdPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`USD file not found: ${absPath}`);
    }

    const pyExe = this.getPythonExecutable();
    const bridge = this.getBridgeScriptPath();
    const tempBin = path.join(os.tmpdir(), `opencomp_usd_${process.pid}_${Date.now()}_${Math.random().toString(36).substring(7)}.oc3d`);

    const args = [
      bridge, 'read',
      '--input', absPath,
      '--output', tempBin,
      '--prim', options.primPath || '/',
      '--frame', String(options.frame !== undefined ? options.frame : 1.0),
      '--upAxis', options.upAxis || 'auto',
      '--stride', String(options.stride || 1)
    ];

    if (options.scale !== undefined && options.scale !== null) {
      args.push('--scale', String(options.scale));
    }
    if (options.readCameras === false) {
      args.push('--noCameras');
    }
    if (options.readMeshes === false) {
      args.push('--noMeshes');
    }

    const proc = spawnSync(pyExe, args, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });

    if (proc.status !== 0 || !fs.existsSync(tempBin)) {
      try { if (fs.existsSync(tempBin)) fs.unlinkSync(tempBin); } catch (_) {}
      try {
        const errJson = JSON.parse(proc.stderr || proc.stdout);
        throw new Error(`USD read error: ${errJson.error || errJson.message}`);
      } catch (_) {
        throw new Error(`USD read failed: ${proc.stderr || proc.stdout}`);
      }
    }

    try {
      const buffer = fs.readFileSync(tempBin);
      return this.parseOC3DBuffer(buffer, absPath);
    } finally {
      try { fs.unlinkSync(tempBin); } catch (_) {}
    }
  }

  /**
   * Parse binary OC3D container into native Scene3D
   * @param {Buffer} buffer
   * @param {string} sourceFile
   * @returns {Scene3D}
   */
  static parseOC3DBuffer(buffer, sourceFile = '') {
    if (buffer.length < 8) {
      throw new Error('Malformed OC3D container: buffer too small');
    }

    const magic = buffer.subarray(0, 4).toString('ascii');
    if (magic !== 'OC3D') {
      throw new Error(`Invalid 3D container magic: ${magic}, expected 'OC3D'`);
    }

    let offset = 4;
    const metaLen = buffer.readUInt32LE(offset);
    offset += 4;

    const metaJson = buffer.subarray(offset, offset + metaLen).toString('utf8');
    offset += metaLen;
    const metadata = JSON.parse(metaJson);

    const scene = new Scene3D();
    scene.sourceFile = sourceFile;
    scene.metadata = metadata;

    // Read Geometries
    const geoCount = buffer.readUInt32LE(offset);
    offset += 4;

    for (let g = 0; g < geoCount; g++) {
      const nameLen = buffer.readUInt16LE(offset); offset += 2;
      const name = buffer.subarray(offset, offset + nameLen).toString('utf8'); offset += nameLen;

      const pathLen = buffer.readUInt16LE(offset); offset += 2;
      const primPath = buffer.subarray(offset, offset + pathLen).toString('utf8'); offset += pathLen;

      // 16 float32 world matrix = 64 bytes
      const wmBuf = buffer.subarray(offset, offset + 64);
      const worldMatArr = new Float32Array(wmBuf.buffer.slice(wmBuf.byteOffset, wmBuf.byteOffset + 64));
      const worldMat = new Matrix4();
      worldMat.elements.set(worldMatArr);
      offset += 64;

      // Bounding box min/max = 24 bytes
      const minX = buffer.readFloatLE(offset); offset += 4;
      const minY = buffer.readFloatLE(offset); offset += 4;
      const minZ = buffer.readFloatLE(offset); offset += 4;
      const maxX = buffer.readFloatLE(offset); offset += 4;
      const maxY = buffer.readFloatLE(offset); offset += 4;
      const maxZ = buffer.readFloatLE(offset); offset += 4;

      // Vertices
      const vLen = buffer.readUInt32LE(offset); offset += 4;
      const vBuf = buffer.subarray(offset, offset + vLen * 4);
      const vertices = new Float32Array(vBuf.buffer.slice(vBuf.byteOffset, vBuf.byteOffset + vLen * 4));
      offset += vLen * 4;

      // Indices
      const iLen = buffer.readUInt32LE(offset); offset += 4;
      const iBuf = buffer.subarray(offset, offset + iLen * 4);
      const indices = new Uint32Array(iBuf.buffer.slice(iBuf.byteOffset, iBuf.byteOffset + iLen * 4));
      offset += iLen * 4;

      // Normals
      const nLen = buffer.readUInt32LE(offset); offset += 4;
      const nBuf = buffer.subarray(offset, offset + nLen * 4);
      const normals = new Float32Array(nBuf.buffer.slice(nBuf.byteOffset, nBuf.byteOffset + nLen * 4));
      offset += nLen * 4;

      // UVs
      const uvLen = buffer.readUInt32LE(offset); offset += 4;
      const uvBuf = buffer.subarray(offset, offset + uvLen * 4);
      const uvs = new Float32Array(uvBuf.buffer.slice(uvBuf.byteOffset, uvBuf.byteOffset + uvLen * 4));
      offset += uvLen * 4;

      const geo = new Geometry3D(name);
      geo.primPath = primPath;
      geo.setBuffers(vertices, indices, normals, uvs);
      geo.transform.copy(worldMat);
      geo.bbox.min.set(minX, minY, minZ);
      geo.bbox.max.set(maxX, maxY, maxZ);

      scene.addGeometry(geo);
    }

    // Read Cameras
    const camCount = buffer.readUInt32LE(offset);
    offset += 4;

    for (let c = 0; c < camCount; c++) {
      const nameLen = buffer.readUInt16LE(offset); offset += 2;
      const name = buffer.subarray(offset, offset + nameLen).toString('utf8'); offset += nameLen;

      const pathLen = buffer.readUInt16LE(offset); offset += 2;
      const primPath = buffer.subarray(offset, offset + pathLen).toString('utf8'); offset += pathLen;

      // World matrix (64 bytes)
      const cwmBuf = buffer.subarray(offset, offset + 64);
      const worldMatArr = new Float32Array(cwmBuf.buffer.slice(cwmBuf.byteOffset, cwmBuf.byteOffset + 64));
      const worldMat = new Matrix4();
      worldMat.elements.set(worldMatArr);
      offset += 64;

      // Camera optics
      const focal = buffer.readFloatLE(offset); offset += 4;
      const hap = buffer.readFloatLE(offset); offset += 4;
      const vap = buffer.readFloatLE(offset); offset += 4;
      const near = buffer.readFloatLE(offset); offset += 4;
      const far = buffer.readFloatLE(offset); offset += 4;

      const pmLen = buffer.readUInt16LE(offset); offset += 2;
      const projMode = buffer.subarray(offset, offset + pmLen).toString('utf8'); offset += pmLen;

      const cam = new Camera3D();
      cam.name = name;
      cam.primPath = primPath;
      cam.focal = focal;
      cam.haperture = hap;
      cam.vaperture = vap;
      cam.near = near;
      cam.far = far;
      cam.projectionMode = projMode;
      cam.worldMatrix.copy(worldMat);

      scene.addCamera(cam);
    }

    scene.computeBBox();
    return scene;
  }
}
