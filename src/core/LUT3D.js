/**
 * OpenComp - 3D LUT (.cube) Parser & Trilinear Interpolation Engine
 * Industry standard 3D LUT (.cube) parser and trilinear evaluator.
 * Supports arbitrary 3D cube sizes (e.g. 16x16x16, 33x33x33, 64x64x64).
 */

export class LUT3D {
  /**
   * @param {number} size Cube dimension (e.g. 33)
   * @param {string} [title='']
   */
  constructor(size, title = 'OpenComp_LUT3D') {
    this.size = Math.max(2, Math.floor(size));
    this.title = title;
    this.domainMin = [0.0, 0.0, 0.0];
    this.domainMax = [1.0, 1.0, 1.0];
    // Float32Array storing [r, g, b] entries in R-fastest or B-fastest order
    this.data = new Float32Array(this.size * this.size * this.size * 3);
  }

  /**
   * Parse a .cube format string into a LUT3D object
   * @param {string} text 
   * @returns {LUT3D}
   */
  static parseCube(text) {
    const lines = text.split(/\r?\n/);
    let size = 0;
    let title = 'Imported_LUT';
    const domainMin = [0.0, 0.0, 0.0];
    const domainMax = [1.0, 1.0, 1.0];
    const values = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      if (line.startsWith('TITLE')) {
        title = line.replace(/^TITLE\s+["']?|["']?$/g, '');
        continue;
      }
      if (line.startsWith('LUT_3D_SIZE')) {
        size = parseInt(line.split(/\s+/)[1], 10);
        continue;
      }
      if (line.startsWith('DOMAIN_MIN')) {
        const parts = line.split(/\s+/).slice(1).map(Number);
        if (parts.length === 3) {
          domainMin[0] = parts[0];
          domainMin[1] = parts[1];
          domainMin[2] = parts[2];
        }
        continue;
      }
      if (line.startsWith('DOMAIN_MAX')) {
        const parts = line.split(/\s+/).slice(1).map(Number);
        if (parts.length === 3) {
          domainMax[0] = parts[0];
          domainMax[1] = parts[1];
          domainMax[2] = parts[2];
        }
        continue;
      }

      // Pixel data lines: "R G B"
      const parts = line.split(/\s+/).map(Number);
      if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        values.push(parts[0], parts[1], parts[2]);
      }
    }

    if (!size || size < 2) {
      // Deduce size from values length: N^3 * 3
      const numTriplets = Math.floor(values.length / 3);
      size = Math.round(Math.cbrt(numTriplets));
      if (size * size * size !== numTriplets) {
        throw new Error(`Invalid .cube file: size could not be determined from ${numTriplets} entries`);
      }
    }

    const lut = new LUT3D(size, title);
    lut.domainMin = domainMin;
    lut.domainMax = domainMax;

    const copyLen = Math.min(lut.data.length, values.length);
    for (let i = 0; i < copyLen; i++) {
      lut.data[i] = values[i];
    }

    return lut;
  }

  /**
   * Sample the 3D LUT using Trilinear interpolation
   * @param {number} r 0.0 - 1.0
   * @param {number} g 0.0 - 1.0
   * @param {number} b 0.0 - 1.0
   * @returns {[number, number, number]} [outR, outG, outB]
   */
  sample(r, g, b) {
    const N = this.size;
    const min = this.domainMin;
    const max = this.domainMax;

    // Normalize coordinates into [0, 1] relative to domain
    const nr = Math.max(0.0, Math.min(1.0, (r - min[0]) / Math.max(1e-5, max[0] - min[0])));
    const ng = Math.max(0.0, Math.min(1.0, (g - min[1]) / Math.max(1e-5, max[1] - min[1])));
    const nb = Math.max(0.0, Math.min(1.0, (b - min[2]) / Math.max(1e-5, max[2] - min[2])));

    const fR = nr * (N - 1);
    const fG = ng * (N - 1);
    const fB = nb * (N - 1);

    const i0 = Math.floor(fR);
    const i1 = Math.min(N - 1, i0 + 1);
    const dR = fR - i0;

    const j0 = Math.floor(fG);
    const j1 = Math.min(N - 1, j0 + 1);
    const dG = fG - j0;

    const k0 = Math.floor(fB);
    const k1 = Math.min(N - 1, k0 + 1);
    const dB = fB - k0;

    // Helper to get RGB at grid indices (i, j, k)
    // In standard .cube, R is fastest, then G, then B: index = (k * N * N + j * N + i) * 3
    const getCorner = (i, j, k) => {
      const idx = (k * N * N + j * N + i) * 3;
      return [this.data[idx], this.data[idx + 1], this.data[idx + 2]];
    };

    const c000 = getCorner(i0, j0, k0);
    const c100 = getCorner(i1, j0, k0);
    const c010 = getCorner(i0, j1, k0);
    const c110 = getCorner(i1, j1, k0);

    const c001 = getCorner(i0, j0, k1);
    const c101 = getCorner(i1, j0, k1);
    const c011 = getCorner(i0, j1, k1);
    const c111 = getCorner(i1, j1, k1);

    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      // Interpolate along R
      const c00 = c000[c] * (1 - dR) + c100[c] * dR;
      const c10 = c010[c] * (1 - dR) + c110[c] * dR;
      const c01 = c001[c] * (1 - dR) + c101[c] * dR;
      const c11 = c011[c] * (1 - dR) + c111[c] * dR;

      // Interpolate along G
      const c0 = c00 * (1 - dG) + c10 * dG;
      const c1 = c01 * (1 - dG) + c11 * dG;

      // Interpolate along B
      out[c] = c0 * (1 - dB) + c1 * dB;
    }

    return out;
  }

  /**
   * Apply 3D LUT to a PixelBuffer in-place or returning a new buffer
   * @param {PixelBuffer} src 
   * @param {PixelBuffer} [dst] 
   * @returns {PixelBuffer}
   */
  applyToBuffer(src, dst = null) {
    const out = dst || src.clone();
    const sData = src.data;
    const dData = out.data;
    const len = sData.length;

    for (let i = 0; i < len; i += 4) {
      const res = this.sample(sData[i], sData[i + 1], sData[i + 2]);
      dData[i] = res[0];
      dData[i + 1] = res[1];
      dData[i + 2] = res[2];
      dData[i + 3] = sData[i + 3];
    }
    return out;
  }

  /**
   * Serialize this 3D LUT into standard .cube format text
   * @returns {string}
   */
  serializeCube() {
    let out = `# OpenComp 3D LUT Exporter\n`;
    out += `TITLE "${this.title}"\n`;
    out += `LUT_3D_SIZE ${this.size}\n`;
    out += `DOMAIN_MIN ${this.domainMin.join(' ')}\n`;
    out += `DOMAIN_MAX ${this.domainMax.join(' ')}\n\n`;

    const N = this.size;
    for (let k = 0; k < N; k++) {
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const idx = (k * N * N + j * N + i) * 3;
          out += `${this.data[idx].toFixed(6)} ${this.data[idx + 1].toFixed(6)} ${this.data[idx + 2].toFixed(6)}\n`;
        }
      }
    }
    return out;
  }
}

