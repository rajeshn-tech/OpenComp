/**
 * OpenComp - Department 4: Stereo Compositing & DIBR Warping Engine
 * Generates stereoscopic Left & Right eye views from Mono + Depth via
 * Depth-Image-Based Rendering (DIBR), disocclusion hole-filling, Red/Cyan anaglyph,
 * side-by-side 3D packing, and disparity difference analysis.
 */

import { PixelBuffer } from './PixelBuffer.js';

export class StereoEngine {
  /**
   * Warps a 2D mono image into stereoscopic Left and Right eye views
   * @param {PixelBuffer} monoBuffer 
   * @param {PixelBuffer} depthBuffer 
   * @param {number} convergence Zero-parallax screen plane (default 0.5)
   * @param {number} separation Interaxial disparity separation in pixels (default 12.0)
   * @param {boolean} fillDisocclusion Whether to inpaint occlusion gaps
   */
  static warpStereoViews(monoBuffer, depthBuffer, convergence = 0.5, separation = 12.0, fillDisocclusion = true) {
    const w = monoBuffer.width;
    const h = monoBuffer.height;
    const mono = monoBuffer.data;
    const depth = depthBuffer ? depthBuffer.data : null;

    const left = new PixelBuffer(w, h);
    const right = new PixelBuffer(w, h);
    const lData = left.data;
    const rData = right.data;

    // Disocclusion tracking masks (0 = filled, 1 = hole)
    const lHoles = new Uint8Array(w * h);
    const rHoles = new Uint8Array(w * h);

    // Z-buffers initialized to infinity (1e9) for proper depth-priority occlusion
    const lZBuf = new Float32Array(w * h);
    const rZBuf = new Float32Array(w * h);
    lZBuf.fill(1e9);
    rZBuf.fill(1e9);

    // Initialize with transparent black
    lData.fill(0.0);
    rData.fill(0.0);
    lHoles.fill(1);
    rHoles.fill(1);

    // 1. Forward Disparity Warping with Depth Priority (Z-Buffer)
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;

      for (let x = 0; x < w; x++) {
        const idx = (rowOffset + x) * 4;
        const z = depth ? depth[idx] : 0.5;

        // Disparity offset
        const disp = separation * (1.0 - (z / Math.max(0.01, convergence)));

        const lx = Math.round(x + disp * 0.5);
        const rx = Math.round(x - disp * 0.5);

        // Splat into Left Eye with Z-test
        if (lx >= 0 && lx < w) {
          const lBufIdx = rowOffset + lx;
          if (z <= lZBuf[lBufIdx]) {
            lZBuf[lBufIdx] = z;
            const lIdx = lBufIdx * 4;
            lData[lIdx] = mono[idx];
            lData[lIdx + 1] = mono[idx + 1];
            lData[lIdx + 2] = mono[idx + 2];
            lData[lIdx + 3] = mono[idx + 3];
            lHoles[lBufIdx] = 0;
          }
        }

        // Splat into Right Eye with Z-test
        if (rx >= 0 && rx < w) {
          const rBufIdx = rowOffset + rx;
          if (z <= rZBuf[rBufIdx]) {
            rZBuf[rBufIdx] = z;
            const rIdx = rBufIdx * 4;
            rData[rIdx] = mono[idx];
            rData[rIdx + 1] = mono[idx + 1];
            rData[rIdx + 2] = mono[idx + 2];
            rData[rIdx + 3] = mono[idx + 3];
            rHoles[rBufIdx] = 0;
          }
        }
      }
    }

    // 2. Disocclusion Hole-Filling & Background Edge Inpainting
    if (fillDisocclusion) {
      this.inpaintHoles(lData, lHoles, lZBuf, mono, w, h);
      this.inpaintHoles(rData, rHoles, rZBuf, mono, w, h);
    }

