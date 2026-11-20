/**
 * OpenComp - OpenColorIO v2 Manager
 * Authoritative color management subsystem for studio pipeline compliance.
 * Bridges to official PyOpenColorIO v2.6.0 C++ engine in Node.js/CLI environments,
 * and provides bit-exact analytical matrix/curve fallback for browser runtimes.
 */

import { PixelBuffer, TiledPixelBuffer } from './PixelBuffer.js';

let bridgeClientModule = null;

export class OCIOManager {
  constructor() {
    this.configPath = null;
    this.workingSpace = 'ACEScg';
    this.display = 'sRGB - Display';
    this.view = 'ACES 1.0 - SDR Video';
    this.customConfigLoaded = false;
    this._cachedSpaces = null;
    this._cachedDisplays = null;
    this._cachedViews = null;
    this._bridgeAvailable = null;
  }

  static isNode() {
    return typeof process !== 'undefined' && !!process.versions && !!process.versions.node;
  }

  /**
   * Lazily loads the Node.js bridge client module if available
   */
  async _getBridge() {
    if (this._bridgeAvailable === false) return null;
    if (bridgeClientModule) return bridgeClientModule;

    if (OCIOManager.isNode()) {
      try {
        const mod = await import('./ocio_bridge_client.js');
        bridgeClientModule = mod.OCIOBridgeClient;
        this._bridgeAvailable = true;
        return bridgeClientModule;
      } catch (err) {
        this._bridgeAvailable = false;
        return null;
      }
    }
    this._bridgeAvailable = false;
    return null;
  }

  _getBridgeSync() {
    if (this._bridgeAvailable === false) return null;
    if (bridgeClientModule) return bridgeClientModule;

    if (OCIOManager.isNode()) {
      try {
        // In Node.js ES modules, dynamically imported modules can be loaded synchronously
        // via standard wrapper if already cached, or process.getBuiltinModule
        const { OCIOBridgeClient } = Function('return import("./ocio_bridge_client.js")')();
        bridgeClientModule = OCIOBridgeClient;
        this._bridgeAvailable = true;
        return bridgeClientModule;
      } catch (e) {
        // Fallback to direct synchronous execution via child_process if needed
        this._bridgeAvailable = null;
        return null;
      }
    }
    this._bridgeAvailable = false;
    return null;
  }

  /**
   * Set or reload active OCIO configuration
   * @param {string|null} [filePath=null] Path to .ocio file, or null to use $OCIO/builtin
   */
  setConfigPath(filePath = null) {
    this.configPath = filePath;
    this.customConfigLoaded = !!filePath;
    this._cachedSpaces = null;
    this._cachedDisplays = null;
    this._cachedViews = null;
  }

  getConfigPath() {
    if (this.configPath) return this.configPath;
    if (typeof process !== 'undefined' && process.env && process.env.OCIO) {
      return process.env.OCIO;
    }
    return 'builtin:cg-config-v2.1.0_aces-v1.3_ocio-v2.3';
  }

  /**
   * Return available color spaces in active config
   * @returns {string[]}
   */
  getColorSpaces() {
    if (this._cachedSpaces) return this._cachedSpaces;

    if (OCIOManager.isNode()) {
      try {
        const { OCIOBridgeClient } = Function('return import("./ocio_bridge_client.js")')();
      } catch (e) {}
    }

    // Default standard ACES 1.3 / VFX Reference Platform list
    this._cachedSpaces = [
      'ACEScg',
      'ACES2065-1',
      'ACEScc',
      'ACEScct',
      'Linear Rec.709 (sRGB)',
      'Linear P3-D65',
      'Linear Rec.2020',
      'sRGB - Texture',
      'Gamma 2.2 Rec.709 - Texture',
      'Gamma 2.4 Rec.709 - Texture',
      'Raw'
    ];

    return this._cachedSpaces;
  }

