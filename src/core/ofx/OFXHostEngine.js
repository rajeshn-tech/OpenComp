/**
 * OpenComp - OpenFX (OFX) 1.4 Host Engine
 * High-level Host runtime managing effect instance state, parameter reflection,
 * Region of Definition (RoD) propagation, and safe out-of-process render action execution.
 */

import { OFXBridgeClient } from './OFXBridgeClient.js';
import { OFXPluginDiscovery } from './OFXPluginDiscovery.js';
import { PixelBuffer } from '../PixelBuffer.js';

export class OFXHostEngine {
  constructor() {
    this.descriptorCache = new Map(); // pluginId -> descriptor
    this.discovery = OFXPluginDiscovery.getInstance();
  }

  /**
   * Singleton accessor
   * @returns {OFXHostEngine}
   */
  static getInstance() {
    if (!OFXHostEngine._instance) {
      OFXHostEngine._instance = new OFXHostEngine();
    }
    return OFXHostEngine._instance;
  }

  /**
   * Get plugin descriptor (parameters, clips, contexts) with caching
   * @param {string} pluginId
   * @returns {Object}
   */
  getDescriptor(pluginId) {
    if (!this.descriptorCache.has(pluginId)) {
      const desc = OFXBridgeClient.describe(pluginId);
      this.descriptorCache.set(pluginId, desc);
    }
    return this.descriptorCache.get(pluginId);
  }

  /**
   * Query Region of Definition (RoD) for a given plugin and input dimensions
   * @param {string} pluginId
   * @param {number} width
   * @param {number} height
   * @param {Object} [params={}]
   * @returns {{x1: number, y1: number, x2: number, y2: number}}
   */
  getRegionOfDefinition(pluginId, width, height, params = {}) {
    try {
      return OFXBridgeClient.getRegionOfDefinition(pluginId, width, height, params);
    } catch (_) {
      // Fallback standard definition
      return { x1: 0, y1: 0, x2: width, y2: height };
    }
  }

  /**
   * Execute image effect render action on input PixelBuffer
   * @param {string} pluginId
   * @param {PixelBuffer} inputBuffer
   * @param {Object} [options={}]
   * @param {number} [options.frame=1.0]
   * @param {Object} [options.params={}]
   * @param {Array<number>} [options.renderWindow=null]
   * @returns {{pixelBuffer: PixelBuffer, durationMs: number}}
   */
  executeRender(pluginId, inputBuffer, options = {}) {
    if (!inputBuffer || !(inputBuffer instanceof PixelBuffer)) {
      throw new Error('OFXHostEngine requires a valid input PixelBuffer');
    }

    // Execute via bridge
    return OFXBridgeClient.render(pluginId, inputBuffer, options);
  }
}

