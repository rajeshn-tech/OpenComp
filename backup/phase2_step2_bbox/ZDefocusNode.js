/**
 * OpenComp - ZDefocus Node
 * Depth-of-field optical defocus driven by 32-bit floating-point Z-depth map.
 * Simulates physical lens aperture, circle of confusion (CoC), and anamorphic bokeh.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer, TiledPixelBuffer } from '../core/PixelBuffer.js';

export class ZDefocusNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'ZDefocus', 'Filter', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input Image');
    this.addInput('depth', 'depth', 'Depth Map (Z)');

    this.addKnob('focusPlane', 'Focus Plane (Z)', 'number', 0.5, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('depthOfField', 'Depth of Field', 'number', 0.1, { min: 0.0, max: 0.5, step: 0.01 });
    this.addKnob('maxDefocus', 'Max Blur Radius', 'number', 12.0, { min: 0.0, max: 64.0, step: 1.0 });
    this.addKnob('aspectRatio', 'Bokeh Aspect Ratio', 'number', 1.0, { min: 0.5, max: 3.0, step: 0.1 });
    this.addKnob('bloom', 'Highlight Bloom', 'number', 0.2, { min: 0.0, max: 2.0, step: 0.05 });
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    const depthBuf = inputs['depth'];
    const focusPlane = Number(this.getKnobValue('focusPlane', context)) ?? 0.5;
    const dof = Number(this.getKnobValue('depthOfField', context)) ?? 0.1;
    const maxDefocus = Math.max(0, Number(this.getKnobValue('maxDefocus', context)) ?? 12.0);
    const aspect = Math.max(0.1, Number(this.getKnobValue('aspectRatio', context)) ?? 1.0);
    const bloom = Math.max(0, Number(this.getKnobValue('bloom', context)) ?? 0.2);

    if (maxDefocus <= 0.001 || !depthBuf) {
      return inputBuf.clone();
    }

    const w = inputBuf.width;
    const h = inputBuf.height;

    // 1. Tiled Buffer Execution
    if (inputBuf.isTiled) {
      const outBuf = new TiledPixelBuffer(w, h, inputBuf.tileSize);
      const halfDof = dof * 0.5;
      const normFactor = Math.max(0.01, 1.0 - halfDof);
      const R = Math.ceil(maxDefocus) + 2;

      const numSamples = 24;
      const sampleOffsets = [];
      const goldenAngle = 2.39996323;
      for (let i = 0; i < numSamples; i++) {
        const r = Math.sqrt((i + 0.5) / numSamples);
        const theta = i * goldenAngle;
        sampleOffsets.push({
          dx: r * Math.cos(theta) * aspect,
          dy: r * Math.sin(theta)
        });
      }

      for (let row = 0; row < outBuf.rows; row++) {
        const startY = row * outBuf.tileSize;
        for (let col = 0; col < outBuf.cols; col++) {
          const tile = outBuf.tiles[row][col];
          const startX = col * outBuf.tileSize;
          const tW = tile.width;
          const tH = tile.height;
          const dst = tile.data;

          const apronW = tW + 2 * R;
          const apronH = tH + 2 * R;
          const srcApron = inputBuf.getRegion(startX - R, startY - R, apronW, apronH, true);
          const depthApron = depthBuf.getRegion(startX - R, startY - R, apronW, apronH, true);
          const srcD = srcApron.data;
          const depthD = depthApron.data;

          const apronCoC = new Float32Array(apronW * apronH);
          for (let i = 0; i < apronW * apronH; i++) {
            const z = depthD[i * 4];
            const delta = Math.abs(z - focusPlane) - halfDof;
            apronCoC[i] = delta <= 0 ? 0 : Math.min(1.0, delta / normFactor) * maxDefocus;
          }

          for (let ty = 0; ty < tH; ty++) {
            const ay = ty + R;
            const globalY = startY + ty;
            for (let tx = 0; tx < tW; tx++) {
              const ax = tx + R;
              const globalX = startX + tx;
              const aIdx = ay * apronW + ax;
              const centerCoC = apronCoC[aIdx];
              const outP4 = (ty * tW + tx) * 4;

              if (centerCoC < 0.5) {
                const sp4 = aIdx * 4;
                dst[outP4]     = srcD[sp4];
                dst[outP4 + 1] = srcD[sp4 + 1];
                dst[outP4 + 2] = srcD[sp4 + 2];
                dst[outP4 + 3] = srcD[sp4 + 3];
                continue;
              }

              let accR = 0, accG = 0, accB = 0, accA = 0;
              let totalWeight = 0;

              for (let s = 0; s < numSamples; s++) {
                const off = sampleOffsets[s];
                const shiftX = Math.round(off.dx * centerCoC);
                const shiftY = Math.round(off.dy * centerCoC);
                const gx = globalX + shiftX;
                const gy = globalY + shiftY;

                if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
                  const asx = ax + shiftX;
                  const asy = ay + shiftY;

                  if (asx >= 0 && asx < apronW && asy >= 0 && asy < apronH) {
                    const sIdx = asy * apronW + asx;
                    const sCoC = apronCoC[sIdx];
                    const sp4 = sIdx * 4;

                    const cocWeight = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, 1.0 - (centerCoC - sCoC) / centerCoC);
                    const lum = 0.2126 * srcD[sp4] + 0.7152 * srcD[sp4 + 1] + 0.0722 * srcD[sp4 + 2];
                    const bloomWeight = 1.0 + Math.max(0, lum - 0.7) * bloom * 2.0;
                    const w_s = cocWeight * bloomWeight;

                    accR += srcD[sp4] * w_s;
                    accG += srcD[sp4 + 1] * w_s;
                    accB += srcD[sp4 + 2] * w_s;
                    accA += srcD[sp4 + 3] * w_s;
                    totalWeight += w_s;
                  }
                }
              }

              if (totalWeight > 0) {
                dst[outP4]     = accR / totalWeight;
                dst[outP4 + 1] = accG / totalWeight;
                dst[outP4 + 2] = accB / totalWeight;
                dst[outP4 + 3] = accA / totalWeight;
              } else {
                const sp4 = aIdx * 4;
                dst[outP4]     = srcD[sp4];
                dst[outP4 + 1] = srcD[sp4 + 1];
                dst[outP4 + 2] = srcD[sp4 + 2];
                dst[outP4 + 3] = srcD[sp4 + 3];
              }
            }
          }
        }
      }
      return outBuf;
    }

    // 2. Contiguous Buffer Execution
    const resampledDepth = (depthBuf.width === w && depthBuf.height === h) 
      ? depthBuf 
      : depthBuf.resample(w, h);

    const outBuf = new PixelBuffer(w, h);
    const outData = outBuf.data;
    const srcData = inputBuf.data;
    const depthData = resampledDepth.data;

    // Precalculate Circle of Confusion (CoC) map
    const cocMap = new Float32Array(w * h);
    const halfDof = dof * 0.5;
    const normFactor = Math.max(0.01, 1.0 - halfDof);

    for (let i = 0; i < w * h; i++) {
      // Use Red channel of depth map as scalar Z
      const z = depthData[i * 4];
      const delta = Math.abs(z - focusPlane) - halfDof;
      if (delta <= 0) {
        cocMap[i] = 0;
      } else {
        const cocNorm = Math.min(1.0, delta / normFactor);
        cocMap[i] = cocNorm * maxDefocus;
      }
    }

    // CoC-guided disc sampling with bilateral depth-aware weights
    // Precompute disc sample offsets (Poisson-like distribution for smooth bokeh)
    const numSamples = 24;
    const sampleOffsets = [];
    const goldenAngle = 2.39996323; // Golden angle in radians

    for (let i = 0; i < numSamples; i++) {
      const r = Math.sqrt((i + 0.5) / numSamples);
      const theta = i * goldenAngle;
      sampleOffsets.push({
        dx: r * Math.cos(theta) * aspect,
        dy: r * Math.sin(theta)
      });
    }

    // Apply optical bokeh convolution
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const centerIdx = y * w + x;
        const centerCoC = cocMap[centerIdx];

        if (centerCoC < 0.5) {
          // In focus: pass through center pixel
          const p4 = centerIdx * 4;
          outData[p4]     = srcData[p4];
          outData[p4 + 1] = srcData[p4 + 1];
          outData[p4 + 2] = srcData[p4 + 2];
          outData[p4 + 3] = srcData[p4 + 3];
          continue;
        }

        let accR = 0, accG = 0, accB = 0, accA = 0;
        let totalWeight = 0;

        for (let s = 0; s < numSamples; s++) {
          const off = sampleOffsets[s];
          const sx = Math.round(x + off.dx * centerCoC);
          const sy = Math.round(y + off.dy * centerCoC);

          if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
            const sIdx = sy * w + sx;
            const sCoC = cocMap[sIdx];
            const sp4 = sIdx * 4;

            // Optical weight: sample contributes if its CoC is >= distance to center
            const sampleDist = Math.hypot(off.dx * centerCoC, off.dy * centerCoC);
            const cocWeight = (sCoC >= centerCoC) ? 1.0 : Math.max(0.1, 1.0 - (centerCoC - sCoC) / centerCoC);

            // Highlight bloom booster
            const luma = srcData[sp4] * 0.2126 + srcData[sp4 + 1] * 0.7152 + srcData[sp4 + 2] * 0.0722;
            const bloomWeight = 1.0 + Math.max(0, luma - 0.7) * bloom * 2.0;
            const wFinal = cocWeight * bloomWeight;

            accR += srcData[sp4] * wFinal;
            accG += srcData[sp4 + 1] * wFinal;
            accB += srcData[sp4 + 2] * wFinal;
            accA += srcData[sp4 + 3] * wFinal;
            totalWeight += wFinal;
          }
        }

        const out4 = centerIdx * 4;
        if (totalWeight > 0) {
          outData[out4]     = accR / totalWeight;
          outData[out4 + 1] = accG / totalWeight;
          outData[out4 + 2] = accB / totalWeight;
          outData[out4 + 3] = accA / totalWeight;
        } else {
          outData[out4]     = srcData[out4];
          outData[out4 + 1] = srcData[out4 + 1];
          outData[out4 + 2] = srcData[out4 + 2];
          outData[out4 + 3] = srcData[out4 + 3];
        }
      }
    }

    return outBuf;
  }
}