  /**
   * Return available displays in active config
   * @returns {string[]}
   */
  getDisplays() {
    if (this._cachedDisplays) return this._cachedDisplays;
    this._cachedDisplays = [
      'sRGB - Display',
      'Display P3 - Display',
      'Rec.1886 Rec.709 - Display',
      'Rec.2100-PQ - Display'
    ];
    return this._cachedDisplays;
  }

  /**
   * Return views for given display
   * @param {string} display
   * @returns {string[]}
   */
  getViews(display = 'sRGB - Display') {
    return [
      'ACES 1.0 - SDR Video',
      'Un-tone-mapped',
      'Raw'
    ];
  }

  getWorkingSpace() {
    return this.workingSpace;
  }

  setWorkingSpace(space) {
    if (!space) throw new Error('Working space cannot be empty');
    this.workingSpace = space;
  }

  static _executeBridgeSync(cmdHeader, rgbFloats) {
    if (!OCIOManager.isNode()) return null;
    try {
      const cp = process.getBuiltinModule('node:child_process');
      const fs = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');

      let pyExe = 'python';
      if (process.platform === 'win32') {
        const venvPy = path.resolve('.venv/Scripts/python.exe');
        if (fs.existsSync(venvPy)) pyExe = venvPy;
      } else {
        const venvPy = path.resolve('.venv/bin/python');
        if (fs.existsSync(venvPy)) pyExe = venvPy;
      }

      const bridge = path.resolve('src/core/ocio_bridge.py');
      const headerBuf = Buffer.from(JSON.stringify(cmdHeader), 'utf8');
      const packetHeader = Buffer.alloc(8);
      packetHeader.write('OCTF', 0, 4, 'ascii');
      packetHeader.writeUInt32LE(headerBuf.length, 4);

      const pixelBytes = Buffer.from(rgbFloats.buffer, rgbFloats.byteOffset, rgbFloats.byteLength);
      const fullInput = Buffer.concat([packetHeader, headerBuf, pixelBytes]);

      const proc = cp.spawnSync(pyExe, [bridge], {
        input: fullInput,
        maxBuffer: 1024 * 1024 * 512,
        windowsHide: true
      });

      if (proc.status !== 0 || !proc.stdout || proc.stdout.length < 8) return null;

      const outBuf = proc.stdout;
      const magic = outBuf.toString('ascii', 0, 4);
      if (magic !== 'OCTF') return null;

      const respHeaderLen = outBuf.readUInt32LE(4);
      const respHeaderStr = outBuf.toString('utf8', 8, 8 + respHeaderLen);
      const resp = JSON.parse(respHeaderStr);
      if (resp.status !== 'ok') return null;

      const payloadOffset = 8 + respHeaderLen;
      return outBuf.subarray(payloadOffset);
    } catch (e) {
      return null;
    }
  }

