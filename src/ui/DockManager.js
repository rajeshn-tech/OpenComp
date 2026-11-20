/**
 * OpenComp - Professional Docking & Windowing Architecture (Phase 1)
 * Flexible modular panel docking manager supporting:
 * - Panel registration with stable identifiers
 * - Drag and drop docking with interactive drop zone highlights
 * - Horizontal and vertical splits with resizable splitters
 * - Tabbed panel groups with smooth tab switching
 * - Floating panel overlays with minimize, maximize, and re-dock controls
 * - Named workspace presets (Composite, Roto, 3D, Scripting)
 * - Custom workspace save/load, rename, delete, and persistence across sessions
 * - Minimum dimensions and ResizeObserver debounced canvas redraw notifications
 */

export class DockManager {
  constructor(options = {}) {
    this.container = options.container || document.getElementById('workspace-container');
    this.onResize = options.onResize || null;
    this.storageKey = 'opencomp_workspaces_v1';
    this.activeWorkspaceKey = 'opencomp_active_workspace';
    this.layoutStateKey = 'opencomp_dock_layout_v1';

    /** @type {Map<string, { id: string, title: string, element: HTMLElement, defaultContainer: HTMLElement, closable: boolean, visible: boolean, isFloating: boolean, floatingEl: HTMLElement|null }>} */
    this.panels = new Map();

    /** @type {string} */
    this.activePreset = 'Composite';

    /** @type {Map<string, any>} */
    this.customWorkspaces = new Map();

    // Default built-in presets
    this.builtinPresets = ['Composite', 'Roto', '3D', 'Deep / Stereo', 'Scripting', 'Production'];

    this.draggedPanelId = null;
    this.dropIndicator = null;
    this.isDraggingSplitter = false;

    this.initDropIndicator();
    this.loadCustomWorkspaces();
  }

  /**
   * Register a dockable panel
   * @param {string} id Unique panel identifier
   * @param {string} title Display name
   * @param {HTMLElement|string} elementOrSelector DOM element or query selector
   * @param {Object} opts Panel options
   */
  registerPanel(id, title, elementOrSelector, opts = {}) {
    let el = null;
    if (typeof elementOrSelector === 'string') {
      el = document.querySelector(elementOrSelector);
    } else {
      el = elementOrSelector;
    }

    if (!el && typeof document !== 'undefined') {
      // In tests or headless environments, create a dummy container if not found
      el = document.createElement('div');
      el.id = id;
    }

    const panelInfo = {
      id,
      title,
      element: el,
      defaultContainer: el ? el.parentElement : null,
      closable: opts.closable !== false,
      visible: opts.visible !== false,
      isFloating: false,
      floatingEl: null,
      minWidth: opts.minWidth || 160,
      minHeight: opts.minHeight || 100,
      header: null
    };

    this.panels.set(id, panelInfo);

    if (el) {
      el.dataset.dockPanelId = id;
      this.attachPanelHeader(panelInfo);
    }

    return panelInfo;
  }

