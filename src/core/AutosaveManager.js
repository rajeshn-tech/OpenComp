/**
 * OpenComp - Autosave & Crash Recovery System
 * Provides periodic, multi-generational atomic project snapshots with integrity checks.
 * Supports both Node.js (filesystem, CLI renderer) and Browser environments.
 */

export class AutosaveManager {
  /**
   * @param {Object} options
   * @param {number} [options.intervalMs=30000] - Autosave interval in milliseconds (default: 30s)
   * @param {number} [options.maxGenerations=3] - Number of generational backups to preserve
   * @param {string|null} [options.projectPath=null] - Filepath of the current project (if saved)
   * @param {Function} [options.getProjectData] - Callback returning project serialized data
   * @param {Function} [options.onAutosaveComplete] - Callback when autosave succeeds
   */
  constructor(options = {}) {
    this.intervalMs = options.intervalMs || 30000;
    this.maxGenerations = options.maxGenerations || 3;
    this.projectPath = options.projectPath || null;
    this.getProjectData = options.getProjectData || null;
    this.onAutosaveComplete = options.onAutosaveComplete || null;

    this.timer = null;
    this.isDirty = false;
    this.lastSavedHash = null;
    this.lastAutosaveTime = null;
    this.enabled = true;
  }

  static isNode() {
    return typeof process !== 'undefined' && !!process.versions && !!process.versions.node;
  }

  /**
   * Start the autosave background timer
   * @param {import('./Graph.js').Graph} [graph]
   * @param {Function} [getProjectData]
   */
  start(graph = null, getProjectData = null) {
    if (getProjectData) {
      this.getProjectData = getProjectData;
    } else if (graph && !this.getProjectData) {
      this.getProjectData = () => graph.serialize();
    }

    this.stop();
    this.timer = setInterval(() => {
      this.saveSnapshot();
    }, this.intervalMs);
  }

  /**
   * Stop the autosave background timer
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Mark project state as dirty (modified)
   */
  markDirty() {
    this.isDirty = true;
  }

  /**
   * Mark project state as clean (saved to primary file)
   */
  markClean() {
    this.isDirty = false;
  }

  /**
   * Set the current project file path
   * @param {string|null} path
   */
  setProjectPath(path) {
    this.projectPath = path;
  }

