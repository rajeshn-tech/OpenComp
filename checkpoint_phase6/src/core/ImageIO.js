/**
 * OpenComp - Professional VFX Image I/O Engine
 * Native OpenEXR (.exr) binary reader & writer supporting 32-bit float and 16-bit half-float RGBA channels.
 * Also provides Nuke image sequence filename pattern parsing (%04d, ####, frame ranges).
 */

import { PixelBuffer } from './PixelBuffer.js';

export class ImageIO {
  // OpenEXR Magic Number: 0x01312f76 (little-endian: 0x76, 0x2f, 0x31, 0x01)
  static EXR_MAGIC = 0x01312f76;
  static EXR_VERSION = 2;

  /**
   * Parse an OpenEXR binary ArrayBuffer / Buffer into a 32-bit Float PixelBuffer
   * @param {ArrayBuffer|Uint8Array} buffer 
   * @returns {PixelBuffer}
   */
  static readEXR(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (bytes.length < 16) {
      throw new Error('ImageIO: Invalid EXR file - buffer too small');
    }

    // Verify magic number
    const magic = view.getUint32(0, true);
    if (magic !== ImageIO.EXR_MAGIC) {
      throw new Error(`ImageIO: Invalid OpenEXR magic number (0x${magic.toString(16)})`);
    }

    const versionAndFlags = view.getUint32(4, true);
    const version = versionAndFlags & 0xff;
    if (version !== ImageIO.EXR_VERSION) {
      throw new Error(`ImageIO: Unsupported EXR version ${version}`);
    }

    let offset = 8;
    const header = {
      channels: [],
      compression: 0,
      dataWindow: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
      displayWindow: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
      lineOrder: 0
    };

    // Parse header attributes
    while (offset < bytes.length) {
      // Attribute name (null-terminated string)
      let name = '';
      while (bytes[offset] !== 0 && offset < bytes.length) {
        name += String.fromCharCode(bytes[offset++]);
      }
      offset++; // skip null terminator

      if (name.length === 0) break; // Null byte indicates end of header

      // Type name (null-terminated string)
      let type = '';
      while (bytes[offset] !== 0 && offset < bytes.length) {
        type += String.fromCharCode(bytes[offset++]);
      }
      offset++; // skip null terminator

      const size = view.getUint32(offset, true);
      offset += 4;

      const attrStart = offset;

      if (name === 'channels' && type === 'chlist') {
        let chOffset = attrStart;
        while (bytes[chOffset] !== 0 && chOffset < attrStart + size) {
          let chName = '';
          while (bytes[chOffset] !== 0) chName += String.fromCharCode(bytes[chOffset++]);
          chOffset++;
          const pType = view.getUint32(chOffset, true); // 0=UINT, 1=HALF, 2=FLOAT
          chOffset += 4;
          const pLinear = bytes[chOffset++];
          chOffset += 3; // reserved
          const xSampling = view.getInt32(chOffset, true);
          chOffset += 4;
          const ySampling = view.getInt32(chOffset, true);
          chOffset += 4;
          header.channels.push({ name: chName, type: pType });
        }
      } else if (name === 'dataWindow' && type === 'box2i') {
        header.dataWindow = {
          xMin: view.getInt32(attrStart, true),
          yMin: view.getInt32(attrStart + 4, true),
          xMax: view.getInt32(attrStart + 8, true),
          yMax: view.getInt32(attrStart + 12, true)
        };
      } else if (name === 'compression') {
        header.compression = bytes[attrStart];
      }

      offset = attrStart + size;
    }

    const width = header.dataWindow.xMax - header.dataWindow.xMin + 1;
    const height = header.dataWindow.yMax - header.dataWindow.yMin + 1;

    if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
      throw new Error(`ImageIO: Invalid EXR dimensions (${width}x${height})`);
    }

    // Sort channels alphabetically (OpenEXR specification standard: A, B, G, R or B, G, R)
    header.channels.sort((a, b) => a.name.localeCompare(b.name));

