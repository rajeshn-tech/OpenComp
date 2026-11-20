/**
 * OpenComp - CornerPin 2D Node
 * 4-Corner perspective homography warping, identical to Foundry Nuke's CornerPin2D.
 * Used for screen replacement, sign insertion, and planar perspective distortion.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class CornerPinNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'CornerPin', 'Transform', x, y);
    this.width = 110;
    this.height = 36;

    this.addInput('in', 'in', 'Input');

    // 4 Pin corners in normalized percentages (0.0 to 1.0)
    // 1: Bottom-Left, 2: Bottom-Right, 3: Top-Right, 4: Top-Left
    this.addKnob('to1_x', 'Pin 1 X (BL)', 'number', 0.1, { min: -0.5, max: 1.5, step: 0.01 });
    this.addKnob('to1_y', 'Pin 1 Y (BL)', 'number', 0.1, { min: -0.5, max: 1.5, step: 0.01 });

    this.addKnob('to2_x', 'Pin 2 X (BR)', 'number', 0.9, { min: -0.5, max: 1.5, step: 0.01 });
    this.addKnob('to2_y', 'Pin 2 Y (BR)', 'number', 0.15, { min: -0.5, max: 1.5, step: 0.01 });

    this.addKnob('to3_x', 'Pin 3 X (TR)', 'number', 0.85, { min: -0.5, max: 1.5, step: 0.01 });
    this.addKnob('to3_y', 'Pin 3 Y (TR)', 'number', 0.9, { min: -0.5, max: 1.5, step: 0.01 });

    this.addKnob('to4_x', 'Pin 4 X (TL)', 'number', 0.15, { min: -0.5, max: 1.5, step: 0.01 });
    this.addKnob('to4_y', 'Pin 4 Y (TL)', 'number', 0.85, { min: -0.5, max: 1.5, step: 0.01 });
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    const w = inputBuf.width;
    const h = inputBuf.height;
    const result = new PixelBuffer(w, h);
    const src = inputBuf.data;
    const dst = result.data;

    // Target Quad points: handles both normalized [0..1] and absolute pixel coordinates
    const getCoord = (knobKey, dim, defaultNorm) => {
      const v = Number(this.getKnobValue(knobKey, context));
      if (isNaN(v)) return defaultNorm * dim;
      if (Math.abs(v) > 1.5) return v;
      return v * dim;
    };

    const p1 = { x: getCoord('to1_x', w, 0.0), y: getCoord('to1_y', h, 0.0) };
    const p2 = { x: getCoord('to2_x', w, 1.0), y: getCoord('to2_y', h, 0.0) };
    const p3 = { x: getCoord('to3_x', w, 1.0), y: getCoord('to3_y', h, 1.0) };
    const p4 = { x: getCoord('to4_x', w, 0.0), y: getCoord('to4_y', h, 1.0) };

    // Compute inverse homography matrix mapping from destination (x, y) back to source rectangle (0,0)-(w,h)
    const Hinv = CornerPinNode.computeHomography(
      p1, p2, p3, p4,
      { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }
    );

    if (!Hinv) return inputBuf.clone();

    // Iterate over destination canvas and sample from source
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        // Project (x, y) through Hinv
        const Z = Hinv[6] * x + Hinv[7] * y + Hinv[8];
        if (Math.abs(Z) < 0.00001) continue;

        const srcX = (Hinv[0] * x + Hinv[1] * y + Hinv[2]) / Z;
        const srcY = (Hinv[3] * x + Hinv[4] * y + Hinv[5]) / Z;

        // Bilinear subpixel sampling with boundary clamping
        if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
          const x0 = Math.floor(srcX);
          const y0 = Math.floor(srcY);
          const x1 = Math.min(w - 1, x0 + 1);
          const y1 = Math.min(h - 1, y0 + 1);

          const wx = srcX - x0;
          const wy = srcY - y0;

          const idx00 = (y0 * w + x0) * 4;
          const idx10 = (y0 * w + x1) * 4;
          const idx01 = (y1 * w + x0) * 4;
          const idx11 = (y1 * w + x1) * 4;

          const outIdx = (rowOffset + x) * 4;

          for (let c = 0; c < 4; c++) {
            const top = src[idx00 + c] * (1 - wx) + src[idx10 + c] * wx;
            const bottom = src[idx01 + c] * (1 - wx) + src[idx11 + c] * wx;
            dst[outIdx + c] = top * (1 - wy) + bottom * wy;
          }
        }
      }
    }

    return result;
  }

  /**
   * Computes a 3x3 homography matrix transforming quad1 points to quad2 points
   */
  static computeHomography(p0, p1, p2, p3, q0, q1, q2, q3) {
    const A = [];
    const ptsSrc = [p0, p1, p2, p3];
    const ptsDst = [q0, q1, q2, q3];

    for (let i = 0; i < 4; i++) {
      const sx = ptsSrc[i].x, sy = ptsSrc[i].y;
      const dx = ptsDst[i].x, dy = ptsDst[i].y;
      A.push([-sx, -sy, -1, 0, 0, 0, sx * dx, sy * dx, dx]);
      A.push([0, 0, 0, -sx, -sy, -1, sx * dy, sy * dy, dy]);
    }

    // Solve Ah = 0 using Gaussian elimination
    for (let i = 0; i < 8; i++) {
      let maxRow = i;
      for (let j = i + 1; j < 8; j++) {
        if (Math.abs(A[j][i]) > Math.abs(A[maxRow][i])) maxRow = j;
      }
      [A[i], A[maxRow]] = [A[maxRow], A[i]];

      const pivot = A[i][i];
      if (Math.abs(pivot) < 1e-10) continue;

      for (let k = i; k < 9; k++) A[i][k] /= pivot;

      for (let j = 0; j < 8; j++) {
        if (j !== i) {
          const factor = A[j][i];
          for (let k = i; k < 9; k++) {
            A[j][k] -= factor * A[i][k];
          }
        }
      }
    }

    const H = [
      -A[0][8], -A[1][8], -A[2][8],
      -A[3][8], -A[4][8], -A[5][8],
      -A[6][8], -A[7][8], 1.0
    ];

    return H;
  }
}

