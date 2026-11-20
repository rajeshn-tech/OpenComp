/**
 * OpenComp - Keyboard Shortcut Manager & Conflict Detection Subsystem (Phase 1)
 * Features:
 * - Searchable modal dialog with category filtering
 * - Reassignment of keyboard shortcuts
 * - Instant conflict detection with visual alerts
 * - Reset single shortcut or all shortcuts to factory defaults
 * - Persistent storage in localStorage
 * - Safe global event interceptor with input-focus guards
 */

export class ShortcutManager {
  constructor(app = null) {
    this.app = app;
    this.storageKey = 'opencomp_shortcuts_v1';

    /** @type {Map<string, { id: string, name: string, category: string, defaultKey: string, key: string, handler: Function|null, description: string }>} */
    this.shortcuts = new Map();

    /** @type {string|null} Action ID currently recording a new key combination */
    this.recordingActionId = null;

    /** @type {string} Active category filter in modal */
    this.activeCategoryFilter = 'All';

    /** @type {string} Active search text query in modal */
    this.searchQuery = '';

    this.initDefaultShortcuts();
    this.loadCustomShortcuts();
    this.initGlobalListener();
  }

  /**
   * Register standard workstation shortcuts
   */
  initDefaultShortcuts() {
    const list = [
      // General & Project
      { id: 'file.new', name: 'New Project', category: 'General', defaultKey: 'Ctrl+N', desc: 'Create a new blank OpenComp project' },
      { id: 'file.open', name: 'Open Project', category: 'General', defaultKey: 'Ctrl+O', desc: 'Open .comp project file' },
      { id: 'file.save', name: 'Save Project', category: 'General', defaultKey: 'Ctrl+S', desc: 'Save current project to .comp' },
      { id: 'file.saveAs', name: 'Save Project As', category: 'General', defaultKey: 'Ctrl+Shift+S', desc: 'Save project with a new filename' },
      { id: 'file.exportFrame', name: 'Export Rendered Frame', category: 'General', defaultKey: 'F7', desc: 'Export active Viewer frame to image' },
      { id: 'edit.undo', name: 'Undo', category: 'General', defaultKey: 'Ctrl+Z', desc: 'Undo last graph action' },
      { id: 'edit.redo', name: 'Redo', category: 'General', defaultKey: 'Ctrl+Y', desc: 'Redo last graph action' },
      { id: 'edit.shortcuts', name: 'Keyboard Shortcuts', category: 'General', defaultKey: 'Shift+S', desc: 'Open Keyboard Shortcut Manager' },

      // Selection & Nodes
      { id: 'node.tabSearch', name: 'Tab Node Quick Finder', category: 'Nodes', defaultKey: 'Tab', desc: 'Search and spawn any registered node' },
      { id: 'node.selectAll', name: 'Select All Nodes', category: 'Selection', defaultKey: 'Ctrl+A', desc: 'Select all nodes in graph' },
      { id: 'node.duplicate', name: 'Duplicate Selected', category: 'Nodes', defaultKey: 'Ctrl+D', desc: 'Duplicate selected nodes' },
      { id: 'node.delete', name: 'Delete Selected', category: 'Nodes', defaultKey: 'Delete', desc: 'Delete selected nodes from graph' },
      { id: 'node.disable', name: 'Disable / Bypass', category: 'Nodes', defaultKey: 'D', desc: 'Toggle bypass state on selected nodes' },
      { id: 'node.createGrade', name: 'Create Grade Node', category: 'Nodes', defaultKey: 'G', desc: 'Spawn Color Grade node' },
      { id: 'node.createColorCorrect', name: 'Create ColorCorrect Node', category: 'Nodes', defaultKey: 'C', desc: 'Spawn ColorCorrect node' },
      { id: 'node.createBlur', name: 'Create Blur Node', category: 'Nodes', defaultKey: 'B', desc: 'Spawn Filter Blur node' },
      { id: 'node.createMerge', name: 'Create Merge Node', category: 'Nodes', defaultKey: 'M', desc: 'Spawn Compositing Merge node' },
      { id: 'node.createTransform', name: 'Create Transform Node', category: 'Nodes', defaultKey: 'T', desc: 'Spawn 2D Transform node' },
      { id: 'node.createKeyer', name: 'Create Keyer Node', category: 'Nodes', defaultKey: 'K', desc: 'Spawn Chroma / Luminance Keyer node' },
      { id: 'node.createPremult', name: 'Create Premult Node', category: 'Nodes', defaultKey: 'P', desc: 'Spawn Premultiply node' },
      { id: 'node.createShuffle', name: 'Create Shuffle Node', category: 'Nodes', defaultKey: 'S', desc: 'Spawn Channel Shuffle node' },
      { id: 'node.createErode', name: 'Create Erode Node', category: 'Nodes', defaultKey: 'E', desc: 'Spawn Filter Erode node' },
      { id: 'node.createRead', name: 'Create Read Node', category: 'Nodes', defaultKey: 'R', desc: 'Spawn Image Read node' },
      { id: 'node.createWrite', name: 'Create Write Node', category: 'Nodes', defaultKey: 'W', desc: 'Spawn Image Write node' },
      { id: 'node.createRoto', name: 'Create Roto Node', category: 'Nodes', defaultKey: 'O', desc: 'Spawn Vector Roto Spline node' },
      { id: 'node.createDot', name: 'Create Dot Node', category: 'Nodes', defaultKey: '.', desc: 'Spawn Routing Dot node' },

      // Viewer Controls
      { id: 'viewer.slot1', name: 'Viewer Input Slot 1', category: 'Viewer', defaultKey: '1', desc: 'Connect selected node to Viewer Input 1' },
      { id: 'viewer.slot2', name: 'Viewer Input Slot 2', category: 'Viewer', defaultKey: '2', desc: 'Connect selected node to Viewer Input 2' },
      { id: 'viewer.slot3', name: 'Viewer Input Slot 3', category: 'Viewer', defaultKey: '3', desc: 'Connect selected node to Viewer Input 3' },
      { id: 'viewer.slot4', name: 'Viewer Input Slot 4', category: 'Viewer', defaultKey: '4', desc: 'Connect selected node to Viewer Input 4' },
      { id: 'viewer.slot5', name: 'Viewer Input Slot 5', category: 'Viewer', defaultKey: '5', desc: 'Connect selected node to Viewer Input 5' },
      { id: 'viewer.slot6', name: 'Viewer Input Slot 6', category: 'Viewer', defaultKey: '6', desc: 'Connect selected node to Viewer Input 6' },
      { id: 'viewer.slot7', name: 'Viewer Input Slot 7', category: 'Viewer', defaultKey: '7', desc: 'Connect selected node to Viewer Input 7' },
      { id: 'viewer.slot8', name: 'Viewer Input Slot 8', category: 'Viewer', defaultKey: '8', desc: 'Connect selected node to Viewer Input 8' },
      { id: 'viewer.slot9', name: 'Viewer Input Slot 9', category: 'Viewer', defaultKey: '9', desc: 'Connect selected node to Viewer Input 9' },
      { id: 'viewer.slot10', name: 'Viewer Input Slot 10', category: 'Viewer', defaultKey: '0', desc: 'Connect selected node to Viewer Input 10' },
      { id: 'viewer.fit', name: 'Fit to View', category: 'Viewer', defaultKey: 'F', desc: 'Fit image buffer within viewport bounds' },
      { id: 'viewer.actualSize', name: '1:1 Actual Size', category: 'Viewer', defaultKey: 'H', desc: 'Zoom viewport to 100% pixel scale' },

      // Timeline Controls
      { id: 'timeline.playPause', name: 'Play / Pause', category: 'Timeline', defaultKey: 'Space', desc: 'Toggle timeline playback' },
      { id: 'timeline.prevFrame', name: 'Previous Frame', category: 'Timeline', defaultKey: 'Left', desc: 'Step one frame backward' },
      { id: 'timeline.nextFrame', name: 'Next Frame', category: 'Timeline', defaultKey: 'Right', desc: 'Step one frame forward' }
    ];

    for (const item of list) {
      this.shortcuts.set(item.id, {
        id: item.id,
        name: item.name,
        category: item.category,
        defaultKey: item.defaultKey,
        key: item.defaultKey,
        handler: null,
        description: item.desc
      });
    }
  }