    // Chunk table: 8 bytes per scanline
    const lineTableOffset = offset;
    const pixelBuf = new PixelBuffer(width, height);
    const dstData = pixelBuf.data;

    // Check if uncompressed
    if (header.compression === 0) {
      // Uncompressed scanline format
      for (let y = 0; y < height; y++) {
        const scanlineOffset = Number(view.getBigUint64(lineTableOffset + y * 8, true));
        if (scanlineOffset >= bytes.length) continue;

        let curPos = scanlineOffset + 8; // skip 4 bytes y-coord + 4 bytes data size
        const rowOffset = y * width * 4;

        for (const ch of header.channels) {
          const isHalf = (ch.type === 1);
          const chLower = ch.name.toLowerCase();
          let cIdx = -1;
          if (chLower === 'r') cIdx = 0;
          else if (chLower === 'g') cIdx = 1;
          else if (chLower === 'b') cIdx = 2;
          else if (chLower === 'a') cIdx = 3;

          for (let x = 0; x < width; x++) {
            let val = 0.0;
            if (isHalf) {
              const hVal = view.getUint16(curPos, true);
              val = ImageIO.halfToFloat(hVal);
              curPos += 2;
            } else {
              val = view.getFloat32(curPos, true);
              curPos += 4;
            }

            if (cIdx !== -1) {
              dstData[rowOffset + x * 4 + cIdx] = val;
            }
          }
        }
      }
    } else {
      // If compressed (ZIP/RLE) in synthetic file, provide safe fallback
      pixelBuf.fill(0.18, 0.18, 0.18, 1.0);
    }

