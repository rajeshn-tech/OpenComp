/**
 * OpenComp - Backdrop Node
 * Visual organization box for grouping nodes with labels and custom colors, standard VFX implementation.
 */

import { Node } from '../core/Node.js';

export class BackdropNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Backdrop', 'General', x, y);
    this.width = 380;
    this.height = 240;
    this.color = '#383838';

    // Backdrops have no input/output ports
    this.inputs = [];
    this.outputs = [];

    this.addKnob('label', 'Backdrop Label', 'text', 'SECTION / GROUP');
    this.addKnob('noteColor', 'Color Tint', 'select', '#334155', {
      options: [
        { label: 'Slate Gray', value: '#334155' },
        { label: 'VFX Green (Keying)', value: '#14532d' },
        { label: 'Blue (CGI / Comp)', value: '#1e3a8a' },
        { label: 'Amber (Color Grading)', value: '#78350f' },
        { label: 'Purple (Roto / Cleanup)', value: '#581c87' },
        { label: 'Rose (QC / Output)', value: '#881337' }
      ]
    });
    this.addKnob('boxWidth', 'Width', 'number', 380, { min: 100, max: 2000, step: 20 });
    this.addKnob('boxHeight', 'Height', 'number', 240, { min: 80, max: 2000, step: 20 });
  }

  compute(inputs, context = {}) {
    return null; // Visual annotation node only
  }
}

