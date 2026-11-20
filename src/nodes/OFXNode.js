/**
 * OpenComp - OFXNode (OpenFX 1.4 Plugin Host Node)
 * Dynamically hosts and executes external OpenFX 1.4 image processing filter plugins.
 * Reflects plugin parameters into native OpenComp knobs and enforces out-of-process crash isolation.
 */

import { Node } from '../core/Node.js';
import { OFXHostEngine } from '../core/ofx/OFXHostEngine.js';
import { PixelBuffer } from '../core/PixelBuffer.js';

export class OFXNode extends Node {
  /**
   * @param {string} id
   * @param {number} [x=0]
   * @param {number} [y=0]
   * @param {string} [pluginId='org.openfx:InvertPlugin']
   */
  constructor(id, x = 0, y = 0, pluginId = 'org.openfx:InvertPlugin') {
    super(id, 'OFX', 'OpenFX', x, y);
    this.width = 120;
    this.height = 42;

    // Define standard OFX clips
    this.addInput('Source', 'in', 'Input Source RGBA');
    this.addInput('Mask', 'mask', 'Optional Alpha / Matte Mask');

    // Plugin Identifier knob
    this.addKnob('pluginId', 'Plugin Identifier', 'text', pluginId, {
      placeholder: 'e.g. org.openfx:InvertPlugin'
    });

    // Execution knobs
    this.addKnob('frame', 'Frame', 'number', 1.0);
    this.addKnob('useTimelineFrame', 'Use Timeline Frame', 'boolean', true);

    this.activePluginId = null;
    this.descriptor = null;
    this.pluginError = null;

    // Initialize parameters for designated plugin
    this.configureForPlugin(pluginId);
  }

  /**
   * Override setKnobValue to dynamically reconfigure when pluginId changes
   */
  setKnobValue(name, val, context = {}) {
    super.setKnobValue(name, val, context);
    if (name === 'pluginId' && val && val !== this.activePluginId) {
      this.configureForPlugin(val);
    }
  }

  /**
   * Override deserialize to configure parameters before restoring values
   */
  deserialize(data) {
    if (data.knobs && data.knobs.pluginId) {
      const pid = (typeof data.knobs.pluginId === 'object' && data.knobs.pluginId !== null) 
        ? data.knobs.pluginId.value 
        : data.knobs.pluginId;
      if (pid && typeof pid === 'string') {
        this.configureForPlugin(pid.trim());
      }
    }
    super.deserialize(data);
  }

  /**
   * Dynamically inspect and configure knobs based on OpenFX plugin descriptor
   * @param {string} pluginId
   */
  configureForPlugin(pluginId) {
    if (!pluginId || typeof pluginId !== 'string') return;
    this.activePluginId = pluginId.trim();

    try {
      const engine = OFXHostEngine.getInstance();
      this.descriptor = engine.getDescriptor(this.activePluginId);
      this.label = this.descriptor.name || this.activePluginId;

      // Reflect parameters as native knobs
      if (this.descriptor && Array.isArray(this.descriptor.parameters)) {
        for (const p of this.descriptor.parameters) {
          if (!this.knobs[p.name]) {
            let knobType = 'number';
            let defaultVal = p.default !== undefined ? p.default : 0;
            const options = {};

            if (p.min !== undefined && p.min !== null) options.min = p.min;
            if (p.max !== undefined && p.max !== null) options.max = p.max;

            if (p.type === 'OfxParamTypeBoolean') {
              knobType = 'boolean';
              defaultVal = Boolean(defaultVal);
            } else if (p.type === 'OfxParamTypeInteger') {
              knobType = 'number';
              options.step = 1;
            } else if (p.type === 'OfxParamTypeChoice') {
              knobType = 'select';
              options.options = p.choices || [];
            } else if (p.type === 'OfxParamTypeRGBA' || p.type === 'OfxParamTypeRGB') {
              knobType = 'color';
            } else if (p.type === 'OfxParamTypeString') {
              knobType = 'text';
            }

            this.addKnob(p.name, p.label || p.name, knobType, defaultVal, options);
          }
        }
      }
      this.pluginError = null;
    } catch (err) {
      this.pluginError = err.message;
      console.warn(`[OFXNode ${this.id}] Plugin inspection warning: ${err.message}`);
    }
  }

  /**
   * Evaluate node graph execution
   * @param {Object} inputs
   * @param {Object} [context={}]
   * @returns {PixelBuffer}
   */
  compute(inputs, context = {}) {
    // 1. Resolve input clip
    const srcBuffer = inputs['Source'] || inputs['in'] || inputs['0'];
    if (!srcBuffer || !(srcBuffer instanceof PixelBuffer)) {
      return new PixelBuffer(1, 1);
    }

    // 2. Check plugin identifier
    const targetPluginId = (this.getKnobValue('pluginId', context) || this.activePluginId || '').trim();
    if (!targetPluginId) {
      return srcBuffer;
    }

    if (targetPluginId !== this.activePluginId) {
      this.configureForPlugin(targetPluginId);
    }

    // 3. Resolve target frame
    let targetFrame = 1.0;
    if (this.getKnobValue('useTimelineFrame', context) && context.frame !== undefined) {
      targetFrame = Number(context.frame);
    } else {
      targetFrame = Number(this.getKnobValue('frame', context)) || 1.0;
    }

    // 4. Collect parameters
    const paramValues = {};
    if (this.descriptor && Array.isArray(this.descriptor.parameters)) {
      for (const p of this.descriptor.parameters) {
        paramValues[p.name] = this.getKnobValue(p.name, context);
      }
    }

    // 5. Execute render action with crash isolation
    try {
      const engine = OFXHostEngine.getInstance();
      const res = engine.executeRender(this.activePluginId, srcBuffer, {
        frame: targetFrame,
        params: paramValues,
        renderWindow: [0, 0, srcBuffer.width, srcBuffer.height]
      });

      this.pluginError = null;
      this.error = null;
      return res.pixelBuffer;
    } catch (err) {
      // Crash isolation: Catch error, record on node, return pass-through buffer
      this.pluginError = err.message;
      this.error = `OFX Render Failure: ${err.message}`;
      console.error(`[OFXNode ${this.id}] Render action error: ${err.message}`);
      return srcBuffer;
    }
  }
}