  /**
   * Attach docking header with drag handle, title, and controls
   */
  attachPanelHeader(panel) {
    if (!panel.element || typeof document === 'undefined') return;

    // Check if panel already has a dock header
    let header = panel.element.querySelector(':scope > .dock-header');
    if (!header) {
      header = document.createElement('div');
      header.className = 'dock-header';
      header.innerHTML = `
        <div class="dock-header-drag" title="Drag to dock panel">
          <span class="dock-drag-icon">⋮⋮</span>
          <span class="dock-header-title">${panel.title}</span>
        </div>
        <div class="dock-header-controls">
          <button class="dock-btn dock-btn-float" title="Float / Undock panel">↗</button>
          ${panel.closable ? '<button class="dock-btn dock-btn-close" title="Close panel">✕</button>' : ''}
        </div>
      `;

      // Insert as first child of panel
      panel.element.insertBefore(header, panel.element.firstChild);
    }

    panel.header = header;

    // Drag events on header
    const dragHandle = header.querySelector('.dock-header-drag');
    if (dragHandle) {
      dragHandle.setAttribute('draggable', 'true');
      dragHandle.addEventListener('dragstart', (e) => this.onDragStart(e, panel.id));
      dragHandle.addEventListener('dragend', (e) => this.onDragEnd(e));
    }

    // Float button
    const floatBtn = header.querySelector('.dock-btn-float');
    if (floatBtn) {
      floatBtn.addEventListener('click', () => {
        if (panel.isFloating) {
          this.redockPanel(panel.id);
        } else {
          this.floatPanel(panel.id);
        }
      });
    }

    // Close button
    const closeBtn = header.querySelector('.dock-btn-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closePanel(panel.id));
    }

    // Drop zone listeners on panel element
    panel.element.addEventListener('dragover', (e) => this.onDragOver(e, panel.id));
    panel.element.addEventListener('dragleave', (e) => this.onDragLeave(e, panel.id));
    panel.element.addEventListener('drop', (e) => this.onDrop(e, panel.id));
  }

  /**
   * Create visual drop zone indicator
   */
  initDropIndicator() {
    if (typeof document === 'undefined') return;
    let ind = document.getElementById('dock-drop-indicator');
    if (!ind) {
      ind = document.createElement('div');
      ind.id = 'dock-drop-indicator';
      ind.className = 'dock-drop-indicator';
      ind.style.display = 'none';
      document.body.appendChild(ind);
    }
    this.dropIndicator = ind;
  }

  // --- Drag & Drop Docking Handlers ---

