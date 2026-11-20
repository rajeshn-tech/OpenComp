/**
 * OpenComp - OpenFX (OFX) 1.4 Plugin Discovery Service
 * Scans standard operating system directories and user studio search paths for OpenFX bundles.
 * Caches discovered plugin metadata and provides inspection services to the Node Graph and Tab Search.
 */

import { OFXBridgeClient } from './OFXBridgeClient.js';

export class OFXPluginDiscovery {
  constructor() {
    this.plugins = new Map();
    this.searchPaths = [];
    this.isInitialized = false;
  }

  /**
   * Singleton accessor
   * @returns {OFXPluginDiscovery}
   */
  static getInstance() {
    if (!OFXPluginDiscovery._instance) {
      OFXPluginDiscovery._instance = new OFXPluginDiscovery();
    }
    return OFXPluginDiscovery._instance;
  }

  /**
   * Initialize discovery and populate cached registry
   * @param {Array<string>|null} [customPaths=null]
   * @returns {Array<Object>} Discovered plugins
   */
  init(customPaths = null) {
    try {
      const res = OFXBridgeClient.discover(customPaths);
      this.searchPaths = res.searchPaths || [];
      this.plugins.clear();

      for (const p of (res.plugins || [])) {
        this.plugins.set(p.pluginIdentifier, p);
      }

      this.isInitialized = true;
      return Array.from(this.plugins.values());
    } catch (err) {
      console.warn(`[OFXPluginDiscovery] Initialization warning: ${err.message}`);
      this.isInitialized = true;
      return [];
    }
  }

  /**
   * Ensure discovery has been run at least once
   */
  ensureInitialized() {
    if (!this.isInitialized) {
      this.init();
    }
  }

  /**
   * Get all registered plugins
   * @returns {Array<Object>}
   */
  getPlugins() {
    this.ensureInitialized();
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugin info by identifier
   * @param {string} pluginId
   * @returns {Object|null}
   */
  getPlugin(pluginId) {
    this.ensureInitialized();
    return this.plugins.get(pluginId) || null;
  }

  /**
   * Check if a plugin exists in registry
   * @param {string} pluginId
   * @returns {boolean}
   */
  hasPlugin(pluginId) {
    this.ensureInitialized();
    return this.plugins.has(pluginId);
  }

  /**
   * Refresh discovery from disk
   * @param {Array<string>|null} [customPaths=null]
   * @returns {Array<Object>}
   */
  refresh(customPaths = null) {
    return this.init(customPaths);
  }
}

