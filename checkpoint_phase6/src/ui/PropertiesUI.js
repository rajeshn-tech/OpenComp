/**
 * OpenComp - Properties & Knobs Control Panel UI
 * Foundry Nuke-style multi-card Properties Bin:
 * Supports multiple simultaneously open node property panels, collapsible cards,
 * per-node close buttons, live slider bindings, and embedded Roto/Paint/Depth/Stereo tools.
 */

import { PixelBuffer } from '../core/PixelBuffer.js';
import { RotoUI } from './RotoUI.js';
import { PaintUI } from './PaintUI.js';
import { DepthUI } from './DepthUI.js';
import { StereoUI } from './StereoUI.js';

export class PropertiesUI {
  constructor(containerElement, onParamChange, onRenderRequest, viewerUI = null) {
    this.container = containerElement;
    this.onParamChange = onParamChange;
    this.onRenderRequest = onRenderRequest;
    this.viewerUI = viewerUI;

    /** @type {Map<string, { node: any, card: HTMLElement, handler: any }>} */
    this.openNodes = new Map();
    this.activeNodeId = null;
    this.maxPanels = 10;

    // Clear all button in bin header
    const clearBtn = document.getElementById('btn-clear-properties');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearAll());
    }

    this.renderEmptyState();
  }

  renderEmptyState() {
    this.container.innerHTML = `
      <div class="empty-properties">
        <p>No node selected</p>
        <small>Select or double-click any node in the graph to edit parameters.</small>
      </div>
    `;
  }

  showNode(node) {
    if (!node) return;

    // Remove empty placeholder if present
    const emptyMsg = this.container.querySelector('.empty-properties');
    if (emptyMsg) emptyMsg.remove();

    // If node is already open, focus it
    if (this.openNodes.has(node.id)) {
      this.focusNode(node.id);
      return;
    }

    // Limit maximum open property panels (close oldest unpinned)
    if (this.openNodes.size >= this.maxPanels) {
      const oldestId = this.openNodes.keys().next().value;
      if (oldestId) this.closeNode(oldestId);
    }

    // Build new card
    const entry = this.createNodeCard(node);
    this.openNodes.set(node.id, entry);

    // Prepend to top of bin
    this.container.prepend(entry.card);
    this.focusNode(node.id);
  }

  focusNode(nodeId) {
    this.activeNodeId = nodeId;

    // Update focused styling
    for (const [id, entry] of this.openNodes.entries()) {
      if (id === nodeId) {
        entry.card.classList.add('focused');
        entry.card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        entry.card.classList.remove('focused');
      }
    }

    // Update Viewer tool handler for active node
    const activeEntry = this.openNodes.get(nodeId);
    if (activeEntry && this.viewerUI) {
      this.viewerUI.departmentHandler = activeEntry.handler || null;
      this.viewerUI.render();
    }
  }

  closeNode(nodeId) {
    const entry = this.openNodes.get(nodeId);
    if (!entry) return;

    entry.card.remove();
    this.openNodes.delete(nodeId);

    if (this.activeNodeId === nodeId) {
      const remainingIds = Array.from(this.openNodes.keys());
      if (remainingIds.length > 0) {
        this.focusNode(remainingIds[0]);
      } else {
        this.activeNodeId = null;
        if (this.viewerUI) {
          this.viewerUI.departmentHandler = null;
          this.viewerUI.onDrawOverlay = null;
          this.viewerUI.render();
        }
        this.renderEmptyState();
      }
    }
  }

  clearAll() {
    this.openNodes.clear();
    this.activeNodeId = null;
    this.container.innerHTML = '';
    this.renderEmptyState();
    if (this.viewerUI) {
      this.viewerUI.departmentHandler = null;
      this.viewerUI.onDrawOverlay = null;
      this.viewerUI.render();
    }
  }

  createNodeCard(node) {
    const card = document.createElement('div');
    card.className = 'node-properties-card';
    card.dataset.nodeId = node.id;

    // Header with collapse toggle, color bar, name input, type, disable checkbox, and close button
    const header = document.createElement('div');
    header.className = 'prop-header';
    header.style.borderLeft = `5px solid ${node.color || '#888'}`;

    header.innerHTML = `
      <div class="prop-title-row">
        <button class="prop-btn-icon btn-collapse" title="Collapse / Expand Panel">▼</button>
        <input type="text" class="prop-node-name" value="${node.name}" />
        <span class="prop-node-type">${node.type}</span>
      </div>
      <div class="prop-card-actions">
        <label class="prop-disable-label" title="Disable / Bypass Node (Hotkey: D)">
          <input type="checkbox" class="prop-disable-chk" ${node.disabled ? 'checked' : ''} />
          <span>[D]</span>
        </label>
        <button class="prop-btn-icon btn-close" title="Close Panel (✕)">✕</button>
      </div>
    `;

    // Collapse toggle
    const collapseBtn = header.querySelector('.btn-collapse');
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.toggle('collapsed');
      collapseBtn.textContent = card.classList.contains('collapsed') ? '▶' : '▼';
    });

    // Close button
    const closeBtn = header.querySelector('.btn-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeNode(node.id);
    });

    // Focus card on header click
    header.addEventListener('click', () => {
      this.focusNode(node.id);
    });

    // Name change
    const nameInput = header.querySelector('.prop-node-name');
    nameInput.addEventListener('change', (e) => {
      node.name = e.target.value.trim() || node.id;
      if (this.onParamChange) this.onParamChange(node);
    });

    // Disable checkbox
    const disableChk = header.querySelector('.prop-disable-chk');
    disableChk.addEventListener('change', (e) => {
      node.disabled = e.target.checked;
      node.markDirty();
      if (this.onParamChange) this.onParamChange(node);
    });

    card.appendChild(header);

    // Knobs body container
    const knobsBody = document.createElement('div');
    knobsBody.className = 'prop-knobs-body';

    // Special controls for Read node: File Upload
    if (node.type === 'Read') {
      const uploadRow = document.createElement('div');
      uploadRow.className = 'prop-knob-row file-upload-row';
      uploadRow.innerHTML = `
        <label>Upload Image</label>
        <input type="file" id="prop-file-input-${node.id}" accept="image/*" />
      `;
      const fileInput = uploadRow.querySelector(`#prop-file-input-${node.id}`);
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              const imgData = ctx.getImageData(0, 0, img.width, img.height);
              const buf = PixelBuffer.fromImageData(imgData);
              node.setUploadedImage(buf);
              if (this.onParamChange) this.onParamChange(node);
            };
            img.src = event.target.result;
          };
          reader.readAsDataURL(file);
        }
      });
      knobsBody.appendChild(uploadRow);
    }

    // Special controls for Write node: Export Button
    if (node.type === 'Write') {
      const exportRow = document.createElement('div');
      exportRow.className = 'prop-knob-row export-action-row';
      exportRow.innerHTML = `
        <button class="btn-primary prop-export-btn">Export Rendered Frame</button>
      `;
      const exportBtn = exportRow.querySelector('.prop-export-btn');
      exportBtn.addEventListener('click', () => {
        if (this.onRenderRequest) this.onRenderRequest(node);
      });
      knobsBody.appendChild(exportRow);
    }

    // Render each knob
    const isRoto = (node.type === 'Roto');
    const isPaint = (node.type === 'Paint');

    for (const [key, knob] of Object.entries(node.knobs)) {
      if (isRoto && key !== 'outputMode') continue;
      if (isPaint && key === 'opacity') continue;

      const row = document.createElement('div');
      row.className = 'prop-knob-row';

      const label = document.createElement('label');
      label.textContent = knob.label;
      row.appendChild(label);

      const controlWrap = document.createElement('div');
      controlWrap.className = 'knob-control-wrap';

      if (knob.type === 'select') {
        const select = document.createElement('select');
        select.className = 'prop-select';
        for (const opt of knob.options || []) {
          const option = document.createElement('option');
          option.value = opt.value;
          option.textContent = opt.label;
          if (opt.value === knob.value) option.selected = true;
          select.appendChild(option);
        }
        select.addEventListener('change', (e) => {
          node.setKnobValue(key, e.target.value);
          if (this.onParamChange) this.onParamChange(node);
        });
        controlWrap.appendChild(select);
      } else if (knob.type === 'number' || knob.type === 'float') {
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = knob.min ?? 0;
        slider.max = knob.max ?? (knob.value > 1.0 ? knob.value * 2 : 1.0);
        slider.step = knob.step ?? 0.01;
        slider.value = knob.value;
        slider.className = 'prop-slider';

        const numInput = document.createElement('input');
        numInput.type = 'number';
        numInput.step = knob.step ?? 0.01;
        numInput.value = Number(knob.value).toFixed(2);
        numInput.className = 'prop-num-input';

        slider.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          numInput.value = val.toFixed(2);
          node.setKnobValue(key, val);
          if (this.onParamChange) this.onParamChange(node);
        });

        numInput.addEventListener('change', (e) => {
          const val = parseFloat(e.target.value);
          slider.value = val;
          node.setKnobValue(key, val);
          if (this.onParamChange) this.onParamChange(node);
        });

        controlWrap.appendChild(slider);
        controlWrap.appendChild(numInput);
      } else if (knob.type === 'color') {
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = knob.value || '#ffffff';
        colorInput.className = 'prop-color-input';
        colorInput.addEventListener('change', (e) => {
          node.setKnobValue(key, e.target.value);
          if (this.onParamChange) this.onParamChange(node);
        });
        controlWrap.appendChild(colorInput);
      } else if (knob.type === 'boolean') {
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = !!knob.value;
        chk.className = 'prop-checkbox';
        chk.addEventListener('change', (e) => {
          node.setKnobValue(key, e.target.checked);
          if (this.onParamChange) this.onParamChange(node);
        });
        controlWrap.appendChild(chk);
      } else if (knob.type === 'text') {
        const txt = document.createElement('input');
        txt.type = 'text';
        txt.value = knob.value || '';
        txt.className = 'prop-text-input';
        txt.addEventListener('change', (e) => {
          node.setKnobValue(key, e.target.value);
          if (this.onParamChange) this.onParamChange(node);
        });
        controlWrap.appendChild(txt);
      }

      row.appendChild(controlWrap);
      knobsBody.appendChild(row);
    }

    card.appendChild(knobsBody);

    // =========================================================================
    // Embedded Specialized Node Tool Sections
    // =========================================================================
    let specializedHandler = null;

    if (isRoto) {
      const rotoContainer = document.createElement('div');
      const rotoUI = new RotoUI(rotoContainer, this.viewerUI, () => {
        node.markDirty();
        if (this.onParamChange) this.onParamChange(node);
      });
      rotoUI.setRotoNode(node);
      card.appendChild(rotoContainer);
      specializedHandler = rotoUI;
    } else if (isPaint) {
      const paintContainer = document.createElement('div');
      const paintUI = new PaintUI(paintContainer, this.viewerUI, () => {
        node.markDirty();
        if (this.onParamChange) this.onParamChange(node);
      });
      paintUI.setPaintNode(node);
      card.appendChild(paintContainer);
      specializedHandler = paintUI;
    } else if (node.type === 'Depth') {
      const depthContainer = document.createElement('div');
      const depthUI = new DepthUI(depthContainer, this.viewerUI, () => {
        node.markDirty();
        if (this.onParamChange) this.onParamChange(node);
      });
      depthUI.setDepthNode(node);
      card.appendChild(depthContainer);
    } else if (node.type === 'StereoWarp') {
      const stereoContainer = document.createElement('div');
      const stereoUI = new StereoUI(stereoContainer, this.viewerUI, () => {
        node.markDirty();
        if (this.onParamChange) this.onParamChange(node);
      });
      stereoUI.setWarpNode(node);
      card.appendChild(stereoContainer);
    } else if (node.type === 'StereoMerge') {
      const stereoContainer = document.createElement('div');
      const stereoUI = new StereoUI(stereoContainer, this.viewerUI, () => {
        node.markDirty();
        if (this.onParamChange) this.onParamChange(node);
      });
      stereoUI.setMergeNode(node);
      card.appendChild(stereoContainer);
    }

    return { node, card, handler: specializedHandler };
  }
}
