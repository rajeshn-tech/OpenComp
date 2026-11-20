/**
 * OpenComp - Shuffle Node
 * Re-routes and copies channels (Red, Green, Blue, Alpha) standard VFX implementation.
 */

import { Node } from '../core/Node.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class ShuffleNode extends Node {
  constructor(id, x = 0, y = 0) {
    super(id, 'Shuffle', 'Channel', x, y);
    this.width = 110;
    this.height = 36;

    this.addInput('in', 'in', 'Input');

    this.addKnob('in1', 'In 1 Layer', 'string', 'rgba');
    this.addKnob('out1', 'Out 1 Layer', 'string', 'rgba');

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
    result.bbox = this.getBBox(inputs, context);
    // Preserve any existing extra channels and metadata
    result.copyChannelsFrom(inputBuf);
    if (inputBuf.metadata) {
      result.metadata = { ...inputBuf.metadata };
    }

    const src = inputBuf.data;
    const dst = result.data;
    const len = src.length;
    const inLayer = this.getKnobValue('in1', context) || 'rgba';
    const outLayer = this.getKnobValue('out1', context) || 'rgba';

    // Channel resolver function that checks standard RGBA, inLayer prefix, or direct extraChannels
    const resolveChannelArray = (val) => {
      if (!val) return null;
      const s = String(val).trim();
      if (['r', 'red', 'g', 'green', 'b', 'blue', 'a', 'alpha', '0', '1', 'zero', 'white'].includes(s.toLowerCase())) {
        return null; // Handled directly from main src buffer
      }
      // Check exact match in extraChannels
      if (inputBuf.hasChannel && inputBuf.hasChannel(s)) {
        return inputBuf.getChannel(s);
      }
      // Check inLayer prefix (e.g. in1 = 'diffuse', val = 'red' -> 'diffuse.red' or 'diffuse.R')
      if (inLayer && inLayer !== 'rgba') {
        const candidate1 = `${inLayer}.${s}`;
        if (inputBuf.hasChannel && inputBuf.hasChannel(candidate1)) return inputBuf.getChannel(candidate1);
        const candidate2 = `${inLayer}.${s.toUpperCase()}`;
        if (inputBuf.hasChannel && inputBuf.hasChannel(candidate2)) return inputBuf.getChannel(candidate2);
      }
      return null;
    };

    const rRaw = this.getKnobValue('outRed', context) || this.getKnobValue('red', context) || 'r';
    const gRaw = this.getKnobValue('outGreen', context) || this.getKnobValue('green', context) || 'g';
    const bRaw = this.getKnobValue('outBlue', context) || this.getKnobValue('blue', context) || 'b';
    const aRaw = this.getKnobValue('outAlpha', context) || this.getKnobValue('alpha', context) || 'a';

    const rArr = resolveChannelArray(rRaw);
    const gArr = resolveChannelArray(gRaw);
    const bArr = resolveChannelArray(bRaw);
    const aArr = resolveChannelArray(aRaw);

    const normalizeStandard = (val, defaultVal) => {
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

    const rMap = rArr ? null : normalizeStandard(rRaw, 'r');
    const gMap = gArr ? null : normalizeStandard(gRaw, 'g');
    const bMap = bArr ? null : normalizeStandard(bRaw, 'b');
    const aMap = aArr ? null : normalizeStandard(aRaw, 'a');

    const getSourceVal = (arr, mapType, i, px) => {
      if (arr) return arr[px];
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

    let px = 0;
    for (let i = 0; i < len; i += 4, px++) {
      dst[i] = getSourceVal(rArr, rMap, i, px);
      dst[i + 1] = getSourceVal(gArr, gMap, i, px);
      dst[i + 2] = getSourceVal(bArr, bMap, i, px);
      dst[i + 3] = getSourceVal(aArr, aMap, i, px);
    }

    // If output layer is not rgba, also store routed channels into that layer
    if (outLayer && outLayer !== 'rgba') {
      const numPx = inputBuf.width * inputBuf.height;
      const rOut = new Float32Array(numPx);
      const gOut = new Float32Array(numPx);
      const bOut = new Float32Array(numPx);
      const aOut = new Float32Array(numPx);
      for (let p = 0; p < numPx; p++) {
        const i = p * 4;
        rOut[p] = dst[i];
        gOut[p] = dst[i + 1];
        bOut[p] = dst[i + 2];
        aOut[p] = dst[i + 3];
      }
      result.setChannel(`${outLayer}.R`, rOut);
      result.setChannel(`${outLayer}.G`, gOut);
      result.setChannel(`${outLayer}.B`, bOut);
      result.setChannel(`${outLayer}.A`, aOut);
    }

    return result;
  }
}