  /**
   * Set callback handler for an action ID
   */
  setHandler(actionId, fn) {
    const sc = this.shortcuts.get(actionId);
    if (sc) {
      sc.handler = fn;
    }
  }

  /**
   * Normalize key combo string (e.g. "ctrl+shift+s" -> "Ctrl+Shift+S")
   */
  normalizeKeyCombo(combo) {
    if (!combo) return '';
    const parts = combo.split('+').map(p => p.trim());
    let hasCtrl = false;
    let hasAlt = false;
    let hasShift = false;
    let hasMeta = false;
    let mainKey = '';

    for (const p of parts) {
      const lower = p.toLowerCase();
      if (lower === 'ctrl' || lower === 'control') hasCtrl = true;
      else if (lower === 'alt') hasAlt = true;
      else if (lower === 'shift') hasShift = true;
      else if (lower === 'meta' || lower === 'command' || lower === 'cmd') hasMeta = true;
      else {
        // Capitalize single characters or format special keys
        if (p.length === 1) {
          mainKey = p.toUpperCase();
        } else if (lower === 'space' || lower === ' ') {
          mainKey = 'Space';
        } else if (lower === 'del' || lower === 'delete') {
          mainKey = 'Delete';
        } else if (lower === 'tab') {
          mainKey = 'Tab';
        } else if (lower === 'escape' || lower === 'esc') {
          mainKey = 'Escape';
        } else if (lower === 'arrowleft' || lower === 'left') {
          mainKey = 'Left';
        } else if (lower === 'arrowright' || lower === 'right') {
          mainKey = 'Right';
        } else if (lower === 'arrowup' || lower === 'up') {
          mainKey = 'Up';
        } else if (lower === 'arrowdown' || lower === 'down') {
          mainKey = 'Down';
        } else {
          mainKey = p.charAt(0).toUpperCase() + p.slice(1);
        }
      }
    }

    const res = [];
    if (hasCtrl) res.push('Ctrl');
    if (hasAlt) res.push('Alt');
    if (hasShift) res.push('Shift');
    if (hasMeta) res.push('Cmd');
    if (mainKey) res.push(mainKey);
    return res.join('+');
  }