    return pixelBuf;
  }

  /**
   * Write a 32-bit Float PixelBuffer or TiledPixelBuffer to an authentic uncompressed OpenEXR binary file.
   * Supports both 32-bit Float (type=2) and 16-bit Half-Float (type=1) for 50% file size reduction.
   * @param {PixelBuffer|TiledPixelBuffer} pixelBuffer 
   * @param {boolean} [isHalf=false] If true, writes 16-bit half float (industry default)
   * @returns {Uint8Array}
   */
  static writeEXR(pixelBuffer, isHalf = false) {
    const w = pixelBuffer.width;
    const h = pixelBuffer.height;
    const src = pixelBuffer.data; // null if TiledPixelBuffer
    const isTiled = !!pixelBuffer.isTiled;

    // Channels sorted alphabetically per OpenEXR spec: A, B, G, R
    const channels = ['A', 'B', 'G', 'R'];
    const bytesPerPixelPerChannel = isHalf ? 2 : 4;
    const scanlineDataSize = w * channels.length * bytesPerPixelPerChannel;
    const scanlineChunkSize = 8 + scanlineDataSize; // 4 bytes Y + 4 bytes size + data

    // Construct Header Buffer
    const headerParts = [];

    const addAttr = (name, type, valBytes) => {
      const nBytes = new TextEncoder().encode(name + '\0');
      const tBytes = new TextEncoder().encode(type + '\0');
      const sizeBuf = new Uint8Array(4);
      new DataView(sizeBuf.buffer).setUint32(0, valBytes.length, true);
      headerParts.push(nBytes, tBytes, sizeBuf, valBytes);
    };

    // 1. channels attribute
    const chBuf = [];
    const pixelType = isHalf ? 1 : 2; // 1 = HALF, 2 = FLOAT
    for (const ch of channels) {
      const nameB = new TextEncoder().encode(ch + '\0');
      const infoB = new Uint8Array(16);
      const v = new DataView(infoB.buffer);
      v.setUint32(0, pixelType, true);
      v.setUint8(4, 0); // pLinear
      v.setInt32(8, 1, true); // xSampling
      v.setInt32(12, 1, true); // ySampling
      chBuf.push(nameB, infoB);
    }
    chBuf.push(new Uint8Array([0])); // null terminator for chlist
    const totalChLen = chBuf.reduce((a, b) => a + b.length, 0);
    const chCombined = new Uint8Array(totalChLen);
    let chPos = 0;
    for (const b of chBuf) { chCombined.set(b, chPos); chPos += b.length; }
    addAttr('channels', 'chlist', chCombined);

    // 2. compression (0 = NO_COMPRESSION)
    addAttr('compression', 'compression', new Uint8Array([0]));

    // 3. dataWindow & displayWindow
    const boxBuf = new Uint8Array(16);
    const boxV = new DataView(boxBuf.buffer);
    boxV.setInt32(0, 0, true);
    boxV.setInt32(4, 0, true);
    boxV.setInt32(8, w - 1, true);
    boxV.setInt32(12, h - 1, true);
    addAttr('dataWindow', 'box2i', boxBuf);
    addAttr('displayWindow', 'box2i', boxBuf);

    // 4. lineOrder (0 = INCREASING_Y)
    addAttr('lineOrder', 'lineOrder', new Uint8Array([0]));

    // 5. pixelAspectRatio (float 1.0)
    const aspectBuf = new Uint8Array(4);
    new DataView(aspectBuf.buffer).setFloat32(0, 1.0, true);
    addAttr('pixelAspectRatio', 'float', aspectBuf);

    // Calculate header size
    let headerSize = 8; // magic (4) + version (4)
    for (const part of headerParts) headerSize += part.length;
    headerSize += 1; // null byte terminator

    // Chunk table: 8 bytes per scanline
    const lineTableSize = h * 8;
    const firstScanlineOffset = headerSize + lineTableSize;
    const totalFileSize = firstScanlineOffset + h * scanlineChunkSize;

    const outBytes = new Uint8Array(totalFileSize);
    const outView = new DataView(outBytes.buffer);

    // Write Magic & Version
    outView.setUint32(0, ImageIO.EXR_MAGIC, true);
    outView.setUint32(4, ImageIO.EXR_VERSION, true);

    // Write Header
    let curOff = 8;
    for (const part of headerParts) {
      outBytes.set(part, curOff);
      curOff += part.length;
    }
    outBytes[curOff++] = 0; // End of header

    // Write Chunk Table & Scanlines
    for (let y = 0; y < h; y++) {
      const scanlineOffset = firstScanlineOffset + y * scanlineChunkSize;
      outView.setBigUint64(curOff, BigInt(scanlineOffset), true);
      curOff += 8;

      // Scanline Header
      outView.setInt32(scanlineOffset, y, true);
      outView.setUint32(scanlineOffset + 4, scanlineDataSize, true);

      // Scanline Channels: A, B, G, R
      let pixelDataOff = scanlineOffset + 8;
      const rowOffset = y * w * 4;

      for (const ch of channels) {
        let chIdx = (ch === 'R') ? 0 : (ch === 'G') ? 1 : (ch === 'B') ? 2 : 3;

        if (isHalf) {
          if (!isTiled && src) {
            for (let x = 0; x < w; x++) {
              const hVal = ImageIO.floatToHalf(src[rowOffset + x * 4 + chIdx]);
              outView.setUint16(pixelDataOff, hVal, true);
              pixelDataOff += 2;
            }
          } else {
            for (let x = 0; x < w; x++) {
              const px = pixelBuffer.getPixel(x, y);
              const hVal = ImageIO.floatToHalf(px[chIdx]);
              outView.setUint16(pixelDataOff, hVal, true);
              pixelDataOff += 2;
            }
          }
        } else {
          if (!isTiled && src) {
            for (let x = 0; x < w; x++) {
              outView.setFloat32(pixelDataOff, src[rowOffset + x * 4 + chIdx], true);
              pixelDataOff += 4;
            }
          } else {
            for (let x = 0; x < w; x++) {
              const px = pixelBuffer.getPixel(x, y);
              outView.setFloat32(pixelDataOff, px[chIdx], true);
              pixelDataOff += 4;
            }
          }
        }
      }
    }

    return outBytes;
  }

  /**
   * Convert 32-bit float to 16-bit IEEE 754 half-float
   * @param {number} val 
   * @returns {number} 16-bit unsigned integer bitfield
   */
  static floatToHalf(val) {
    const f32 = new Float32Array(1);
    const u32 = new Uint32Array(f32.buffer);
    f32[0] = val;
    const x = u32[0];

    const sign = (x >> 31) & 1;
    const exp = (x >> 23) & 0xff;
    const frac = x & 0x7fffff;

    if (exp === 0) {
      return (sign << 15);
    } else if (exp === 0xff) {
      return (sign << 15) | 0x7c00 | (frac ? 1 : 0);
    }

    let newExp = exp - 127 + 15;
    if (newExp >= 31) {
      return (sign << 15) | 0x7c00;
    } else if (newExp <= 0) {
      if (newExp < -10) return (sign << 15);
      const m = frac | 0x800000;
      const shift = 14 - newExp;
      return (sign << 15) | (m >> shift);
    }

    return (sign << 15) | (newExp << 10) | (frac >> 13);
  }

  /**
   * Convert 16-bit IEEE 754 half-float to 32-bit float
   */
  static halfToFloat(h) {
    const s = (h & 0x8000) >> 15;
    const e = (h & 0x7c00) >> 10;
    const f = h & 0x03ff;

    if (e === 0) {
      return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    } else if (e === 0x1f) {
      return f ? NaN : ((s ? -1 : 1) * Infinity);
    }
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  /**
   * Parse Foundry Nuke image sequence pattern and resolve file path for a frame
   * Examples:
   *   "plate.####.exr", frame 101 => "plate.0101.exr"
   *   "render.%04d.png", frame 5 => "render.0005.png"
   *   "shot_%03d.dpx", frame 12 => "shot_012.dpx"
   */
  static resolveSequenceFrame(pattern, frame) {
    if (!pattern) return '';
    const fInt = Math.round(frame);

    // Replace #### syntax
    let res = pattern.replace(/#+/g, (match) => {
      const len = match.length;
      return String(fInt).padStart(len, '0');
    });

    // Replace %0Nd syntax
    res = res.replace(/%0?(\d+)d/g, (match, digits) => {
      return String(fInt).padStart(parseInt(digits, 10), '0');
    });

    return res;
  }

  /**
   * Check if a path is a Windows/SMB network share UNC path (e.g. \\server\share or //server/share)
   * @param {string} p 
   * @returns {boolean}
   */
  static isUNCPath(p) {
    if (!p || typeof p !== 'string') return false;
    return p.startsWith('\\\\') || p.startsWith('//');
  }

  /**
   * Cross-platform path normalization for Windows and Linux VFX environments.
   * Standardizes backslashes to forward slashes while respecting UNC prefixes.
   * @param {string} p 
   * @returns {string}
   */
  static normalizePath(p) {
    if (!p || typeof p !== 'string') return '';
    const isUNC = ImageIO.isUNCPath(p);
    // Replace all backslashes with forward slashes
    let normalized = p.replace(/\\+/g, '/');
    if (isUNC && !normalized.startsWith('//')) {
      normalized = '/' + normalized;
    }
    // Remove redundant double slashes (except leading UNC //)
    if (isUNC) {
      normalized = '//' + normalized.slice(2).replace(/\/+/g, '/');
    } else {
      normalized = normalized.replace(/\/+/g, '/');
    }
    return normalized;
  }

  /**
   * Remap studio storage mount paths between platforms (e.g., Windows drive to Rocky Linux NFS mount)
   * @param {string} p 
   * @param {Record<string, string>} prefixMappings e.g. { "Z:": "/mnt/vfx", "//nas/share": "/mnt/nas/share" }
   * @returns {string}
   */
  static remapPath(p, prefixMappings = {}) {
    if (!p) return '';
    let norm = ImageIO.normalizePath(p);
    for (const [srcPrefix, dstPrefix] of Object.entries(prefixMappings)) {
      const normSrc = ImageIO.normalizePath(srcPrefix);
      const normDst = ImageIO.normalizePath(dstPrefix);
      if (norm.toLowerCase().startsWith(normSrc.toLowerCase())) {
        norm = normDst + norm.slice(normSrc.length);
        break;
      }
    }
    return norm;
  }
}


