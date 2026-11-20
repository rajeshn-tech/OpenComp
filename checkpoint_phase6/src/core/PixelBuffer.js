/**
 * OpenComp - Core 32-bit Float Pixel Buffer
 * Industry-standard 32-bit linear floating point image buffer (similar to Foundry Nuke)
 */

export class PixelBuffer {
  /**
   * @param {number} width 
   * @param {number} height 
   * @param {Float32Array} [data] Optional existing buffer
   */
  constructor(width, height, data = null) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.channels = 4; // R, G, B, A
    const length = this.width * this.height * 4;
    
    if (data && data.length === length) {
      this.data = data;
    } else {
      this.data = new Float32Array(length);
    }
  }

  /**
   * Clone current buffer
   * @returns {PixelBuffer}
   */
  clone() {
    const copy = new PixelBuffer(this.width, this.height);
    copy.data.set(this.data);
    return copy;
  }

  /**
   * Clear buffer with transparent black (0, 0, 0, 0)
   */
  clear() {
    this.data.fill(0);
  }

  /**
   * Fill buffer with a solid float color
   * @param {number} r 0.0 - 1.0+
   * @param {number} g 0.0 - 1.0+
   * @param {number} b 0.0 - 1.0+
   * @param {number} a 0.0 - 1.0
   */
  fill(r, g, b, a = 1.0) {
    const d = this.data;
    const len = d.length;
    for (let i = 0; i < len; i += 4) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = a;
    }
  }

  /**
   * Get pixel values at (x, y)
   * @param {number} x 
   * @param {number} y 
   * @returns {[number, number, number, number]} [r, g, b, a]
   */
  getPixel(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return [0, 0, 0, 0];
    }
    const idx = (y * this.width + x) * 4;
    return [
      this.data[idx],
      this.data[idx + 1],
      this.data[idx + 2],
      this.data[idx + 3]
    ];
  }

  /**
   * Set pixel values at (x, y)
   * @param {number} x 
   * @param {number} y 
   * @param {number} r 
   * @param {number} g 
   * @param {number} b 
   * @param {number} a 
   */
  setPixel(x, y, r, g, b, a = 1.0) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = (y * this.width + x) * 4;
    if (Array.isArray(r) || (r && typeof r === 'object' && r.length !== undefined)) {
      this.data[idx] = r[0];
      this.data[idx + 1] = r[1];
      this.data[idx + 2] = r[2];
      this.data[idx + 3] = r[3] !== undefined ? r[3] : 1.0;
    } else {
      this.data[idx] = r;
      this.data[idx + 1] = g;
      this.data[idx + 2] = b;
      this.data[idx + 3] = a;
    }
  }

  /**
   * Convert sRGB 8-bit integer Uint8ClampedArray (HTML ImageData) to Linear Float32Array
   * @param {ImageData} imageData 
   * @returns {PixelBuffer}
   */
  static fromImageData(imageData) {
    const buf = new PixelBuffer(imageData.width, imageData.height);
    const src = imageData.data;
    const dst = buf.data;
    const len = src.length;

    for (let i = 0; i < len; i += 4) {
      // Convert sRGB 0-255 to Linear Float 0.0 - 1.0
      dst[i] = Math.pow(src[i] / 255.0, 2.2);
      dst[i + 1] = Math.pow(src[i + 1] / 255.0, 2.2);
      dst[i + 2] = Math.pow(src[i + 2] / 255.0, 2.2);
      dst[i + 3] = src[i + 3] / 255.0; // Alpha is linear
    }
    return buf;
  }

  /**
   * Convert Linear Float32Array to sRGB ImageData for display
   * @param {number} exposure EV stop offset (-5.0 to +5.0)
   * @param {number} gamma Display gamma (e.g. 2.2 or slider 0.2 to 3.0)
   * @param {string} channelMode 'RGBA' | 'RED' | 'GREEN' | 'BLUE' | 'ALPHA' | 'LUMA'
   * @param {ImageData} [targetImageData] Optional recycled ImageData
   * @returns {ImageData}
   */
  toImageData(exposure = 0.0, gamma = 1.0, channelMode = 'RGBA', targetImageData = null) {
    const imgData = targetImageData || new ImageData(this.width, this.height);
    const dst = imgData.data;
    const src = this.data;
    const len = src.length;
    
    const exposureMult = Math.pow(2.0, exposure);
    const invGamma = 1.0 / Math.max(0.001, gamma);

    for (let i = 0; i < len; i += 4) {
      let r = src[i] * exposureMult;
      let g = src[i + 1] * exposureMult;
      let b = src[i + 2] * exposureMult;
      let a = src[i + 3];

      // Channel isolation modes
      if (channelMode === 'RED') {
        g = r;
        b = r;
        a = 1.0;
      } else if (channelMode === 'GREEN') {
        r = g;
        b = g;
        a = 1.0;
      } else if (channelMode === 'BLUE') {
        r = b;
        g = b;
        a = 1.0;
      } else if (channelMode === 'ALPHA') {
        r = a;
        g = a;
        b = a;
        a = 1.0;
      } else if (channelMode === 'LUMA') {
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = luma;
        g = luma;
        b = luma;
        a = 1.0;
      }

      // Linear -> Display Gamma correction & clamp
      r = Math.min(255, Math.max(0, Math.pow(Math.max(0, r), invGamma) * 255.0));
      g = Math.min(255, Math.max(0, Math.pow(Math.max(0, g), invGamma) * 255.0));
      b = Math.min(255, Math.max(0, Math.pow(Math.max(0, b), invGamma) * 255.0));
      a = Math.min(255, Math.max(0, a * 255.0));

      dst[i] = r;
      dst[i + 1] = g;
      dst[i + 2] = b;
      dst[i + 3] = a;
    }

    return imgData;
  }

  /**
   * Resample/resize image using Bilinear filtering
   * @param {number} newWidth 
   * @param {number} newHeight 
   * @returns {PixelBuffer}
   */
  resample(newWidth, newHeight) {
    newWidth = Math.max(1, Math.floor(newWidth));
    newHeight = Math.max(1, Math.floor(newHeight));
    if (newWidth === this.width && newHeight === this.height) return this.clone();

    const result = new PixelBuffer(newWidth, newHeight);
    const src = this.data;
    const dst = result.data;
    const w = this.width;
    const h = this.height;

    const xRatio = (w - 1) / Math.max(1, newWidth - 1);
    const yRatio = (h - 1) / Math.max(1, newHeight - 1);

    for (let y = 0; y < newHeight; y++) {
      const srcY = y * yRatio;
      const y0 = Math.floor(srcY);
      const y1 = Math.min(h - 1, y0 + 1);
      const yWeight = srcY - y0;

      for (let x = 0; x < newWidth; x++) {
        const srcX = x * xRatio;
        const x0 = Math.floor(srcX);
        const x1 = Math.min(w - 1, x0 + 1);
        const xWeight = srcX - x0;

        const idx00 = (y0 * w + x0) * 4;
        const idx01 = (y0 * w + x1) * 4;
        const idx10 = (y1 * w + x0) * 4;
        const idx11 = (y1 * w + x1) * 4;

        const outIdx = (y * newWidth + x) * 4;

        for (let c = 0; c < 4; c++) {
          const top = src[idx00 + c] * (1 - xWeight) + src[idx01 + c] * xWeight;
          const bottom = src[idx10 + c] * (1 - xWeight) + src[idx11 + c] * xWeight;
          dst[outIdx + c] = top * (1 - yWeight) + bottom * yWeight;
        }
      }
    }

    return result;
  }

  /**
   * Calculate required memory in bytes for RGBA 32-bit float buffer
   * @param {number} width 
   * @param {number} height 
   * @returns {number} Memory in bytes
   */
  static calculateMemoryBytes(width, height) {
    return width * height * 4 * 4; // 4 channels * 4 bytes per float32
  }

  /**
   * Check if a single contiguous buffer can be safely allocated within V8 engine limits
   * Beyond 12K DCI (~1.2 GiB), allocations risk OS heap fragmentation and V8 limits.
   * @param {number} width 
   * @param {number} height 
   * @returns {boolean}
   */
  static canAllocateContiguous(width, height) {
    const bytes = PixelBuffer.calculateMemoryBytes(width, height);
    // Safe contiguous buffer threshold: 1.5 GiB (1,610,612,736 bytes)
    return bytes <= 1610612736;
  }

  /**
   * Create downsampled proxy buffer for interactive viewport preview
   * @param {number} [scaleFactor=0.5] e.g. 0.5 for 1:2 proxy, 0.25 for 1:4 proxy
   * @returns {PixelBuffer}
   */
  createProxy(scaleFactor = 0.5) {
    const factor = Math.max(0.01, Math.min(1.0, scaleFactor));
    const pW = Math.max(1, Math.round(this.width * factor));
    const pH = Math.max(1, Math.round(this.height * factor));
    return this.resample(pW, pH);
  }

  /**
   * Memory-aware factory: returns contiguous PixelBuffer up to 12K DCI,
   * or a TiledPixelBuffer for 16K+ large frame processing.
   * @param {number} width 
   * @param {number} height 
   * @returns {PixelBuffer|TiledPixelBuffer}
   */
  static createBuffer(width, height) {
    if (PixelBuffer.canAllocateContiguous(width, height)) {
      return new PixelBuffer(width, height);
    }
    return new TiledPixelBuffer(width, height, 2048);
  }
}

