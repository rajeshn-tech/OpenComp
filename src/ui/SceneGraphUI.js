/**
 * OpenComp - Scene Graph Hierarchy Panel UI
 * Professional Nuke-Style 3D Scene Browser:
 * - Hierarchical tree of all 3D scene objects (Cameras, Geometries, Axes, Scenes, Projections, Renderers)
 * - Expand / collapse groups and parented hierarchy branches
 * - Per-object visibility toggle (eye icon toggles 3D viewport rendering) and selection
 * - Object badges with distinctive category icons (🎥 Camera, 🔲 Card, 📦 Cube, 🌐 Axis, 🎬 Scene, 📽 Project3D, 🖨 Scanline)
 * - Quick framing button [🎯 Frame] to instantly center and frame an object in the 3D Viewer
 * - Bidirectional synchronization with DAG selection, Properties Panel, and 3D Viewport Manipulators
 * - Search filter for rapid inspection of large scene graphs
 */

export class SceneGraphUI {
  constructor(containerElement, graph = null, viewer3D = null, onNodeSelect = null) {
    this.container = containerElement;
    this.graph = graph;
    this.viewer3D = viewer3D;
    this.onNodeSelect = onNodeSelect;

    this.selectedNodeId = null;
    this.filterText = '';
    this.expandedGroups = new Set(['cameras', 'geometries', 'transforms', 'projections', 'scenes', 'renderers']);

    this.initDOM();
  }

  setGraph(graph) {
    this.graph = graph;
    this.render();
  }

  setViewer3D(viewer3D) {
    this.viewer3D = viewer3D;
  }

  setSelectedNode(node) {
    this.selectedNodeId = node ? node.id : null;
    this.updateSelection();
  }

