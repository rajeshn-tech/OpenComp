/**
 * OpenComp - Viewer Node
 * Standard interactive viewport sink with 10-input (1-10) switching and A/B split-screen wipe compare.
 */

import { Node } from '../core/Node.js';

export class ViewerNode extends Node {
  constructor(id = 'Viewer1', x = 0, y = 0) {
    super(id, 'Viewer', 'Viewer', x, y);
    this.width = 110;
    this.height = 42;

    // Multi-inputs 1-10 like industry standard Viewer (keys 1-9 and 0)
    for (let i = 1; i <= 10; i++) {
      this.addInput(String(i), String(i), String(i));
    }

    const inputOptions = [];
    for (let i = 1; i <= 10; i++) {
      inputOptions.push({ label: `Input ${i}`, value: String(i) });
    }

    this.addKnob('activeInput', 'Active Input', 'select', '1', {
      options: inputOptions
    });

    this.addKnob('compareMode', 'Comparison Mode', 'select', 'single', {
      options: [
        { label: 'Single View', value: 'single' },
        { label: 'A/B Horizontal Wipe', value: 'wipe_h' },
        { label: 'A/B Vertical Wipe', value: 'wipe_v' },
        { label: 'A/B Side-by-Side', value: 'side_by_side' },
        { label: 'A/B Difference', value: 'diff' }
      ]
    });

    this.addKnob('sourceA', 'Source A', 'select', '1', {
      options: inputOptions
    });

    this.addKnob('sourceB', 'Source B', 'select', '2', {
      options: inputOptions
    });

    this.addKnob('wipePosition', 'Wipe Split Position', 'number', 0.5, { min: 0.0, max: 1.0, step: 0.01 });
    this.addKnob('diffGain', 'Difference Gain', 'number', 1.0, { min: 0.1, max: 20.0, step: 0.1 });

    this.addKnob('layoutMode', 'Viewer Layout', 'select', 'single', {
      options: [
        { label: 'Single View', value: 'single' },
        { label: 'Dual View (A/B)', value: 'dual' },
        { label: 'Quad View (1-4)', value: 'quad' }
      ]
    });

    this.lastInputs = {};
  }

  getInputBuffer(slot = '1') {
    return (this.lastInputs && this.lastInputs[String(slot)]) ? this.lastInputs[String(slot)] : null;
  }

  getAllInputBuffers() {
    return { ...this.lastInputs };
  }

  compute(inputs, context = {}) {
    this.lastInputs = { ...inputs };
    const compareMode = this.getKnobValue('compareMode') || 'single';
    const activeKey = String(this.getKnobValue('activeInput') || '1');

    if (compareMode === 'single') {
      return inputs[activeKey] || inputs['1'] || null;
    }

    // A/B Comparison between user-selected Source A and Source B
    const srcAKey = String(this.getKnobValue('sourceA') || '1');
    const srcBKey = String(this.getKnobValue('sourceB') || '2');

    const bufA = inputs[srcAKey] || null;
    const bufB = inputs[srcBKey] || null;

    if (!bufA && !bufB) return null;
    if (!bufA) return bufB;
    if (!bufB) return bufA;

    const w = bufA.width;
    const h = bufA.height;
    const resB = (bufB.width === w && bufB.height === h) ? bufB : bufB.resample(w, h);

    const wipePos = Number(this.getKnobValue('wipePosition')) ?? 0.5;

    // Create non-destructive composite comparison buffer
    const result = bufA.clone();
    const dst = result.data;
    const srcB = resB.data;

    if (compareMode === 'wipe_h') {
      const splitX = Math.floor(w * wipePos);
      for (let y = 0; y < h; y++) {
        for (let x = splitX; x < w; x++) {
          const idx = (y * w + x) * 4;
          dst[idx] = srcB[idx];
          dst[idx + 1] = srcB[idx + 1];
          dst[idx + 2] = srcB[idx + 2];
          dst[idx + 3] = srcB[idx + 3];
        }
        // Draw wipe divider line
        if (splitX >= 0 && splitX < w) {
          const lIdx = (y * w + splitX) * 4;
          dst[lIdx] = 1.0;
          dst[lIdx + 1] = 0.57;
          dst[lIdx + 2] = 0.17;
        }
      }
    } else if (compareMode === 'wipe_v') {
      const splitY = Math.floor(h * wipePos);
      for (let y = splitY; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          dst[idx] = srcB[idx];
          dst[idx + 1] = srcB[idx + 1];
          dst[idx + 2] = srcB[idx + 2];
          dst[idx + 3] = srcB[idx + 3];
        }
      }
      // Draw vertical wipe divider line
      if (splitY >= 0 && splitY < h) {
        for (let x = 0; x < w; x++) {
          const lIdx = (splitY * w + x) * 4;
          dst[lIdx] = 1.0;
          dst[lIdx + 1] = 0.57;
          dst[lIdx + 2] = 0.17;
        }
      }
    } else if (compareMode === 'side_by_side') {
      // Side by side preview
      const splitX = Math.floor(w * 0.5);
      for (let y = 0; y < h; y++) {
        for (let x = splitX; x < w; x++) {
          const idx = (y * w + x) * 4;
          dst[idx] = srcB[idx];
          dst[idx + 1] = srcB[idx + 1];
          dst[idx + 2] = srcB[idx + 2];
          dst[idx + 3] = srcB[idx + 3];
        }
      }
    } else if (compareMode === 'diff') {
      const diffGain = Number(this.getKnobValue('diffGain')) || 1.0;
      const len = dst.length;
      for (let i = 0; i < len; i += 4) {
        dst[i] = Math.abs(dst[i] - srcB[i]) * diffGain;
        dst[i + 1] = Math.abs(dst[i + 1] - srcB[i + 1]) * diffGain;
        dst[i + 2] = Math.abs(dst[i + 2] - srcB[i + 2]) * diffGain;
        dst[i + 3] = Math.max(dst[i + 3], srcB[i + 3]); // Preserve alpha coverage
      }
    }

    return result;
  }
}