/**
 * OpenComp - Tiled Pixel Buffer Architecture
 * Partitions ultra-high resolution frames (8K, 12K, 16K UHD+) into a 2D matrix of 
 * independently addressable 2048x2048 tiles, eliminating V8 2GB contiguous ArrayBuffer allocation limits.
 */
export class TiledPixelBuffer {
  constructor(width, height, tileSize = 2048) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.tileSize = Math.max(64, Math.floor(tileSize));
    this.channels = 4;
    this.isTiled = true;

    this.cols = Math.ceil(this.width / this.tileSize);
    this.rows = Math.ceil(this.height / this.tileSize);

    /** @type {PixelBuffer[][]} */
    this.tiles = [];
    for (let r = 0; r < this.rows; r++) {
      const rowList = [];
      const tileH = Math.min(this.tileSize, this.height - r * this.tileSize);
      for (let c = 0; c < this.cols; c++) {
        const tileW = Math.min(this.tileSize, this.width - c * this.tileSize);
        rowList.push(new PixelBuffer(tileW, tileH));
      }
      this.tiles.push(rowList);
    }
  }

  /**
   * Clone full tiled buffer
   * @returns {TiledPixelBuffer}
   */
  clone() {
    const copy = new TiledPixelBuffer(this.width, this.height, this.tileSize);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        copy.tiles[r][c].data.set(this.tiles[r][c].data);
      }
    }
    return copy;
  }

  getTile(col, row) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return null;
    return this.tiles[row][col];
  }

  getPixel(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return [0, 0, 0, 0];
    const col = Math.floor(x / this.tileSize);
    const row = Math.floor(y / this.tileSize);
    const localX = x % this.tileSize;
    const localY = y % this.tileSize;
    return this.tiles[row][col].getPixel(localX, localY);
  }

  setPixel(x, y, r, g, b, a = 1.0) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const col = Math.floor(x / this.tileSize);
    const row = Math.floor(y / this.tileSize);
    const localX = x % this.tileSize;
    const localY = y % this.tileSize;
    this.tiles[row][col].setPixel(localX, localY, r, g, b, a);
  }

  fill(r, g, b, a = 1.0) {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        this.tiles[row][col].fill(r, g, b, a);
      }
    }
  }

  /**
   * Extract a sub-region spanning across tile boundaries into a contiguous PixelBuffer
   * Used for apron/halo extraction during spatial filtering (e.g. Blur, Convolution)
   * @param {number} x0 Top-left X coordinate (can be negative for border padding)
   * @param {number} y0 Top-left Y coordinate (can be negative for border padding)
   * @param {number} w Width of extracted region
   * @param {number} h Height of extracted region
   * @param {boolean} [clampToEdge=true] If true, out-of-image samples clamp to edge pixel
   * @returns {PixelBuffer}
   */
  getRegion(x0, y0, w, h, clampToEdge = true) {
    const region = new PixelBuffer(w, h);
    const dst = region.data;

    for (let ry = 0; ry < h; ry++) {
      let srcY = y0 + ry;
      if (clampToEdge) {
        srcY = Math.max(0, Math.min(this.height - 1, srcY));
      } else if (srcY < 0 || srcY >= this.height) {
        continue; // Leaves 0 in dst
      }

      for (let rx = 0; rx < w; rx++) {
        let srcX = x0 + rx;
        if (clampToEdge) {
          srcX = Math.max(0, Math.min(this.width - 1, srcX));
        } else if (srcX < 0 || srcX >= this.width) {
          continue;
        }

        const px = this.getPixel(srcX, srcY);
        const dstIdx = (ry * w + rx) * 4;
        dst[dstIdx] = px[0];
        dst[dstIdx + 1] = px[1];
        dst[dstIdx + 2] = px[2];
        dst[dstIdx + 3] = px[3];
      }
    }
    return region;
  }

  /**
   * Write a sub-region into the tiled buffer
   * @param {number} x0 
   * @param {number} y0 
   * @param {PixelBuffer} region 
   */
  setRegion(x0, y0, region) {
    const w = region.width;
    const h = region.height;
    for (let ry = 0; ry < h; ry++) {
      const dstY = y0 + ry;
      if (dstY < 0 || dstY >= this.height) continue;
      for (let rx = 0; rx < w; rx++) {
        const dstX = x0 + rx;
        if (dstX < 0 || dstX >= this.width) continue;
        const px = region.getPixel(rx, ry);
        this.setPixel(dstX, dstY, px[0], px[1], px[2], px[3]);
      }
    }
  }

  /**
   * Apply point operation across all tiles
   * @param {(r: number, g: number, b: number, a: number) => [number, number, number, number]} opFn 
   */
  processPointOp(opFn) {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const d = this.tiles[row][col].data;
        const len = d.length;
        for (let i = 0; i < len; i += 4) {
          const res = opFn(d[i], d[i + 1], d[i + 2], d[i + 3]);
          d[i] = res[0];
          d[i + 1] = res[1];
          d[i + 2] = res[2];
          d[i + 3] = res[3];
        }
      }
    }
  }

  /**
   * Downsampled proxy generator from tiled buffer
   * @param {number} scaleFactor 
   * @returns {PixelBuffer}
   */
  createProxy(scaleFactor = 0.25) {
    const factor = Math.max(0.01, Math.min(1.0, scaleFactor));
    const pW = Math.max(1, Math.round(this.width * factor));
    const pH = Math.max(1, Math.round(this.height * factor));
    const proxyBuf = new PixelBuffer(pW, pH);

    const stepX = this.width / pW;
    const stepY = this.height / pH;

    for (let py = 0; py < pH; py++) {
      const srcY = Math.min(this.height - 1, Math.floor(py * stepY));
      for (let px = 0; px < pW; px++) {
        const srcX = Math.min(this.width - 1, Math.floor(px * stepX));
        const color = this.getPixel(srcX, srcY);
        proxyBuf.setPixel(px, py, color[0], color[1], color[2], color[3]);
      }
    }
    return proxyBuf;
  }
}