  onDragStart(e, panelId) {
    this.draggedPanelId = panelId;
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', panelId);
      e.dataTransfer.effectAllowed = 'move';
    }
    const panel = this.panels.get(panelId);
    if (panel && panel.element) {
      panel.element.classList.add('dock-panel-dragging');
    }
  }

  onDragEnd(e) {
    if (this.draggedPanelId) {
      const panel = this.panels.get(this.draggedPanelId);
      if (panel && panel.element) {
        panel.element.classList.remove('dock-panel-dragging');
      }
    }
    this.draggedPanelId = null;
    this.hideDropIndicator();
  }

  getDropPosition(e, targetEl) {
    const rect = targetEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    const edgeThreshold = 0.25; // 25% boundary threshold

    if (x < w * edgeThreshold) return 'left';
    if (x > w * (1 - edgeThreshold)) return 'right';
    if (y < h * edgeThreshold) return 'top';
    if (y > h * (1 - edgeThreshold)) return 'bottom';
    return 'center';
  }

  onDragOver(e, targetPanelId) {
    if (!this.draggedPanelId || this.draggedPanelId === targetPanelId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    const targetPanel = this.panels.get(targetPanelId);
    if (!targetPanel || !targetPanel.element) return;

    const pos = this.getDropPosition(e, targetPanel.element);
    this.showDropIndicator(targetPanel.element, pos);
  }

  onDragLeave(e, targetPanelId) {
    this.hideDropIndicator();
  }

  onDrop(e, targetPanelId) {
    e.preventDefault();
    const sourcePanelId = this.draggedPanelId || (e.dataTransfer ? e.dataTransfer.getData('text/plain') : null);
    if (!sourcePanelId || sourcePanelId === targetPanelId) {
      this.hideDropIndicator();
      return;
    }

    const targetPanel = this.panels.get(targetPanelId);
    if (!targetPanel || !targetPanel.element) return;

    const pos = this.getDropPosition(e, targetPanel.element);
    this.hideDropIndicator();
    this.dockPanelTo(sourcePanelId, targetPanelId, pos);
  }

  showDropIndicator(targetEl, position) {
    if (!this.dropIndicator) return;
    const rect = targetEl.getBoundingClientRect();
    this.dropIndicator.style.display = 'block';

    switch (position) {
      case 'left':
        this.dropIndicator.style.left = `${rect.left}px`;
        this.dropIndicator.style.top = `${rect.top}px`;
        this.dropIndicator.style.width = `${rect.width * 0.5}px`;
        this.dropIndicator.style.height = `${rect.height}px`;
        break;
      case 'right':
        this.dropIndicator.style.left = `${rect.left + rect.width * 0.5}px`;
        this.dropIndicator.style.top = `${rect.top}px`;
        this.dropIndicator.style.width = `${rect.width * 0.5}px`;
        this.dropIndicator.style.height = `${rect.height}px`;
        break;
      case 'top':
        this.dropIndicator.style.left = `${rect.left}px`;
        this.dropIndicator.style.top = `${rect.top}px`;
        this.dropIndicator.style.width = `${rect.width}px`;
        this.dropIndicator.style.height = `${rect.height * 0.5}px`;
        break;
      case 'bottom':
        this.dropIndicator.style.left = `${rect.left}px`;
        this.dropIndicator.style.top = `${rect.top + rect.height * 0.5}px`;
        this.dropIndicator.style.width = `${rect.width}px`;
        this.dropIndicator.style.height = `${rect.height * 0.5}px`;
        break;
      case 'center':
      default:
        this.dropIndicator.style.left = `${rect.left}px`;
        this.dropIndicator.style.top = `${rect.top}px`;
        this.dropIndicator.style.width = `${rect.width}px`;
        this.dropIndicator.style.height = `${rect.height}px`;
        break;
    }
  }

  hideDropIndicator() {
    if (this.dropIndicator) {
      this.dropIndicator.style.display = 'none';
    }
  }

  /**
   * Dock a source panel relative to a target panel
   */
  dockPanelTo(sourceId, targetId, position) {
    const source = this.panels.get(sourceId);
    const target = this.panels.get(targetId);
    if (!source || !target || !source.element || !target.element) return;

    if (source.isFloating) {
      this.redockPanel(sourceId);
    }

    const parent = target.element.parentElement;
    if (!parent) return;

    if (position === 'center') {
      // Tabbed docking
      this.createTabbedGroup(target, source);
    } else if (position === 'top' || position === 'left') {
      parent.insertBefore(source.element, target.element);
    } else {
      parent.insertBefore(source.element, target.element.nextSibling);
    }

    source.visible = true;
    source.element.style.display = '';
    this.notifyResize();
    this.saveCurrentLayoutState();
  }

  /**
   * Group two panels into a tabbed container
   */
  createTabbedGroup(panelA, panelB) {
    if (!panelA.element || !panelB.element) return;

    // Check if target is already inside a tabbed group
    let group = panelA.element.closest('.dock-tab-group');
    if (!group) {
      group = document.createElement('div');
      group.className = 'dock-tab-group';

      const tabHeader = document.createElement('div');
      tabHeader.className = 'dock-tab-bar';
      group.appendChild(tabHeader);

      const tabContent = document.createElement('div');
      tabContent.className = 'dock-tab-content';
      group.appendChild(tabContent);

      panelA.element.parentElement.insertBefore(group, panelA.element);
      tabContent.appendChild(panelA.element);
      this.addTabToBar(tabHeader, panelA, true);
    }

    const tabHeader = group.querySelector('.dock-tab-bar');
    const tabContent = group.querySelector('.dock-tab-content');
    tabContent.appendChild(panelB.element);
    this.addTabToBar(tabHeader, panelB, false);

    panelB.element.style.display = 'none';
  }

  addTabToBar(tabBar, panel, isActive) {
    if (!tabBar) return;
    const tab = document.createElement('button');
    tab.className = `dock-tab ${isActive ? 'active' : ''}`;
    tab.dataset.panelId = panel.id;
    tab.innerHTML = `<span>${panel.title}</span>`;
    tab.addEventListener('click', () => {
      const parent = tab.parentElement;
      parent.querySelectorAll('.dock-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const content = parent.nextElementSibling;
      if (content) {
        Array.from(content.children).forEach(child => {
          child.style.display = (child.dataset.dockPanelId === panel.id) ? '' : 'none';
        });
      }
      this.notifyResize();
    });
    tabBar.appendChild(tab);
  }

  /**
   * Undock a panel into a floating overlay window
   */
  floatPanel(panelId, initialBounds = null) {
    const panel = this.panels.get(panelId);
    if (!panel || !panel.element || panel.isFloating) return;

    // Create floating overlay container
    const floatWin = document.createElement('div');
    floatWin.className = 'opencomp-floating-panel';
    floatWin.id = `floating-${panelId}`;

    const bounds = initialBounds || {
      left: Math.max(80, window.innerWidth * 0.2),
      top: Math.max(60, window.innerHeight * 0.15),
      width: Math.min(800, window.innerWidth * 0.6),
      height: Math.min(600, window.innerHeight * 0.6)
    };

    floatWin.style.left = `${bounds.left}px`;
    floatWin.style.top = `${bounds.top}px`;
    floatWin.style.width = `${bounds.width}px`;
    floatWin.style.height = `${bounds.height}px`;

    const titleBar = document.createElement('div');
    titleBar.className = 'floating-titlebar';
    titleBar.innerHTML = `
      <div class="floating-title">${panel.title}</div>
      <div class="floating-controls">
        <button class="float-btn float-redock" title="Re-dock into workspace">↙ Re-dock</button>
        <button class="float-btn float-close" title="Close panel">✕</button>
      </div>
    `;

    const body = document.createElement('div');
    body.className = 'floating-body';

    floatWin.appendChild(titleBar);
    floatWin.appendChild(body);

    // Save placeholder in original parent
    panel.placeholder = document.createElement('div');
    panel.placeholder.className = 'dock-placeholder';
    panel.placeholder.style.display = 'none';
    panel.element.parentElement.insertBefore(panel.placeholder, panel.element);

    // Reparent panel element to floating body
    body.appendChild(panel.element);
    document.body.appendChild(floatWin);

    panel.isFloating = true;
    panel.floatingEl = floatWin;

    // Floating window draggable titlebar
    this.makeFloatingDraggable(floatWin, titleBar);

    // Re-dock button
    titleBar.querySelector('.float-redock')?.addEventListener('click', () => {
      this.redockPanel(panelId);
    });

    // Close button
    titleBar.querySelector('.float-close')?.addEventListener('click', () => {
      this.closePanel(panelId);
    });

    this.notifyResize();
    this.saveCurrentLayoutState();
  }

  makeFloatingDraggable(win, titleBar) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let origX = 0;
    let origY = 0;

    titleBar.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origX = win.offsetLeft;
      origY = win.offsetTop;
      win.classList.add('dragging');
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      win.style.left = `${Math.max(0, origX + dx)}px`;
      win.style.top = `${Math.max(32, origY + dy)}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        win.classList.remove('dragging');
      }
    });
  }

  /**
   * Re-dock a floating panel back to its workspace position
   */
  redockPanel(panelId) {
    const panel = this.panels.get(panelId);
    if (!panel || !panel.isFloating) return;

    if (panel.placeholder && panel.placeholder.parentElement) {
      panel.placeholder.parentElement.insertBefore(panel.element, panel.placeholder);
      panel.placeholder.remove();
      panel.placeholder = null;
    } else if (panel.defaultContainer) {
      panel.defaultContainer.appendChild(panel.element);
    }

    if (panel.floatingEl) {
      panel.floatingEl.remove();
      panel.floatingEl = null;
    }

    panel.isFloating = false;
    panel.visible = true;
    panel.element.style.display = '';

    this.notifyResize();
    this.saveCurrentLayoutState();
  }

  /**
   * Close / Hide a panel
   */
  closePanel(panelId) {
    const panel = this.panels.get(panelId);
    if (!panel) return;

    if (panel.isFloating && panel.floatingEl) {
      panel.floatingEl.style.display = 'none';
    } else if (panel.element) {
      panel.element.style.display = 'none';
    }

    panel.visible = false;
    this.updatePanelMenuCheckboxes();
    this.notifyResize();
    this.saveCurrentLayoutState();
  }

  /**
   * Show / Restore a panel
   */
  showPanel(panelId) {
    const panel = this.panels.get(panelId);
    if (!panel) return;

    if (panel.isFloating && panel.floatingEl) {
      panel.floatingEl.style.display = '';
    } else if (panel.element) {
      panel.element.style.display = '';
    }

    panel.visible = true;
    this.updatePanelMenuCheckboxes();
    this.notifyResize();
    this.saveCurrentLayoutState();
  }

  /**
   * Toggle visibility of a panel
   */
  togglePanel(panelId, forceState) {
    const panel = this.panels.get(panelId);
    if (!panel) return;
    const target = forceState !== undefined ? forceState : !panel.visible;
    if (target) {
      this.showPanel(panelId);
    } else {
      this.closePanel(panelId);
    }
  }

  // --- Named Workspaces ---

  /**
   * Apply a workspace preset
   * @param {string} presetName One of: 'Composite', 'Roto', '3D', 'Scripting'
   */
  applyPreset(presetName) {
    // Redock any floating panels first
    for (const [id, panel] of this.panels.entries()) {
      if (panel.isFloating) {
        this.redockPanel(id);
      }
    }

    const wsContainer = this.container || document.getElementById('workspace-container');
    const viewerPanel = document.querySelector('.viewer-panel');
    const dagPanel = document.getElementById('node-graph-panel');
    const propPanel = document.getElementById('properties-panel');
    const timelineBar = document.getElementById('timeline-bar');
    const leftStack = document.querySelector('.left-stack');

    // Reset base display
    for (const panel of this.panels.values()) {
      panel.visible = true;
      if (panel.element) panel.element.style.display = '';
    }

    switch (presetName) {
      case 'Roto':
        // Roto preset: Expanded viewer (72%), compact DAG (28%), full properties
        if (wsContainer) {
          wsContainer.style.gridTemplateColumns = '44px 1fr 6px 360px';
          wsContainer.style.setProperty('--properties-width', '360px');
        }
        if (viewerPanel) {
          viewerPanel.style.setProperty('--viewer-height', '72%');
          viewerPanel.style.height = '72%';
        }
        break;

      case '3D':
        // 3D preset: Side-by-side Viewer and DAG
        if (wsContainer) {
          wsContainer.style.gridTemplateColumns = '44px 1fr 6px 320px';
          wsContainer.style.setProperty('--properties-width', '320px');
        }
        if (viewerPanel) {
          viewerPanel.style.setProperty('--viewer-height', '50%');
          viewerPanel.style.height = '50%';
        }
        break;

      case 'Deep / Stereo':
        // Deep / Stereo preset: 55% Viewer, 45% DAG / Deep Inspector, 360px Properties
        if (wsContainer) {
          wsContainer.style.gridTemplateColumns = '44px 1fr 6px 360px';
          wsContainer.style.setProperty('--properties-width', '360px');
        }
        if (viewerPanel) {
          viewerPanel.style.setProperty('--viewer-height', '55%');
          viewerPanel.style.height = '55%';
        }
        break;

      case 'Scripting':
        // Scripting preset: Balanced layout focusing on Node Graph and Properties for scripting & expressions
        if (wsContainer) {
          wsContainer.style.gridTemplateColumns = '44px 1fr 6px 360px';
          wsContainer.style.setProperty('--properties-width', '360px');
        }
        if (viewerPanel) {
          viewerPanel.style.setProperty('--viewer-height', '50%');
          viewerPanel.style.height = '50%';
        }
        break;

      case 'Production':
        // Production preset: Expanded DAG/Production farm area (60%), 40% Viewer, 380px Properties
        if (wsContainer) {
          wsContainer.style.gridTemplateColumns = '44px 1fr 6px 380px';
          wsContainer.style.setProperty('--properties-width', '380px');
        }
        if (viewerPanel) {
          viewerPanel.style.setProperty('--viewer-height', '40%');
          viewerPanel.style.height = '40%';
        }
        break;

      case 'Composite':
      default:
        // Standard VFX Compositing layout: 55% Viewer, 45% DAG, 340px Properties
        presetName = 'Composite';
        if (wsContainer) {
          wsContainer.style.gridTemplateColumns = '44px 1fr 6px 340px';
          wsContainer.style.setProperty('--properties-width', '340px');
        }
        if (viewerPanel) {
          viewerPanel.style.setProperty('--viewer-height', '55%');
          viewerPanel.style.height = '55%';
        }
        break;
    }

    this.activePreset = presetName;
    try {
      localStorage.setItem(this.activeWorkspaceKey, presetName);
    } catch (e) { }

    this.updateWorkspaceMenu();
    this.updatePanelMenuCheckboxes();
    this.notifyResize();
  }

  /**
   * Save a custom workspace
   */
  saveCustomWorkspace(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (!trimmed) return false;

    const layout = this.serializeCurrentLayout();
    this.customWorkspaces.set(trimmed, layout);

    try {
      const obj = {};
      for (const [k, v] of this.customWorkspaces.entries()) {
        obj[k] = v;
      }
      localStorage.setItem(this.storageKey, JSON.stringify(obj));
      localStorage.setItem(this.activeWorkspaceKey, trimmed);
    } catch (e) { }

    this.activePreset = trimmed;
    this.updateWorkspaceMenu();
    return true;
  }

  /**
   * Load custom workspace or preset
   */
  loadWorkspace(name) {
    if (this.builtinPresets.includes(name)) {
      this.applyPreset(name);
      return true;
    }

    if (this.customWorkspaces.has(name)) {
      const layout = this.customWorkspaces.get(name);
      this.applySerializedLayout(layout);
      this.activePreset = name;
      try {
        localStorage.setItem(this.activeWorkspaceKey, name);
      } catch (e) { }
      this.updateWorkspaceMenu();
      this.updatePanelMenuCheckboxes();
      this.notifyResize();
      return true;
    }

    return false;
  }

  /**
   * Delete custom workspace
   */
  deleteCustomWorkspace(name) {
    if (!this.customWorkspaces.has(name)) return false;
    this.customWorkspaces.delete(name);

    try {
      const obj = {};
      for (const [k, v] of this.customWorkspaces.entries()) {
        obj[k] = v;
      }
      localStorage.setItem(this.storageKey, JSON.stringify(obj));
    } catch (e) { }

    if (this.activePreset === name) {
      this.applyPreset('Composite');
    } else {
      this.updateWorkspaceMenu();
    }
    return true;
  }

  /**
   * Reset layout to default Composite preset
   */
  resetLayout() {
    this.applyPreset('Composite');
  }

  /**
   * Get all available workspaces (built-in + custom)
   */
  getWorkspaces() {
    return {
      presets: [...this.builtinPresets],
      custom: Array.from(this.customWorkspaces.keys()),
      active: this.activePreset
    };
  }

  serializeCurrentLayout() {
    const wsContainer = this.container || document.getElementById('workspace-container');
    const viewerPanel = document.querySelector('.viewer-panel');
    const propPanel = document.getElementById('properties-panel');

    const panelStates = {};
    for (const [id, panel] of this.panels.entries()) {
      panelStates[id] = {
        visible: panel.visible,
        isFloating: panel.isFloating,
        floatingBounds: panel.floatingEl ? {
          left: panel.floatingEl.offsetLeft,
          top: panel.floatingEl.offsetTop,
          width: panel.floatingEl.offsetWidth,
          height: panel.floatingEl.offsetHeight
        } : null
      };
    }

    return {
      version: 1,
      preset: this.activePreset,
      propWidth: propPanel ? propPanel.offsetWidth : 340,
      viewerHeight: viewerPanel ? viewerPanel.offsetHeight : 450,
      gridColumns: wsContainer ? wsContainer.style.gridTemplateColumns : null,
      panels: panelStates
    };
  }

  applySerializedLayout(layout) {
    if (!layout) return;

    // Redock all first
    for (const id of this.panels.keys()) {
      if (this.panels.get(id).isFloating) {
        this.redockPanel(id);
      }
    }

    const wsContainer = this.container || document.getElementById('workspace-container');
    const viewerPanel = document.querySelector('.viewer-panel');

    if (layout.propWidth && wsContainer) {
      wsContainer.style.setProperty('--properties-width', `${layout.propWidth}px`);
    }
    if (layout.viewerHeight && viewerPanel) {
      viewerPanel.style.setProperty('--viewer-height', `${layout.viewerHeight}px`);
    }
    if (layout.gridColumns && wsContainer) {
      wsContainer.style.gridTemplateColumns = layout.gridColumns;
    }

    if (layout.panels) {
      for (const [id, pState] of Object.entries(layout.panels)) {
        const panel = this.panels.get(id);
        if (!panel) continue;

        if (pState.isFloating) {
          this.floatPanel(id, pState.floatingBounds);
        } else if (!pState.visible) {
          this.closePanel(id);
        } else {
          this.showPanel(id);
        }
      }
    }
  }

  saveCurrentLayoutState() {
    try {
      const state = this.serializeCurrentLayout();
      localStorage.setItem(this.layoutStateKey, JSON.stringify(state));
    } catch (e) { }
  }

  loadCustomWorkspaces() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const [k, v] of Object.entries(parsed)) {
          this.customWorkspaces.set(k, v);
        }
      }
    } catch (e) { }
  }

  restoreSessionLayout() {
    try {
      const lastActive = localStorage.getItem(this.activeWorkspaceKey);
      if (lastActive && (this.builtinPresets.includes(lastActive) || this.customWorkspaces.has(lastActive))) {
        this.loadWorkspace(lastActive);
        return;
      }

      const raw = localStorage.getItem(this.layoutStateKey);
      if (raw) {
        const state = JSON.parse(raw);
        this.applySerializedLayout(state);
        return;
      }
    } catch (e) { }

    // Default to Composite
    this.applyPreset('Composite');
  }

  notifyResize() {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        if (typeof this.onResize === 'function') {
          this.onResize();
        }
      });
    } else if (typeof this.onResize === 'function') {
      this.onResize();
    }
  }

  updateWorkspaceMenu() {
    // Dynamically update workspace menu items if present in DOM
    const menuList = document.getElementById('workspace-menu-presets-list');
    if (!menuList) return;

    menuList.innerHTML = '';

    // Builtin presets
    for (const preset of this.builtinPresets) {
      const a = document.createElement('a');
      a.href = '#';
      a.className = `ws-preset-item ${this.activePreset === preset ? 'active-ws' : ''}`;
      a.textContent = `${this.activePreset === preset ? '✓ ' : '  '}${preset}`;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        this.applyPreset(preset);
      });
      menuList.appendChild(a);
    }

    // Custom workspaces
    if (this.customWorkspaces.size > 0) {
      const hr = document.createElement('hr');
      menuList.appendChild(hr);

      for (const customName of this.customWorkspaces.keys()) {
        const a = document.createElement('a');
        a.href = '#';
        a.className = `ws-preset-item ${this.activePreset === customName ? 'active-ws' : ''}`;
        a.textContent = `${this.activePreset === customName ? '✓ ' : '  '}${customName}`;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          this.loadWorkspace(customName);
        });
        menuList.appendChild(a);
      }
    }
  }

  updatePanelMenuCheckboxes() {
    for (const [id, panel] of this.panels.entries()) {
      const chk = document.getElementById(`toggle-panel-${id}`);
      if (chk) {
        chk.checked = panel.visible;
      }
    }
  }
}