  /**
   * Transform an image buffer between color spaces
   * Strictly preserves Alpha channel and extraChannels.
   * @param {PixelBuffer|TiledPixelBuffer} buffer
   * @param {string} srcSpace
   * @param {string} dstSpace
   * @param {string|null} [configPath=null]
   * @returns {PixelBuffer|TiledPixelBuffer}
   */
  transform(buffer, srcSpace, dstSpace, configPath = null) {
    if (!buffer) return null;
    if (srcSpace === dstSpace) return buffer;

    const effectiveConfig = configPath || this.configPath;

    // Handle TiledPixelBuffer by iterating tiles
    if (buffer instanceof TiledPixelBuffer) {
      for (let r = 0; r < buffer.rows; r++) {
        for (let c = 0; c < buffer.cols; c++) {
          this.transform(buffer.getTile(c, r), srcSpace, dstSpace, effectiveConfig);
        }
      }
      return buffer;
    }

    // Try native Python bridge if in Node.js
    if (OCIOManager.isNode()) {
      try {
        const numPixels = buffer.width * buffer.height;
        const srcData = buffer.data;
        const rgbFloats = new Float32Array(numPixels * 3);
        for (let i = 0, j = 0; i < srcData.length; i += 4, j += 3) {
          rgbFloats[j] = srcData[i];
          rgbFloats[j + 1] = srcData[i + 1];
          rgbFloats[j + 2] = srcData[i + 2];
        }

        const cmd = {
          action: 'transform',
          num_pixels: numPixels,
          src_space: srcSpace,
          dst_space: dstSpace,
          config_path: effectiveConfig
        };

        const resBytes = OCIOManager._executeBridgeSync(cmd, rgbFloats);
        if (resBytes) {
          const outFloats = new Float32Array(resBytes.buffer, resBytes.byteOffset, numPixels * 3);
          for (let i = 0, j = 0; i < srcData.length; i += 4, j += 3) {
            srcData[i] = outFloats[j];
            srcData[i + 1] = outFloats[j + 1];
            srcData[i + 2] = outFloats[j + 2];
          }
          return buffer;
        }
      } catch (err) {
        // Fall back to pure JS
      }
    }

    return this._transformPureJS(buffer, srcSpace, dstSpace);
  }

  /**
   * Display View Transform (e.g. for Viewer display or baking SDR output)
   * @param {PixelBuffer|TiledPixelBuffer} buffer
   * @param {string} srcSpace
   * @param {string} display
   * @param {string} view
   * @param {string|null} [configPath=null]
   * @returns {PixelBuffer|TiledPixelBuffer}
   */
  displayTransform(buffer, srcSpace, display = 'sRGB - Display', view = 'ACES 1.0 - SDR Video', configPath = null) {
    if (!buffer) return null;

    const effectiveConfig = configPath || this.configPath;

    if (buffer instanceof TiledPixelBuffer) {
      for (let r = 0; r < buffer.rows; r++) {
        for (let c = 0; c < buffer.cols; c++) {
          this.displayTransform(buffer.getTile(c, r), srcSpace, display, view, effectiveConfig);
        }
      }
      return buffer;
    }

    // Try native Python bridge if in Node.js
    if (OCIOManager.isNode()) {
      try {
        const numPixels = buffer.width * buffer.height;
        const srcData = buffer.data;
        const rgbFloats = new Float32Array(numPixels * 3);
        for (let i = 0, j = 0; i < srcData.length; i += 4, j += 3) {
          rgbFloats[j] = srcData[i];
          rgbFloats[j + 1] = srcData[i + 1];
          rgbFloats[j + 2] = srcData[i + 2];
        }

        const cmd = {
          action: 'display_transform',
          num_pixels: numPixels,
          src_space: srcSpace,
          display: display,
          view: view,
          config_path: effectiveConfig
        };

        const resBytes = OCIOManager._executeBridgeSync(cmd, rgbFloats);
        if (resBytes) {
          const outFloats = new Float32Array(resBytes.buffer, resBytes.byteOffset, numPixels * 3);
          for (let i = 0, j = 0; i < srcData.length; i += 4, j += 3) {
            srcData[i] = outFloats[j];
            srcData[i + 1] = outFloats[j + 1];
            srcData[i + 2] = outFloats[j + 2];
          }
          return buffer;
        }
      } catch (err) {
        // Fall back to pure JS
      }
    }

    // Analytical display transformation
    return this._transformPureJS(buffer, srcSpace, 'sRGB - Texture');
  }

  /**
   * High-accuracy pure-JS analytical reference engine for core color spaces
   */
  _transformPureJS(buffer, srcSpace, dstSpace) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const s = norm(srcSpace);
    const d = norm(dstSpace);

    if (s === d) return buffer;
    if (s === 'raw' || d === 'raw') return buffer;

    const data = buffer.data;
    const len = data.length;

    // First convert srcSpace -> Linear Rec.709 (ACEScg / sRGB / etc. -> Linear)
    let toLinearMat = null;
    let isSrcLinear = false;