  /**
   * Check for conflicts before assigning a key combo
   */
  checkConflict(actionId, keyCombo) {
    const normalized = this.normalizeKeyCombo(keyCombo);
    if (!normalized) return { hasConflict: false, conflictingAction: null };

    for (const [id, sc] of this.shortcuts.entries()) {
      if (id !== actionId && sc.key === normalized) {
        return {
          hasConflict: true,
          conflictingAction: sc
        };
      }
    }

    return { hasConflict: false, conflictingAction: null };
  }

  /**
   * Reassign a shortcut
   */
  setShortcut(actionId, newKeyCombo) {
    const sc = this.shortcuts.get(actionId);
    if (!sc) return false;

    const normalized = this.normalizeKeyCombo(newKeyCombo);
    sc.key = normalized;
    this.saveCustomShortcuts();
    return true;
  }

  /**
   * Reset single shortcut to default
   */
  resetShortcut(actionId) {
    const sc = this.shortcuts.get(actionId);
    if (!sc) return false;
    sc.key = sc.defaultKey;
    this.saveCustomShortcuts();
    return true;
  }

  /**
   * Reset all shortcuts to defaults
   */
  resetDefaults() {
    for (const sc of this.shortcuts.values()) {
      sc.key = sc.defaultKey;
    }
    try {
      localStorage.removeItem(this.storageKey);
    } catch (e) {}
    this.renderModalTable();
  }

  saveCustomShortcuts() {
    try {
      const custom = {};
      for (const [id, sc] of this.shortcuts.entries()) {
        if (sc.key !== sc.defaultKey) {
          custom[id] = sc.key;
        }
      }
      localStorage.setItem(this.storageKey, JSON.stringify(custom));
    } catch (e) {}
  }

