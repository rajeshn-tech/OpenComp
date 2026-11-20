/**
 * OpenComp - Department 3: Depth & 2D-to-3D Stereoscopic Conversion Engine
 * Computes 32-bit floating-point depth maps, planar gradients (ground/sky),
 * roto-object depth assignment, bilateral edge-preserving smoothing, and false-color heatmap visualization.
 */

import { PixelBuffer } from './PixelBuffer.js';

export class DepthLayer {
  constructor(name = 'Depth_Plane', type = 'gradient') {
    this.id = 'dlayer_' + Math.random().toString(36).substr(2, 9);
    this.name = name;
    this.type = type; // 'gradient', 'constant', 'roto_object'
    this.depthValue = 0.5; // 0.0 = Near / Screen plane, 1.0 = Deep background
    this.gradientStart = { x: 0.5, y: 1.0, z: 0.1 }; // Bottom near ground
    this.gradientEnd = { x: 0.5, y: 0.4, z: 0.9 };   // Horizon far distance
    this.rotoShapeId = null;
    this.blendMode = 'replace'; // 'replace', 'min' (closer), 'max' (further), 'add'
    this.visible = true;
    this.opacity = 1.0;
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      depthValue: this.depthValue,
      gradientStart: { ...this.gradientStart },
      gradientEnd: { ...this.gradientEnd },
      rotoShapeId: this.rotoShapeId,
      blendMode: this.blendMode,
      visible: this.visible,
      opacity: this.opacity
    };
  }

  static deserialize(data) {
    const l = new DepthLayer(data.name, data.type);
    l.id = data.id || l.id;
    l.depthValue = Number(data.depthValue) ?? 0.5;
    if (data.gradientStart) l.gradientStart = { ...data.gradientStart };
    if (data.gradientEnd) l.gradientEnd = { ...data.gradientEnd };
    l.rotoShapeId = data.rotoShapeId || null;
    l.blendMode = data.blendMode || 'replace';
    l.visible = data.visible !== undefined ? data.visible : true;
    l.opacity = Number(data.opacity) ?? 1.0;
    return l;
  }
}

export class DepthMapEngine {
  /**
   * Generates a 32-bit float grayscale depth buffer
   */
  static generateDepthMap(width, height, options = {}) {
    const buf = new PixelBuffer(width, height);
    const d = buf.data;

    const baseDepth = options.baseDepth !== undefined ? options.baseDepth : 0.8;
    const gradientType = options.gradientType || 'ground_plane'; // 'ground_plane', 'linear', 'radial'
    const nearClip = options.nearClip !== undefined ? options.nearClip : 0.0;
    const farClip = options.farClip !== undefined ? options.farClip : 1.0;
    const contrast = options.contrast !== undefined ? options.contrast : 1.0;
    const offset = options.offset !== undefined ? options.offset : 0.0;

    for (let y = 0; y < height; y++) {
      const v = y / height;
      const rowOffset = y * width;

      for (let x = 0; x < width; x++) {
        const u = x / width;
        let z = baseDepth;

        if (gradientType === 'ground_plane') {
          // Perspective ground receding towards horizon at y = 0.45
          const horizon = 0.45;
          if (v >= horizon) {
            // Non-linear perspective foreshortening
            const groundT = (v - horizon) / (1.0 - horizon);
            z = 0.95 - 0.85 * Math.pow(groundT, 1.5);
          } else {
            // Sky / distant background
            z = 0.95 + 0.05 * (1.0 - (v / horizon));
          }
        } else if (gradientType === 'linear') {
          z = (1.0 - v);
        } else if (gradientType === 'radial') {
          const dx = u - 0.5;
          const dy = v - 0.5;
          const dist = Math.sqrt(dx * dx + dy * dy);
          z = Math.min(1.0, dist * 2.0);
        }

        // Apply contrast, offset, and clip
        z = (z - 0.5) * contrast + 0.5 + offset;
        z = Math.max(nearClip, Math.min(farClip, z));

        const idx = (rowOffset + x) * 4;
        d[idx] = z;
        d[idx + 1] = z;
        d[idx + 2] = z;
        d[idx + 3] = 1.0;
      }
    }

    return buf;
  }

