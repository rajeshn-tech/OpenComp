/**
 * OpenComp - ContactSheet Node
 * Assembles multiple input plates into an arrayed grid / matrix for visual comparison.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';
import { BBox } from '../core/BBox.js';

export class ContactSheetNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'ContactSheet', 'Image', x, y);
    this.width = 110;
    this.height = 38;

    this.addInput('0', '0', 'Input 0 (Top-Left)');
    this.addInput('1', '1', 'Input 1 (Top-Right)');
    this.addInput('2', '2', 'Input 2 (Bottom-Left)');
    this.addInput('3', '3', 'Input 3 (Bottom-Right)');

    this.addKnob('rows', 'Rows', 'number', 2, { min: 1, max: 4, step: 1 });
    this.addKnob('columns', 'Columns', 'number', 2, { min: 1, max: 4, step: 1 });
    this.addKnob('width', 'Width', 'number', 1920, { min: 64, max: 15360, step: 2 });
    this.addKnob('height', 'Height', 'number', 1080, { min: 64, max: 8640, step: 2 });
  }

  /**
   * Determine output dynamic BBox: grid composition of active cell bounding boxes
   * @param {Object.<string, PixelBuffer>} inputs 
   * @param {Object} [context={}] 
   * @returns {BBox}
   */
  getBBox(inputs, context = {}) {
    const rows = Math.max(1, Math.round(Number(this.getKnobValue('rows', context)) || 2));
    const cols = Math.max(1, Math.round(Number(this.getKnobValue('columns', context)) || 2));
    const outW = Math.max(64, Math.round(Number(this.getKnobValue('width', context) ?? this.getKnobValue('outputWidth', context)) || 1920));
    const outH = Math.max(64, Math.round(Number(this.getKnobValue('height', context) ?? this.getKnobValue('outputHeight', context)) || 1080));

    const cellW = Math.floor(outW / cols);
    const cellH = Math.floor(outH / rows);

    let compositeBox = null;
    let hasAnyInput = false;

    let cellIndex = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const inputKey = String(cellIndex);
        const cellBuf = inputs[inputKey];
        if (cellBuf) {
          hasAnyInput = true;
          const startX = c * cellW;
          const startY = r * cellH;
          const inBox = cellBuf.bbox;

          if (inBox && !inBox.isEmpty()) {
            const scaleX = cellW / Math.max(1, cellBuf.width);
            const scaleY = cellH / Math.max(1, cellBuf.height);
            const cellBBox = new BBox(
              Math.floor(startX + inBox.x * scaleX),
              Math.floor(startY + inBox.y * scaleY),
              Math.ceil(startX + inBox.r * scaleX),
              Math.ceil(startY + inBox.t * scaleY)
            );
            compositeBox = compositeBox ? compositeBox.union(cellBBox) : cellBBox;
          } else {
            const fullCell = new BBox(startX, startY, startX + cellW, startY + cellH);
            compositeBox = compositeBox ? compositeBox.union(fullCell) : fullCell;
          }
        }
        cellIndex++;
      }
    }

    if (!hasAnyInput || !compositeBox) {
      return new BBox(0, 0, 0, 0);
    }
    return compositeBox;
  }

  compute(inputs, context = {}) {
    const rows = Math.max(1, Math.round(Number(this.getKnobValue('rows', context)) || 2));
    const cols = Math.max(1, Math.round(Number(this.getKnobValue('columns', context)) || 2));
    const outW = Math.max(64, Math.round(Number(this.getKnobValue('width', context) ?? this.getKnobValue('outputWidth', context)) || 1920));
    const outH = Math.max(64, Math.round(Number(this.getKnobValue('height', context) ?? this.getKnobValue('outputHeight', context)) || 1080));

    const cellW = Math.floor(outW / cols);
    const cellH = Math.floor(outH / rows);

    const outBuf = new PixelBuffer(outW, outH);
    const outData = outBuf.data;

    let cellIndex = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const inputKey = String(cellIndex);
        const cellBuf = inputs[inputKey];

        if (cellBuf) {
          const resampledCell = (cellBuf.width === cellW && cellBuf.height === cellH)
            ? cellBuf
            : cellBuf.resample(cellW, cellH);

          const startX = c * cellW;
          const startY = r * cellH;
          const cData = resampledCell.data;

          for (let cy = 0; cy < cellH; cy++) {
            const destY = startY + cy;
            if (destY >= outH) break;

            for (let cx = 0; cx < cellW; cx++) {
              const destX = startX + cx;
              if (destX >= outW) break;

              const srcP = (cy * cellW + cx) * 4;
              const dstP = (destY * outW + destX) * 4;

              outData[dstP]     = cData[srcP];
              outData[dstP + 1] = cData[srcP + 1];
              outData[dstP + 2] = cData[srcP + 2];
              outData[dstP + 3] = cData[srcP + 3];
            }
          }
        }
        cellIndex++;
      }
    }

    outBuf.bbox = this.getBBox(inputs, context);
    return outBuf;
  }
}