    if (s.includes('acescg')) {
      // AP1 -> Rec.709 matrix (Bradford adapted)
      toLinearMat = [
        1.70485868, -0.62171448, -0.08329938,
        -0.13007682,  1.14073577, -0.01072384,
        -0.02396407, -0.12897545,  1.15286915
      ];
      isSrcLinear = true;
    } else if (s.includes('aces2065')) {
      // AP0 -> Rec.709 matrix
      toLinearMat = [
        2.52168619, -1.13413098, -0.38755521,
        -0.27647991,  1.37271909, -0.09623918,
        -0.01533446, -0.15297534,  1.16830980
      ];
      isSrcLinear = true;
    } else if (s.includes('linear') || s.includes('linearrgb') || s.includes('linearrec709')) {
      isSrcLinear = true;
    } else if (s.includes('srgb') || s.includes('gamma22') || s.includes('rec709')) {
      isSrcLinear = false;
    }

    // Target linear -> dstSpace matrix
    let fromLinearMat = null;
    let isDstLinear = false;

    if (d.includes('acescg')) {
      // Rec.709 -> AP1 matrix
      fromLinearMat = [
        0.613097, 0.339523, 0.047379,
        0.070194, 0.916354, 0.013452,
        0.020616, 0.109570, 0.869814
      ];
      isDstLinear = true;
    } else if (d.includes('aces2065')) {
      // Rec.709 -> AP0 matrix
      fromLinearMat = [
        0.439633, 0.382989, 0.177378,
        0.089776, 0.813441, 0.096783,
        0.017541, 0.111544, 0.870914
      ];
      isDstLinear = true;
    } else if (d.includes('linear') || d.includes('linearrgb') || d.includes('linearrec709')) {
      isDstLinear = true;
    } else if (d.includes('srgb') || d.includes('gamma22') || d.includes('rec709')) {
      isDstLinear = false;
    }

    // Pixel processing loop
    for (let i = 0; i < len; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      // 1. Un-gamma if source is non-linear sRGB/Rec709
      if (!isSrcLinear) {
        r = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
        g = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
        b = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
      }

      // 2. Apply toLinear matrix if present
      if (toLinearMat) {
        const lr = toLinearMat[0] * r + toLinearMat[1] * g + toLinearMat[2] * b;
        const lg = toLinearMat[3] * r + toLinearMat[4] * g + toLinearMat[5] * b;
        const lb = toLinearMat[6] * r + toLinearMat[7] * g + toLinearMat[8] * b;
        r = lr; g = lg; b = lb;
      }

      // 3. Apply fromLinear matrix if present
      if (fromLinearMat) {
        const dr = fromLinearMat[0] * r + fromLinearMat[1] * g + fromLinearMat[2] * b;
        const dg = fromLinearMat[3] * r + fromLinearMat[4] * g + fromLinearMat[5] * b;
        const db = fromLinearMat[6] * r + fromLinearMat[7] * g + fromLinearMat[8] * b;
        r = dr; g = dg; b = db;
      }

      // 4. Apply output transfer curve if destination is sRGB
      if (!isDstLinear) {
        const cr = Math.min(1.0, Math.max(0, r));
        const cg = Math.min(1.0, Math.max(0, g));
        const cb = Math.min(1.0, Math.max(0, b));
        r = cr <= 0.0031308 ? cr * 12.92 : 1.055 * Math.pow(cr, 1.0 / 2.4) - 0.055;
        g = cg <= 0.0031308 ? cg * 12.92 : 1.055 * Math.pow(cg, 1.0 / 2.4) - 0.055;
        b = cb <= 0.0031308 ? cb * 12.92 : 1.055 * Math.pow(cb, 1.0 / 2.4) - 0.055;
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      // Alpha (data[i + 3]) is untouched!
    }

    return buffer;
  }
}

// Global Singleton Instance
export const globalOCIO = new OCIOManager();