  /**
   * Applies object depth inside a Roto Matte
   */
  static applyRotoObjectDepth(depthBuffer, rotoAlphaBuffer, objectDepth, blendMode = 'replace') {
    const d = depthBuffer.data;
    const mask = rotoAlphaBuffer.data || rotoAlphaBuffer;
    const len = d.length;

    for (let i = 0; i < len; i += 4) {
      const alpha = mask[i + 3] !== undefined ? mask[i + 3] : mask[i / 4];
      if (alpha <= 0.001) continue;

      const currentZ = d[i];
      let targetZ = objectDepth;

      if (blendMode === 'min') {
        targetZ = Math.min(currentZ, objectDepth);
      } else if (blendMode === 'max') {
        targetZ = Math.max(currentZ, objectDepth);
      }

      const blendedZ = currentZ * (1.0 - alpha) + targetZ * alpha;
      d[i] = blendedZ;
      d[i + 1] = blendedZ;
      d[i + 2] = blendedZ;
    }
  }

  /**
   * Edge-preserving depth smoothing (Bilateral-style filter)
   */
  static smoothDepth(depthBuffer, radius = 2, spatialSigma = 2.0, rangeSigma = 0.1) {
    const w = depthBuffer.width;
    const h = depthBuffer.height;
    const src = depthBuffer.data;
    const out = new PixelBuffer(w, h);
    const dst = out.data;

    const twoSpatialSigmaSq = 2.0 * spatialSigma * spatialSigma;
    const twoRangeSigmaSq = 2.0 * rangeSigma * rangeSigma;

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const centerIdx = (rowOffset + x) * 4;
        const centerZ = src[centerIdx];

        let sumWeight = 0;
        let sumZ = 0;

        for (let dy = -radius; dy <= radius; dy++) {
          const py = Math.max(0, Math.min(h - 1, y + dy));
          const pRowOffset = py * w;

          for (let dx = -radius; dx <= radius; dx++) {
            const px = Math.max(0, Math.min(w - 1, x + dx));
            const pIdx = (pRowOffset + px) * 4;
            const pZ = src[pIdx];

            const spatialDistSq = dx * dx + dy * dy;
            const rangeDistSq = (pZ - centerZ) * (pZ - centerZ);

            const weight = Math.exp(-spatialDistSq / twoSpatialSigmaSq) * Math.exp(-rangeDistSq / twoRangeSigmaSq);

            sumZ += pZ * weight;
            sumWeight += weight;
          }
        }

        const filteredZ = sumWeight > 0.0 ? sumZ / sumWeight : centerZ;
        dst[centerIdx] = filteredZ;
        dst[centerIdx + 1] = filteredZ;
        dst[centerIdx + 2] = filteredZ;
        dst[centerIdx + 3] = src[centerIdx + 3];
      }
    }

    return out;
  }

  /**
   * Converts a grayscale depth buffer to a false-color heatmap (Turbo/Jet palette)
   * for stereoscopic visual inspection (Near = Blue, Mid = Green/Yellow, Far = Red)
   */
  static colorizeHeatmap(depthBuffer) {
    const w = depthBuffer.width;
    const h = depthBuffer.height;
    const src = depthBuffer.data;
    const out = new PixelBuffer(w, h);
    const dst = out.data;
    const len = src.length;

    for (let i = 0; i < len; i += 4) {
      const z = Math.max(0.0, Math.min(1.0, src[i]));

      // 4-stop Turbo-style false color ramp
      let r = 0, g = 0, b = 0;
      if (z < 0.25) {
        const t = z / 0.25;
        r = 0.1 * (1 - t);
        g = 0.2 + 0.6 * t;
        b = 0.9;
      } else if (z < 0.5) {
        const t = (z - 0.25) / 0.25;
        r = 0.1 + 0.8 * t;
        g = 0.8 + 0.2 * t;
        b = 0.9 * (1 - t);
      } else if (z < 0.75) {
        const t = (z - 0.5) / 0.25;
        r = 0.9 + 0.1 * t;
        g = 1.0 * (1 - t) + 0.5 * t;
        b = 0.0;
      } else {
        const t = (z - 0.75) / 0.25;
        r = 1.0;
        g = 0.5 * (1 - t);
        b = 0.2 * t;
      }

      dst[i] = r;
      dst[i + 1] = g;
      dst[i + 2] = b;
      dst[i + 3] = 1.0;
    }

    return out;
  }
}

