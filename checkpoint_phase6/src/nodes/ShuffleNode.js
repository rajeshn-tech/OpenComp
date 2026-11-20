/**
 * OpenComp - Shuffle Node
 * Re-routes and copies channels (Red, Green, Blue, Alpha) matching Foundry Nuke's Shuffle.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class ShuffleNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Shuffle', 'Channel', x, y);
    this.width = 110;
    this.height = 36;

    this.addInput('in', 'in', 'Input');

    const channelOptions = [
      { label: 'Red (r)', value: 'r' },
      { label: 'Green (g)', value: 'g' },
      { label: 'Blue (b)', value: 'b' },
      { label: 'Alpha (a)', value: 'a' },
      { label: '0.0 (Black/Zero)', value: '0' },
      { label: '1.0 (White/One)', value: '1' }
    ];

    this.addKnob('red', 'Out Red', 'select', 'r', { options: channelOptions });
    this.addKnob('green', 'Out Green', 'select', 'g', { options: channelOptions });
    this.addKnob('blue', 'Out Blue', 'select', 'b', { options: channelOptions });
    this.addKnob('alpha', 'Out Alpha', 'select', 'a', { options: channelOptions });

    // Link outRed/outGreen aliases
    this.knobs['outRed'] = this.knobs['red'];
    this.knobs['outGreen'] = this.knobs['green'];
    this.knobs['outBlue'] = this.knobs['blue'];
    this.knobs['outAlpha'] = this.knobs['alpha'];
  }

  compute(inputs, context = {}) {
    const inputBuf = inputs['in'];
    if (!inputBuf) return null;

    const result = new PixelBuffer(inputBuf.width, inputBuf.height);
    const src = inputBuf.data;
    const dst = result.data;
    const len = src.length;

    const normalizeChannel = (val, defaultVal) => {
      if (!val) return defaultVal;
      const s = String(val).toLowerCase();
      if (s === 'r' || s === 'red') return 'r';
      if (s === 'g' || s === 'green') return 'g';
      if (s === 'b' || s === 'blue') return 'b';
      if (s === 'a' || s === 'alpha') return 'a';
      if (s === '0' || s === 'black' || s === 'zero') return '0';
      if (s === '1' || s === 'white' || s === 'one') return '1';
      return defaultVal;
    };

    const rMap = normalizeChannel(this.getKnobValue('outRed', context) || this.getKnobValue('red', context), 'r');
    const gMap = normalizeChannel(this.getKnobValue('outGreen', context) || this.getKnobValue('green', context), 'g');
    const bMap = normalizeChannel(this.getKnobValue('outBlue', context) || this.getKnobValue('blue', context), 'b');
    const aMap = normalizeChannel(this.getKnobValue('outAlpha', context) || this.getKnobValue('alpha', context), 'a');

    const getSourceVal = (mapType, i) => {
      switch (mapType) {
        case 'r': return src[i];
        case 'g': return src[i + 1];
        case 'b': return src[i + 2];
        case 'a': return src[i + 3];
        case '0': return 0.0;
        case '1': return 1.0;
        default: return 0.0;
      }
    };

    for (let i = 0; i < len; i += 4) {
      dst[i] = getSourceVal(rMap, i);
      dst[i + 1] = getSourceVal(gMap, i);
      dst[i + 2] = getSourceVal(bMap, i);
      dst[i + 3] = getSourceVal(aMap, i);
    }

    return result;
  }
}