  /**
   * Compute lightweight hash of serialized string
   */
  _hash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }

  /**
   * Validate snapshot integrity before committing to disk / storage
   */
  validatePayload(payload) {
    if (!payload) return false;
    try {
      const obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (!obj || typeof obj !== 'object') return false;
      // Must contain nodes collection
      if (!Array.isArray(obj.nodes)) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Perform an atomic autosave snapshot
   * @param {boolean} [force=false]
   * @returns {boolean} Whether an autosave snapshot was performed
   */
  saveSnapshot(force = false) {
    if (!this.enabled || !this.getProjectData) return false;

    let data;
    try {
      data = this.getProjectData();
    } catch (err) {
      return false;
    }

    if (!data) return false;

    let jsonStr;
    try {
      jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
    } catch (e) {
      return false;
    }

    // Verify integrity before saving
    if (!this.validatePayload(jsonStr)) {
      return false;
    }

    const currentHash = this._hash(jsonStr);
    if (!force && currentHash === this.lastSavedHash) {
      // Nothing changed, skip disk/storage write
      return false;
    }

    const timestamp = Date.now();
    const envelope = {
      version: '1.0',
      timestamp,
      isoDate: new Date(timestamp).toISOString(),
      projectPath: this.projectPath,
      data: typeof data === 'string' ? JSON.parse(data) : data
    };

    const envelopeStr = JSON.stringify(envelope);

    if (AutosaveManager.isNode()) {
      this._saveNodeFilesystem(envelopeStr);
    } else {
      this._saveBrowserStorage(envelopeStr);
    }

    this.lastSavedHash = currentHash;
    this.lastAutosaveTime = timestamp;
    this.isDirty = false;

    if (typeof this.onAutosaveComplete === 'function') {
      this.onAutosaveComplete(envelope);
    }

    return true;
  }

  /**
   * File-system multi-generational atomic write (Node.js)
   */
  _saveNodeFilesystem(envelopeStr) {
    const fs = process.getBuiltinModule('node:fs');
    const path = process.getBuiltinModule('node:path');
    const os = process.getBuiltinModule('node:os');

    let baseName;
    let dir;
    if (this.projectPath) {
      dir = path.dirname(path.resolve(this.projectPath));
      baseName = path.basename(this.projectPath);
    } else {
      dir = path.join(os.tmpdir(), 'opencomp_autosaves');
      if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      }
      baseName = 'untitled.comp';
    }

    const mainAutosave = path.join(dir, `${baseName}.autosave`);

    // Multi-generational rotation
    for (let gen = this.maxGenerations - 1; gen >= 1; gen--) {
      const older = gen === 1 ? mainAutosave : `${mainAutosave}.bak${gen - 1}`;
      const newer = `${mainAutosave}.bak${gen}`;
      if (fs.existsSync(older)) {
        try {
          if (fs.existsSync(newer)) fs.unlinkSync(newer);
          fs.renameSync(older, newer);
        } catch (e) {}
      }
    }

    // Atomic write via temporary file
    const tmpFile = path.join(dir, `${baseName}.autosave.tmp.${process.pid}.${Date.now()}`);
    fs.writeFileSync(tmpFile, envelopeStr, 'utf8');
    fs.renameSync(tmpFile, mainAutosave);
  }

  /**
   * Browser local storage write with generation history
   */
  _saveBrowserStorage(envelopeStr) {
    if (typeof localStorage === 'undefined') return;

    try {
      const projKey = this.projectPath ? this.projectPath.replace(/[^a-zA-Z0-9_-]/g, '_') : 'untitled';
      
      // Multi-generational rotation in localStorage
      for (let gen = this.maxGenerations - 1; gen >= 1; gen--) {
        const olderKey = gen === 1 ? `opencomp_autosave_${projKey}` : `opencomp_autosave_${projKey}_bak${gen - 1}`;
        const newerKey = `opencomp_autosave_${projKey}_bak${gen}`;
        const existing = localStorage.getItem(olderKey);
        if (existing) {
          try { localStorage.setItem(newerKey, existing); } catch (e) {}
        }
      }

      localStorage.setItem(`opencomp_autosave_${projKey}`, envelopeStr);
      // Legacy compatibility key for tests
      const parsed = JSON.parse(envelopeStr);
      localStorage.setItem('opencomp_autosave_project', JSON.stringify(parsed.data));
    } catch (err) {
      // Handle quota exceeded gracefully
    }
  }

  /**
   * Check for an existing newer recovery snapshot
   * @param {string|null} [targetProjectPath=null]
   * @returns {Object|null} Recovery metadata or null if no valid recovery found
   */
  checkForRecovery(targetProjectPath = null) {
    const projPath = targetProjectPath || this.projectPath;

    if (AutosaveManager.isNode()) {
      const fs = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');
      const os = process.getBuiltinModule('node:os');

      let mainAutosave;
      if (projPath) {
        const resolved = path.resolve(projPath);
        mainAutosave = path.join(path.dirname(resolved), `${path.basename(resolved)}.autosave`);
      } else {
        mainAutosave = path.join(os.tmpdir(), 'opencomp_autosaves', 'untitled.comp.autosave');
      }

      if (!fs.existsSync(mainAutosave)) return null;

      try {
        const content = fs.readFileSync(mainAutosave, 'utf8');
        const envelope = JSON.parse(content);
        if (!envelope || !envelope.data || !this.validatePayload(envelope.data)) {
          return null;
        }

        // Check if autosave is newer than primary project file
        if (projPath && fs.existsSync(projPath)) {
          const projMtime = fs.statSync(projPath).mtimeMs;
          const autoMtime = fs.statSync(mainAutosave).mtimeMs;
          if (autoMtime <= projMtime) {
            return null; // Project file is newer or same
          }
        }

        return {
          hasRecovery: true,
          autosavePath: mainAutosave,
          timestamp: envelope.timestamp || fs.statSync(mainAutosave).mtimeMs,
          isoDate: envelope.isoDate || new Date(envelope.timestamp).toISOString(),
          nodeCount: Array.isArray(envelope.data.nodes) ? envelope.data.nodes.length : 0,
          data: envelope.data
        };
      } catch (e) {
        return null;
      }
    } else {
      // Browser storage check
      if (typeof localStorage === 'undefined') return null;
      const projKey = projPath ? projPath.replace(/[^a-zA-Z0-9_-]/g, '_') : 'untitled';
      const stored = localStorage.getItem(`opencomp_autosave_${projKey}`) || localStorage.getItem('opencomp_autosave_project');
      if (!stored) return null;

      try {
        let envelope = JSON.parse(stored);
        let projectData = envelope.data || envelope; // Support direct or enveloped format
        if (!this.validatePayload(projectData)) return null;

        return {
          hasRecovery: true,
          autosaveKey: `opencomp_autosave_${projKey}`,
          timestamp: envelope.timestamp || Date.now(),
          isoDate: envelope.isoDate || new Date().toISOString(),
          nodeCount: Array.isArray(projectData.nodes) ? projectData.nodes.length : 0,
          data: projectData
        };
      } catch (e) {
        return null;
      }
    }
  }

  /**
   * Restore recovery data into target graph
   */
  restore(graph, recoveryData = null) {
    const dataToRestore = recoveryData || (this.checkForRecovery()?.data);
    if (!dataToRestore || !graph) return false;

    graph.deserialize(dataToRestore);
    this.markClean();
    return true;
  }

  /**
   * Discard autosave snapshots cleanly
   */
  discard(targetProjectPath = null) {
    const projPath = targetProjectPath || this.projectPath;

    if (AutosaveManager.isNode()) {
      const fs = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');
      const os = process.getBuiltinModule('node:os');

      let mainAutosave;
      if (projPath) {
        const resolved = path.resolve(projPath);
        mainAutosave = path.join(path.dirname(resolved), `${path.basename(resolved)}.autosave`);
      } else {
        mainAutosave = path.join(os.tmpdir(), 'opencomp_autosaves', 'untitled.comp.autosave');
      }

      for (let gen = 0; gen < this.maxGenerations; gen++) {
        const f = gen === 0 ? mainAutosave : `${mainAutosave}.bak${gen}`;
        if (fs.existsSync(f)) {
          try { fs.unlinkSync(f); } catch (e) {}
        }
      }
    } else {
      if (typeof localStorage !== 'undefined') {
        const projKey = projPath ? projPath.replace(/[^a-zA-Z0-9_-]/g, '_') : 'untitled';
        for (let gen = 0; gen < this.maxGenerations; gen++) {
          const key = gen === 0 ? `opencomp_autosave_${projKey}` : `opencomp_autosave_${projKey}_bak${gen}`;
          localStorage.removeItem(key);
        }
        localStorage.removeItem('opencomp_autosave_project');
      }
    }
  }
}
