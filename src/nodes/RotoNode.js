/**
 * OpenComp - Professional Roto Node
 * Supports multi-spline vector Bezier/B-Spline shapes, control points, keyframes,
 * edge feathering, and non-destructive matte generation.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer, TiledPixelBuffer } from '../core/PixelBuffer.js';
import { RotoShape } from '../core/RotoSpline.js';

export class RotoNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Roto', 'Channel', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('in', 'in', 'Input (Optional)');

    /** @type {RotoShape[]} */
    this.shapes = [];

    // Fallback procedural knobs for quick primitives
    this.addKnob('outputMode', 'Output Mode', 'select', 'replace_alpha', {
      options: [
        { label: 'Replace Alpha Channel', value: 'replace_alpha' },
        { label: 'RGBA Matte Only', value: 'matte_only' },
        { label: 'Premultiply RGB with Matte', value: 'premult' }
      ]
    });

    this.addKnob('shape', 'Shape', 'select', 'ellipse', {
      options: [
        { label: 'Ellipse / Oval', value: 'ellipse' },
        { label: 'Rectangle / Box', value: 'rectangle' },
        { label: 'Cinematic Vignette', value: 'vignette' }
      ]
    });

    this.addKnob('centerX', 'Center X', 'number', 0.5, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('centerY', 'Center Y', 'number', 0.5, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('radiusX', 'Radius X / Width', 'number', 0.35, { min: 0.01, max: 1.0, step: 0.01 });
    this.addKnob('radiusY', 'Radius Y / Height', 'number', 0.35, { min: 0.01, max: 1.0, step: 0.01 });
    this.addKnob('feather', 'Feather / Softness', 'number', 0.15, { min: 0.0, max: 0.5, step: 0.01 });
    this.addKnob('invert', 'Invert Matte', 'boolean', false);
    this.addKnob('opacity', 'Opacity', 'number', 1.0, { min: 0.0, max: 1.0, step: 0.05 });
  }

  addShape(shapeOrName = 'Bezier_1') {
    const shape = (typeof shapeOrName === 'string') ? new RotoShape(shapeOrName) : shapeOrName;
    this.shapes.push(shape);
    this.markDirty();
    return shape;
  }

  removeShape(id) {
    const idx = this.shapes.findIndex(s => s.id === id);
    if (idx >= 0) {
      this.shapes.splice(idx, 1);
      this.markDirty();
      return true;
    }
    return false;
  }

  getShape(id) {
    return this.shapes.find(s => s.id === id) || null;
  }

  moveShape(idOrName, direction) {
    const idx = this.shapes.findIndex(s => s.id === idOrName || s.name === idOrName);
    if (idx < 0) return false;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= this.shapes.length) return false;
    const [shape] = this.shapes.splice(idx, 1);
    this.shapes.splice(targetIdx, 0, shape);
    this.markDirty();
    return true;
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    const w = inputBuf ? inputBuf.width : 1920;
    const h = inputBuf ? inputBuf.height : 1080;
    const frame = context && context.frame !== undefined ? context.frame : 1;
    const outputMode = this.getKnobValue('outputMode') || 'replace_alpha';

    // 1. Tiled Buffer Execution
    if (inputBuf && inputBuf.isTiled) {
      const result = new TiledPixelBuffer(w, h, inputBuf.tileSize);
      const shape = this.getKnobValue('shape') || 'ellipse';
      const cx = (Number(this.getKnobValue('centerX')) ?? 0.5) * w;
      const cy = (Number(this.getKnobValue('centerY')) ?? 0.5) * h;
      const rx = Math.max(1, (Number(this.getKnobValue('radiusX')) ?? 0.35) * w);
      const ry = Math.max(1, (Number(this.getKnobValue('radiusY')) ?? 0.35) * h);
      const feather = Math.max(0.0001, (Number(this.getKnobValue('feather')) ?? 0.15) * Math.min(rx, ry));
      const invert = !!this.getKnobValue('invert');
      const opacity = Number(this.getKnobValue('opacity')) ?? 1.0;

      for (let r = 0; r < result.rows; r++) {
        const startY = r * result.tileSize;
        for (let c = 0; c < result.cols; c++) {
          const tile = result.tiles[r][c];
          const inTile = inputBuf.tiles[r][c];
          const startX = c * result.tileSize;
          const tW = tile.width;
          const tH = tile.height;
          const dst = tile.data;
          const src = inTile.data;

          if (this.shapes.length > 0) {
            const alphaBuffer = new Float32Array(tW * tH);
            const hasSolo = this.shapes.some(s => s.solo);
            for (const shapeObj of this.shapes) {
              if (hasSolo && !shapeObj.solo) continue;
              if (!shapeObj.visible) continue;
              shapeObj.rasterizeTile(alphaBuffer, tW, tH, startX, startY, frame);
            }

            for (let i = 0; i < tW * tH; i++) {
              const outIdx = i * 4;
              const matte = alphaBuffer[i];

              if (outputMode === 'matte_only' || !src) {
                dst[outIdx] = matte;
                dst[outIdx + 1] = matte;
                dst[outIdx + 2] = matte;
                dst[outIdx + 3] = matte;
              } else if (outputMode === 'premult') {
                dst[outIdx] = src[outIdx] * matte;
                dst[outIdx + 1] = src[outIdx + 1] * matte;
                dst[outIdx + 2] = src[outIdx + 2] * matte;
                dst[outIdx + 3] = matte;
              } else {
                dst[outIdx] = src[outIdx];
                dst[outIdx + 1] = src[outIdx + 1];
                dst[outIdx + 2] = src[outIdx + 2];
                dst[outIdx + 3] = matte;
              }
            }
          } else {
            // Procedural per-tile
            for (let ty = 0; ty < tH; ty++) {
              const y = startY + ty;
              for (let tx = 0; tx < tW; tx++) {
                const x = startX + tx;
                const outIdx = (ty * tW + tx) * 4;
                let distNorm = 0.0;

                if (shape === 'ellipse' || shape === 'vignette') {
                  const dx = (x - cx) / rx;
                  const dy = (y - cy) / ry;
                  distNorm = Math.sqrt(dx * dx + dy * dy);
                } else if (shape === 'rectangle') {
                  const dx = Math.abs(x - cx) / rx;
                  const dy = Math.abs(y - cy) / ry;
                  distNorm = Math.max(dx, dy);
                }

                let matte = 0.0;
                const featherNorm = feather / Math.min(rx, ry);

                if (distNorm <= 1.0 - featherNorm) {
                  matte = 1.0;
                } else if (distNorm >= 1.0 + featherNorm) {
                  matte = 0.0;
                } else {
                  const t = (distNorm - (1.0 - featherNorm)) / (2.0 * featherNorm);
                  matte = 1.0 - (t * t * (3.0 - 2.0 * t));
                }

                if (shape === 'vignette') matte = 1.0 - matte;
                if (invert) matte = 1.0 - matte;
                matte *= opacity;

                if (src) {
                  dst[outIdx] = src[outIdx];
                  dst[outIdx + 1] = src[outIdx + 1];
                  dst[outIdx + 2] = src[outIdx + 2];
                  dst[outIdx + 3] = matte;
                } else {
                  dst[outIdx] = matte;
                  dst[outIdx + 1] = matte;
                  dst[outIdx + 2] = matte;
                  dst[outIdx + 3] = matte;
                }
              }
            }
          }
        }
      }
      return result;
    }

    // 2. Contiguous Buffer Execution
    const result = new PixelBuffer(w, h);
    const dst = result.data;
    const src = inputBuf ? inputBuf.data : null;

    // If manual vector shapes are defined, rasterize them
    if (this.shapes.length > 0) {
      const alphaBuffer = new Float32Array(w * h);
      const hasSolo = this.shapes.some(s => s.solo);

      for (const shape of this.shapes) {
        if (hasSolo && !shape.solo) continue;
        if (!shape.visible) continue;
        shape.rasterize(alphaBuffer, w, h, frame);
      }

      for (let i = 0; i < w * h; i++) {
        const outIdx = i * 4;
        const matte = alphaBuffer[i];

        if (outputMode === 'matte_only' || !src) {
          dst[outIdx] = matte;
          dst[outIdx + 1] = matte;
          dst[outIdx + 2] = matte;
          dst[outIdx + 3] = matte;
        } else if (outputMode === 'premult') {
          dst[outIdx] = src[outIdx] * matte;
          dst[outIdx + 1] = src[outIdx + 1] * matte;
          dst[outIdx + 2] = src[outIdx + 2] * matte;
          dst[outIdx + 3] = matte;
        } else { // 'replace_alpha'
          dst[outIdx] = src[outIdx];
          dst[outIdx + 1] = src[outIdx + 1];
          dst[outIdx + 2] = src[outIdx + 2];
          dst[outIdx + 3] = matte;
        }
      }

      return result;
    }

    // Fallback procedural evaluation
    const shape = this.getKnobValue('shape') || 'ellipse';
    const cx = (Number(this.getKnobValue('centerX')) ?? 0.5) * w;
    const cy = (Number(this.getKnobValue('centerY')) ?? 0.5) * h;
    const rx = Math.max(1, (Number(this.getKnobValue('radiusX')) ?? 0.35) * w);
    const ry = Math.max(1, (Number(this.getKnobValue('radiusY')) ?? 0.35) * h);
    const feather = Math.max(0.0001, (Number(this.getKnobValue('feather')) ?? 0.15) * Math.min(rx, ry));
    const invert = !!this.getKnobValue('invert');
    const opacity = Number(this.getKnobValue('opacity')) ?? 1.0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const outIdx = (y * w + x) * 4;
        let distNorm = 0.0;

        if (shape === 'ellipse' || shape === 'vignette') {
          const dx = (x - cx) / rx;
          const dy = (y - cy) / ry;
          distNorm = Math.sqrt(dx * dx + dy * dy);
        } else if (shape === 'rectangle') {
          const dx = Math.abs(x - cx) / rx;
          const dy = Math.abs(y - cy) / ry;
          distNorm = Math.max(dx, dy);
        }

        let matte = 0.0;
        const featherNorm = feather / Math.min(rx, ry);

        if (distNorm <= 1.0 - featherNorm) {
          matte = 1.0;
        } else if (distNorm >= 1.0 + featherNorm) {
          matte = 0.0;
        } else {
          const t = (distNorm - (1.0 - featherNorm)) / (2.0 * featherNorm);
          matte = 1.0 - (t * t * (3.0 - 2.0 * t));
        }

        if (shape === 'vignette') matte = 1.0 - matte;
        if (invert) matte = 1.0 - matte;
        matte *= opacity;

        if (src) {
          dst[outIdx] = src[outIdx];
          dst[outIdx + 1] = src[outIdx + 1];
          dst[outIdx + 2] = src[outIdx + 2];
          dst[outIdx + 3] = matte;
        } else {
          dst[outIdx] = matte;
          dst[outIdx + 1] = matte;
          dst[outIdx + 2] = matte;
          dst[outIdx + 3] = matte;
        }
      }
    }

    return result;
  }

  serialize() {
    const data = super.serialize();
    data.shapes = this.shapes.map(s => s.serialize());
    return data;
  }

  deserialize(data) {
    super.deserialize(data);
    if (data.shapes && Array.isArray(data.shapes)) {
      this.shapes = data.shapes.map(sd => RotoShape.deserialize(sd));
    }
  }
}