  loadCustomShortcuts() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const [id, key] of Object.entries(parsed)) {
          if (this.shortcuts.has(id)) {
            this.shortcuts.get(id).key = key;
          }
        }
      }
    } catch (e) {}
  }

  /**
   * Convert KeyboardEvent to key combo string
   */
  eventToKeyCombo(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Cmd');

    let key = e.key;
    if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') {
      return parts.join('+'); // Modifier only
    }

    if (key === ' ') key = 'Space';
    else if (key === 'Delete' || key === 'Del') key = 'Delete';
    else if (key === 'ArrowLeft') key = 'Left';
    else if (key === 'ArrowRight') key = 'Right';
    else if (key === 'ArrowUp') key = 'Up';
    else if (key === 'ArrowDown') key = 'Down';
    else if (key.length === 1) key = key.toUpperCase();

    parts.push(key);
    return parts.join('+');
  }

  /**
   * Global keydown listener
   */
  initGlobalListener() {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      // If modal is recording a shortcut, intercept and bind
      if (this.recordingActionId) {
        e.preventDefault();
        e.stopPropagation();

        const combo = this.eventToKeyCombo(e);
        // Ensure it's not just a modifier key
        if (!['Ctrl', 'Alt', 'Shift', 'Cmd', ''].includes(combo)) {
          this.handleRecordedKey(this.recordingActionId, combo);
        }
        return;
      }

      // Check if user is typing in an input or textarea
      const targetTag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
      const isInput = targetTag === 'input' || targetTag === 'textarea' || e.target.isContentEditable;

      // Allow Escape and Enter in inputs to pass or close popup
      if (isInput) {
        return;
      }

      const combo = this.eventToKeyCombo(e);
      if (!combo) return;

      // Find matching action
      for (const sc of this.shortcuts.values()) {
        if (sc.key === combo) {
          if (typeof sc.handler === 'function') {
            const handled = sc.handler(e);
            if (handled !== false) {
              e.preventDefault();
              if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
              } else if (typeof e.stopPropagation === 'function') {
                e.stopPropagation();
              }
              return;
            }
          }
        }
      }
    }, true);
  }

  // --- Searchable Modal UI ---

  openModal() {
    if (typeof document === 'undefined') return;
    let modal = document.getElementById('shortcut-manager-modal');
    if (!modal) {
      modal = this.createModalElement();
      document.body.appendChild(modal);
    }

    modal.style.display = 'flex';
    this.recordingActionId = null;
    this.renderModalTable();

    const searchInput = modal.querySelector('#shortcut-search-input');
    if (searchInput) {
      searchInput.value = '';
      this.searchQuery = '';
      setTimeout(() => searchInput.focus(), 50);
    }
  }

  closeModal() {
    const modal = document.getElementById('shortcut-manager-modal');
    if (modal) {
      modal.style.display = 'none';
      this.recordingActionId = null;
    }
  }

  createModalElement() {
    const modal = document.createElement('div');
    modal.id = 'shortcut-manager-modal';
    modal.className = 'opencomp-modal-overlay';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="opencomp-modal-card">
        <div class="modal-header">
          <div class="modal-title">⌨️ Keyboard Shortcut Manager</div>
          <button class="modal-close-btn" id="btn-close-shortcut-modal">✕</button>
        </div>

        <div class="modal-toolbar">
          <div class="sc-search-wrap">
            <input type="text" id="shortcut-search-input" class="sc-search-input" placeholder="Search shortcuts (e.g. Fit, Grade, Ctrl+Z)..." />
          </div>
          <div class="sc-category-pills" id="sc-category-pills">
            <button class="sc-pill active" data-cat="All">All</button>
            <button class="sc-pill" data-cat="General">General</button>
            <button class="sc-pill" data-cat="Nodes">Nodes</button>
            <button class="sc-pill" data-cat="Viewer">Viewer</button>
            <button class="sc-pill" data-cat="Timeline">Timeline</button>
            <button class="sc-pill" data-cat="Selection">Selection</button>
          </div>
        </div>

        <div id="sc-conflict-banner" class="sc-conflict-banner" style="display:none;"></div>

        <div class="modal-body sc-table-container">
          <table class="sc-table">
            <thead>
              <tr>
                <th style="width: 25%;">Action</th>
                <th style="width: 15%;">Category</th>
                <th style="width: 35%;">Description</th>
                <th style="width: 15%;">Shortcut</th>
                <th style="width: 10%;">Actions</th>
              </tr>
            </thead>
            <tbody id="sc-table-body">
              <!-- Dynamically rendered -->
            </tbody>
          </table>
        </div>

        <div class="modal-footer">
          <button id="btn-sc-reset-all" class="btn-sc-secondary">Reset All to Defaults</button>
          <button id="btn-sc-done" class="btn-sc-primary">Done</button>
        </div>
      </div>
    `;

    // Hook modal controls
    modal.querySelector('#btn-close-shortcut-modal')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('#btn-sc-done')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('#btn-sc-reset-all')?.addEventListener('click', () => {
      if (confirm('Reset all keyboard shortcuts to studio factory defaults?')) {
        this.resetDefaults();
      }
    });

    const searchInput = modal.querySelector('#shortcut-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderModalTable();
      });
    }

    const pills = modal.querySelectorAll('.sc-pill');
    pills.forEach(pill => {
      pill.addEventListener('click', () => {
        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.activeCategoryFilter = pill.dataset.cat || 'All';
        this.renderModalTable();
      });
    });

    // Close on outside overlay click
    modal.addEventListener('mousedown', (e) => {
      if (e.target === modal) this.closeModal();
    });

    return modal;
  }

  renderModalTable() {
    const tbody = document.getElementById('sc-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    const list = Array.from(this.shortcuts.values());
    const filtered = list.filter(sc => {
      if (this.activeCategoryFilter !== 'All' && sc.category !== this.activeCategoryFilter) {
        return false;
      }
      if (this.searchQuery) {
        const text = `${sc.name} ${sc.category} ${sc.key} ${sc.defaultKey} ${sc.description}`.toLowerCase();
        if (!text.includes(this.searchQuery)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="5" class="sc-empty">No matching shortcuts found.</td>`;
      tbody.appendChild(tr);
      return;
    }

    for (const sc of filtered) {
      const isCustom = sc.key !== sc.defaultKey;
      const isRecording = this.recordingActionId === sc.id;

      const tr = document.createElement('tr');
      tr.className = isRecording ? 'recording-row' : '';

      tr.innerHTML = `
        <td class="sc-name"><strong>${sc.name}</strong></td>
        <td><span class="sc-cat-badge sc-cat-${sc.category.toLowerCase()}">${sc.category}</span></td>
        <td class="sc-desc">${sc.description}</td>
        <td>
          <button class="sc-key-badge ${isRecording ? 'recording' : ''} ${isCustom ? 'custom' : ''}" data-action="${sc.id}" title="${isRecording ? 'Press keys...' : 'Click to rebind'}">
            ${isRecording ? 'Press Keys...' : (sc.key || 'None')}
          </button>
        </td>
        <td class="sc-actions">
          ${isCustom ? `<button class="sc-reset-btn" data-reset="${sc.id}" title="Reset to default (${sc.defaultKey})">↺</button>` : ''}
        </td>
      `;

      // Rebind click
      const keyBadge = tr.querySelector('.sc-key-badge');
      keyBadge?.addEventListener('click', () => {
        this.startRecording(sc.id);
      });

      // Reset single shortcut click
      const resetBtn = tr.querySelector('.sc-reset-btn');
      resetBtn?.addEventListener('click', () => {
        this.resetShortcut(sc.id);
        this.renderModalTable();
      });

      tbody.appendChild(tr);
    }
  }

  startRecording(actionId) {
    this.recordingActionId = actionId;
    this.hideConflictBanner();
    this.renderModalTable();
  }

  handleRecordedKey(actionId, combo) {
    const conflict = this.checkConflict(actionId, combo);
    if (conflict.hasConflict) {
      this.showConflictBanner(
        `⚠️ <b>Conflict Detected:</b> <code>${combo}</code> is already assigned to <b>"${conflict.conflictingAction.name}"</b>. ` +
        `<button id="btn-force-assign" style="background:#d97706;color:#fff;border:none;padding:2px 8px;border-radius:3px;cursor:pointer;margin-left:8px;font-size:11px;">Override</button> ` +
        `<button id="btn-cancel-assign" style="background:#4b5563;color:#fff;border:none;padding:2px 8px;border-radius:3px;cursor:pointer;margin-left:4px;font-size:11px;">Cancel</button>`
      );

      document.getElementById('btn-force-assign')?.addEventListener('click', () => {
        // Clear conflict on other action
        conflict.conflictingAction.key = '';
        this.setShortcut(actionId, combo);
        this.recordingActionId = null;
        this.hideConflictBanner();
        this.renderModalTable();
      });

      document.getElementById('btn-cancel-assign')?.addEventListener('click', () => {
        this.recordingActionId = null;
        this.hideConflictBanner();
        this.renderModalTable();
      });

      return;
    }

    this.setShortcut(actionId, combo);
    this.recordingActionId = null;
    this.hideConflictBanner();
    this.renderModalTable();
  }

  showConflictBanner(html) {
    const banner = document.getElementById('sc-conflict-banner');
    if (banner) {
      banner.innerHTML = html;
      banner.style.display = 'block';
    }
  }

  hideConflictBanner() {
    const banner = document.getElementById('sc-conflict-banner');
    if (banner) {
      banner.style.display = 'none';
      banner.innerHTML = '';
    }
  }
}