  initDOM() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="scenegraph-panel-header">
        <div class="scenegraph-title-bar">
          <span class="scenegraph-title">🌐 3D Scene Graph</span>
          <div class="scenegraph-actions">
            <button id="btn-scenegraph-refresh" class="btn-tool-sm" title="Refresh Scene Tree">🔄</button>
            <button id="btn-scenegraph-expand-all" class="btn-tool-sm" title="Expand All">▼</button>
            <button id="btn-scenegraph-collapse-all" class="btn-tool-sm" title="Collapse All">▶</button>
          </div>
        </div>
        <div class="scenegraph-search-bar">
          <input type="text" id="scenegraph-search-input" class="sc-search-input" placeholder="Filter 3D objects (e.g. Camera, Card, Axis)..." autocomplete="off" />
        </div>
      </div>
      <div class="scenegraph-tree-container" id="scenegraph-tree-container">
        <!-- Dynamically rendered -->
      </div>
    `;

    const searchInput = this.container.querySelector('#scenegraph-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterText = e.target.value.toLowerCase().trim();
        this.render();
      });
    }

    const refreshBtn = this.container.querySelector('#btn-scenegraph-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.render());
    }

    const expandAllBtn = this.container.querySelector('#btn-scenegraph-expand-all');
    if (expandAllBtn) {
      expandAllBtn.addEventListener('click', () => {
        this.expandedGroups = new Set(['cameras', 'geometries', 'transforms', 'projections', 'scenes', 'renderers']);
        this.render();
      });
    }

    const collapseAllBtn = this.container.querySelector('#btn-scenegraph-collapse-all');
    if (collapseAllBtn) {
      collapseAllBtn.addEventListener('click', () => {
        this.expandedGroups.clear();
        this.render();
      });
    }

    this.render();
  }

  get3DNodes() {
    if (!this.graph) return [];
    const valid3DTypes = ['Axis3D', 'Camera3D', 'Card3D', 'Cube3D', 'Scene3D', 'Project3D', 'ScanlineRender'];
    return this.graph.getAllNodes().filter(n => valid3DTypes.includes(n.type));
  }

  render() {
    const treeEl = this.container ? this.container.querySelector('#scenegraph-tree-container') : null;
    if (!treeEl) return;

    const all3D = this.get3DNodes();
    if (all3D.length === 0) {
      treeEl.innerHTML = `
        <div class="scenegraph-empty-state">
          <div style="font-size:24px; margin-bottom:8px;">🧊</div>
          <div style="color:var(--text-muted); font-size:12px;">No 3D scene nodes in graph.</div>
          <div style="color:#666; font-size:11px; margin-top:4px;">Add Camera3D, Card3D, Cube3D, or Scene3D to begin.</div>
        </div>
      `;
      return;
    }

    // Group nodes
    const cameras = all3D.filter(n => n.type === 'Camera3D');
    const geometries = all3D.filter(n => ['Card3D', 'Cube3D'].includes(n.type));
    const transforms = all3D.filter(n => n.type === 'Axis3D');
    const projections = all3D.filter(n => n.type === 'Project3D');
    const scenes = all3D.filter(n => n.type === 'Scene3D');
    const renderers = all3D.filter(n => n.type === 'ScanlineRender');

    const groups = [
      { id: 'cameras', label: 'Cameras', icon: '🎥', items: cameras },
      { id: 'geometries', label: 'Geometries', icon: '🔲', items: geometries },
      { id: 'transforms', label: 'Transforms & Axes', icon: '🌐', items: transforms },
      { id: 'projections', label: 'Projections', icon: '📽️', items: projections },
      { id: 'scenes', label: 'Scenes & Consolidators', icon: '🎬', items: scenes },
      { id: 'renderers', label: 'Renderers', icon: '🖨️', items: renderers }
    ];

    treeEl.innerHTML = '';

    for (const grp of groups) {
      const filteredItems = grp.items.filter(item => {
        if (!this.filterText) return true;
        return item.name.toLowerCase().includes(this.filterText) || item.type.toLowerCase().includes(this.filterText);
      });

      if (filteredItems.length === 0) continue;

      const isExpanded = this.expandedGroups.has(grp.id) || !!this.filterText;
      const groupEl = document.createElement('div');
      groupEl.className = `sc-tree-group ${isExpanded ? 'expanded' : 'collapsed'}`;

      const headerEl = document.createElement('div');
      headerEl.className = 'sc-tree-group-header';
      headerEl.innerHTML = `
        <span class="sc-tree-arrow">${isExpanded ? '▼' : '▶'}</span>
        <span class="sc-tree-group-icon">${grp.icon}</span>
        <span class="sc-tree-group-label">${grp.label}</span>
        <span class="sc-tree-count">(${filteredItems.length})</span>
      `;

      headerEl.addEventListener('click', () => {
        if (this.expandedGroups.has(grp.id)) {
          this.expandedGroups.delete(grp.id);
        } else {
          this.expandedGroups.add(grp.id);
        }
        this.render();
      });

      groupEl.appendChild(headerEl);

      if (isExpanded) {
        const itemsListEl = document.createElement('div');
        itemsListEl.className = 'sc-tree-items-list';

        for (const item of filteredItems) {
          const isSelected = item.id === this.selectedNodeId;
          const isVisible = item._viewer3dVisible !== false;

          const itemEl = document.createElement('div');
          itemEl.className = `sc-tree-item ${isSelected ? 'selected' : ''}`;
          itemEl.dataset.nodeId = item.id;

          // Badges and parent connections
          let parentHint = '';
          const axisInput = item.inputs && item.inputs['axis'];
          if (axisInput && axisInput.connectedNodeId) {
            const parentNode = this.graph.getNode(axisInput.connectedNodeId);
            if (parentNode) {
              parentHint = `<span class="sc-tree-parent-hint" title="Parented to ${parentNode.name}">↳ ${parentNode.name}</span>`;
            }
          }

          // Transform summary readout
          const tx = Number(item.getKnobValue('translateX')) || 0;
          const ty = Number(item.getKnobValue('translateY')) || 0;
          const tz = Number(item.getKnobValue('translateZ')) || 0;
          const coordText = (item.hasKnob && item.hasKnob('translateX'))
            ? `<span class="sc-tree-coords">(${tx.toFixed(1)}, ${ty.toFixed(1)}, ${tz.toFixed(1)})</span>`
            : '';

          itemEl.innerHTML = `
            <button class="sc-tree-vis-btn ${isVisible ? 'active' : 'hidden'}" title="Toggle 3D Viewport Visibility">
              ${isVisible ? '👁' : '─'}
            </button>
            <span class="sc-tree-node-icon">${this.getNodeIcon(item.type)}</span>
            <span class="sc-tree-node-name" title="${item.name} (${item.type})">${item.name}</span>
            ${parentHint}
            ${coordText}
            <div class="sc-tree-item-actions">
              <button class="sc-tree-frame-btn" title="Frame in 3D Viewer [F]">🎯</button>
            </div>
          `;

          // Click on item selects it
          itemEl.addEventListener('click', (e) => {
            if (e.target.closest('.sc-tree-vis-btn') || e.target.closest('.sc-tree-frame-btn')) return;
            this.selectedNodeId = item.id;
            this.updateSelection();
            if (this.viewer3D) {
              this.viewer3D.setSelectedNode(item);
              this.viewer3D.render();
            }
            if (this.onNodeSelect) {
              this.onNodeSelect(item);
            }
          });

          // Visibility toggle
          const visBtn = itemEl.querySelector('.sc-tree-vis-btn');
          if (visBtn) {
            visBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              item._viewer3dVisible = !(item._viewer3dVisible !== false);
              visBtn.textContent = item._viewer3dVisible ? '👁' : '─';
              visBtn.classList.toggle('active', item._viewer3dVisible);
              visBtn.classList.toggle('hidden', !item._viewer3dVisible);
              if (this.viewer3D) this.viewer3D.render();
            });
          }

          // Frame button
          const frameBtn = itemEl.querySelector('.sc-tree-frame-btn');
          if (frameBtn) {
            frameBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.selectedNodeId = item.id;
              this.updateSelection();
              if (this.viewer3D) {
                this.viewer3D.setSelectedNode(item);
                this.viewer3D.frameSelected();
                this.viewer3D.render();
              }
              if (this.onNodeSelect) {
                this.onNodeSelect(item);
              }
            });
          }

          itemsListEl.appendChild(itemEl);
        }

        groupEl.appendChild(itemsListEl);
      }

      treeEl.appendChild(groupEl);
    }
  }

  updateSelection() {
    if (!this.container) return;
    const items = this.container.querySelectorAll('.sc-tree-item');
    items.forEach(el => {
      const isSelected = el.dataset.nodeId === this.selectedNodeId;
      el.classList.toggle('selected', isSelected);
    });
  }

  getNodeIcon(type) {
    switch (type) {
      case 'Camera3D': return '🎥';
      case 'Card3D': return '🔲';
      case 'Cube3D': return '📦';
      case 'Axis3D': return '🌐';
      case 'Scene3D': return '🎬';
      case 'Project3D': return '📽️';
      case 'ScanlineRender': return '🖨️';
      default: return '🧊';
    }
  }
}