    return { left, right };
  }

  /**
   * Depth-aware background dilation hole filling to eliminate black disocclusion tears
   * and prevent foreground object color bleeding across edges.
   */
  static inpaintHoles(targetData, holeMask, zBuf, fallbackMono, width, height) {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;

      for (let x = 0; x < width; x++) {
        const maskIdx = rowOffset + x;
        if (holeMask[maskIdx] === 1) {
          const targetIdx = maskIdx * 4;

          // Find closest valid pixel along horizontal scanline
          let leftValid = -1;
          for (let sx = x - 1; sx >= 0; sx--) {
            if (holeMask[rowOffset + sx] === 0) {
              leftValid = sx;
              break;
            }
          }

          let rightValid = -1;
          for (let sx = x + 1; sx < width; sx++) {
            if (holeMask[rowOffset + sx] === 0) {
              rightValid = sx;
              break;
            }
          }

          let sampledIdx = -1;
          if (leftValid >= 0 && rightValid >= 0) {
            const zL = zBuf ? zBuf[rowOffset + leftValid] : 0.5;
            const zR = zBuf ? zBuf[rowOffset + rightValid] : 0.5;
            // Larger Z is deeper in the background (smaller Z is foreground)
            // Always inpaint from the background surface to prevent foreground edge bleeding
            if (zL >= zR) {
              sampledIdx = (rowOffset + leftValid) * 4;
            } else {
              sampledIdx = (rowOffset + rightValid) * 4;
            }
          } else if (leftValid >= 0) {
            sampledIdx = (rowOffset + leftValid) * 4;
          } else if (rightValid >= 0) {
            sampledIdx = (rowOffset + rightValid) * 4;
          }

          if (sampledIdx >= 0) {
            targetData[targetIdx] = targetData[sampledIdx];
            targetData[targetIdx + 1] = targetData[sampledIdx + 1];
            targetData[targetIdx + 2] = targetData[sampledIdx + 2];
            targetData[targetIdx + 3] = targetData[sampledIdx + 3];
          } else {
            // Fallback to original mono plate
            targetData[targetIdx] = fallbackMono[targetIdx];
            targetData[targetIdx + 1] = fallbackMono[targetIdx + 1];
            targetData[targetIdx + 2] = fallbackMono[targetIdx + 2];
            targetData[targetIdx + 3] = fallbackMono[targetIdx + 3];
          }
        }
      }
    }
  }

  /**
   * Generates Red/Cyan 3D Anaglyph image
   */
  static compositeAnaglyph(leftBuffer, rightBuffer) {
    const w = leftBuffer.width;
    const h = leftBuffer.height;
    const l = leftBuffer.data;
    const r = rightBuffer.data;

    const out = new PixelBuffer(w, h);
    const dst = out.data;
    const len = dst.length;

    for (let i = 0; i < len; i += 4) {
      // Left eye luminance -> Red Channel
      // Right eye green & blue -> Green & Blue Channels
      const leftLuma = 0.299 * l[i] + 0.587 * l[i + 1] + 0.114 * l[i + 2];
      dst[i] = leftLuma;
      dst[i + 1] = r[i + 1];
      dst[i + 2] = r[i + 2];
      dst[i + 3] = 1.0;
    }

    return out;
  }

  /**
   * Generates Side-by-Side 3D packing (Left | Right)
   */
  static compositeSideBySide(leftBuffer, rightBuffer) {
    const w = leftBuffer.width;
    const h = leftBuffer.height;
    const l = leftBuffer.data;
    const r = rightBuffer.data;

    const out = new PixelBuffer(w * 2, h);
    const dst = out.data;
    const outW = w * 2;

    for (let y = 0; y < h; y++) {
      const srcRow = y * w;
      const dstRow = y * outW;

      // Left half
      for (let x = 0; x < w; x++) {
        const srcIdx = (srcRow + x) * 4;
        const dstIdx = (dstRow + x) * 4;
        dst[dstIdx] = l[srcIdx];
        dst[dstIdx + 1] = l[srcIdx + 1];
        dst[dstIdx + 2] = l[srcIdx + 2];
        dst[dstIdx + 3] = l[srcIdx + 3];
      }

      // Right half
      for (let x = 0; x < w; x++) {
        const srcIdx = (srcRow + x) * 4;
        const dstIdx = (dstRow + w + x) * 4;
        dst[dstIdx] = r[srcIdx];
        dst[dstIdx + 1] = r[srcIdx + 1];
        dst[dstIdx + 2] = r[srcIdx + 2];
        dst[dstIdx + 3] = r[srcIdx + 3];
      }
    }

    return out;
  }

  /**
   * Computes absolute disparity difference (|Left - Right|)
   */
  static compositeDifference(leftBuffer, rightBuffer) {
    const w = leftBuffer.width;
    const h = leftBuffer.height;
    const l = leftBuffer.data;
    const r = rightBuffer.data;

    const out = new PixelBuffer(w, h);
    const dst = out.data;
    const len = dst.length;

    for (let i = 0; i < len; i += 4) {
      dst[i] = Math.abs(l[i] - r[i]);
      dst[i + 1] = Math.abs(l[i + 1] - r[i + 1]);
      dst[i + 2] = Math.abs(l[i + 2] - r[i + 2]);
      dst[i + 3] = 1.0;
    }

    return out;
  }

  /**
   * Interactive Wipe split-screen (Left on left, Right on right)
   */
  static compositeWipe(leftBuffer, rightBuffer, wipeRatio = 0.5) {
    const w = leftBuffer.width;
    const h = leftBuffer.height;
    const l = leftBuffer.data;
    const r = rightBuffer.data;

    const out = new PixelBuffer(w, h);
    const dst = out.data;
    const splitX = Math.round(w * Math.max(0.0, Math.min(1.0, wipeRatio)));

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const idx = (row + x) * 4;
        if (x < splitX) {
          dst[idx] = l[idx];
          dst[idx + 1] = l[idx + 1];
          dst[idx + 2] = l[idx + 2];
          dst[idx + 3] = l[idx + 3];
        } else if (x === splitX) {
          // 1px divider line (White)
          dst[idx] = 1.0;
          dst[idx + 1] = 1.0;
          dst[idx + 2] = 1.0;
          dst[idx + 3] = 1.0;
        } else {
          dst[idx] = r[idx];
          dst[idx + 1] = r[idx + 1];
          dst[idx + 2] = r[idx + 2];
          dst[idx + 3] = r[idx + 3];
        }
      }
    }

    return out;
  }
}
