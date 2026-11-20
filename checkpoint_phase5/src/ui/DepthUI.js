/**
 * OpenComp - Department 3: Depth UI & Interactive Workspace
 * Provides tools for manual 2D-to-3D depth sculpting: perspective ground ramps,
 * roto-object depth assignment, near/far range calibration, and false-color heatmaps.
 */

export class DepthUI {
  constructor(containerElement, viewerUI, onDepthUpdate) {
    this.container = containerElement;
    this.viewerUI = viewerUI;
    this.onDepthUpdate = onDepthUpdate;

    this.activeDepthNode = null;
    this.activeRotoNode = null;

    this.render();
  }

  setDepthNode(depthNode) {
    this.activeDepthNode = depthNode;
    this.syncControls();
  }

  setRotoNode(rotoNode) {
    this.activeRotoNode = rotoNode;
    this.updateRotoShapeDropdown();
  }

  render() {
    this.container.innerHTML = `
      <div class="depth-workspace-panel">
        <div class="depth-header">
          <span class="depth-title">🏔️ Manual Depth & 2D-to-3D Stereo</span>
        </div>

        <div class="depth-section">
          <label class="depth-section-label">Perspective Ground & Environment:</label>
          <div class="depth-prop-row">
            <span>Ramp Type:</span>
            <select id="depth-gradient-type" class="roto-select">
              <option value="ground_plane">Ground Plane (Perspective)</option>
              <option value="linear">Linear Vertical Ramp</option>
              <option value="radial">Radial Sphere Depth</option>
              <option value="flat">Flat Uniform Distance</option>
            </select>
          </div>
          <div class="depth-prop-row">
            <span>Base Depth:</span>
            <input type="range" id="depth-base-slider" min="0" max="1" step="0.02" value="0.8" />
            <span id="depth-base-val">0.80</span>
          </div>
        </div>

        <div class="depth-section">
          <label class="depth-section-label">Near / Far Plane Calibration:</label>
          <div class="depth-prop-row">
            <span>Near Clip (Z-Min):</span>
            <input type="range" id="depth-near-slider" min="0" max="1" step="0.02" value="0.0" />
            <span id="depth-near-val">0.00</span>
          </div>
          <div class="depth-prop-row">
            <span>Far Clip (Z-Max):</span>
            <input type="range" id="depth-far-slider" min="0" max="1" step="0.02" value="1.0" />
            <span id="depth-far-val">1.00</span>
          </div>
          <div class="depth-prop-row">
            <span>Contrast:</span>
            <input type="range" id="depth-contrast-slider" min="0.1" max="3" step="0.05" value="1.0" />
            <span id="depth-contrast-val">1.00</span>
          </div>
          <div class="depth-prop-row">
            <span>Offset:</span>
            <input type="range" id="depth-offset-slider" min="-1" max="1" step="0.02" value="0.0" />
            <span id="depth-offset-val">0.00</span>
          </div>
        </div>

        <div class="depth-section">
          <label class="depth-section-label">Roto Object Depth Assignment:</label>
          <div class="depth-prop-row">
            <span>Select Shape:</span>
            <select id="depth-roto-shape-select" class="roto-select">
              <option value="">(Connect Roto Input)</option>
            </select>
          </div>
          <div class="depth-prop-row">
            <span>Object Depth:</span>
            <input type="range" id="depth-obj-slider" min="0" max="1" step="0.02" value="0.35" />
            <span id="depth-obj-val">0.35</span>
          </div>
          <div class="depth-prop-row">
            <span>Edge Smoothing:</span>
            <input type="range" id="depth-smooth-slider" min="0" max="8" step="1" value="0" />
            <span id="depth-smooth-val">0px</span>
          </div>
        </div>

        <div class="depth-section">
          <label class="depth-section-label">Depth Inspection Modes:</label>
          <div class="depth-prop-row">
            <button id="btn-depth-grayscale" class="btn-tool active">Grayscale (Z)</button>
            <button id="btn-depth-heatmap" class="btn-tool">Turbo Heatmap</button>
          </div>
          <div class="depth-probe-box">
            <span>Probe at Cursor:</span>
            <span id="depth-probe-value" style="font-family:monospace; color:#39ff14; font-weight:bold;">Z: 0.500</span>
          </div>
        </div>
      </div>
    `;

    this.initEventListeners();
  }

  initEventListeners() {
    const bindSlider = (id, knobName, valId, formatFn) => {
      const slider = this.container.querySelector(`#${id}`);
      const valLabel = this.container.querySelector(`#${valId}`);
      slider?.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        if (valLabel) valLabel.textContent = formatFn ? formatFn(val) : val.toFixed(2);
        if (this.activeDepthNode) {
          this.activeDepthNode.setKnobValue(knobName, val);
          if (this.onDepthUpdate) this.onDepthUpdate();
        }
      });
    };

    bindSlider('depth-base-slider', 'baseDepth', 'depth-base-val');
    bindSlider('depth-near-slider', 'nearClip', 'depth-near-val');
    bindSlider('depth-far-slider', 'farClip', 'depth-far-val');
    bindSlider('depth-contrast-slider', 'contrast', 'depth-contrast-val');
    bindSlider('depth-offset-slider', 'offset', 'depth-offset-val');
    bindSlider('depth-obj-slider', 'objectDepth', 'depth-obj-val');
    bindSlider('depth-smooth-slider', 'smoothRadius', 'depth-smooth-val', v => `${v}px`);

    const typeSelect = this.container.querySelector('#depth-gradient-type');
    typeSelect?.addEventListener('change', (e) => {
      if (this.activeDepthNode) {
        this.activeDepthNode.setKnobValue('gradientType', e.target.value);
        if (this.onDepthUpdate) this.onDepthUpdate();
      }
    });

    const btnGray = this.container.querySelector('#btn-depth-grayscale');
    const btnHeat = this.container.querySelector('#btn-depth-heatmap');

    btnGray?.addEventListener('click', () => {
      btnGray.classList.add('active');
      btnHeat.classList.remove('active');
      if (this.activeDepthNode) {
        this.activeDepthNode.setKnobValue('displayMode', 'grayscale');
        if (this.onDepthUpdate) this.onDepthUpdate();
      }
    });

    btnHeat?.addEventListener('click', () => {
      btnHeat.classList.add('active');
      btnGray.classList.remove('active');
      if (this.activeDepthNode) {
        this.activeDepthNode.setKnobValue('displayMode', 'heatmap');
        if (this.onDepthUpdate) this.onDepthUpdate();
      }
    });
  }

  updateRotoShapeDropdown() {
    const sel = this.container.querySelector('#depth-roto-shape-select');
    if (!sel) return;
    sel.innerHTML = '';

    if (!this.activeRotoNode || this.activeRotoNode.shapes.length === 0) {
      sel.innerHTML = '<option value="">(No active roto shapes)</option>';
      return;
    }

    for (const shape of this.activeRotoNode.shapes) {
      const opt = document.createElement('option');
      opt.value = shape.id;
      opt.textContent = `${shape.name} (${shape.points.length} pts)`;
      sel.appendChild(opt);
    }
  }

  syncControls() {
    if (!this.activeDepthNode) return;
    const n = this.activeDepthNode;

    const setSlider = (id, knobName, valId, formatFn) => {
      const s = this.container.querySelector(`#${id}`);
      const l = this.container.querySelector(`#${valId}`);
      const val = Number(n.getKnobValue(knobName));
      if (s && !isNaN(val)) s.value = val;
      if (l && !isNaN(val)) l.textContent = formatFn ? formatFn(val) : val.toFixed(2);
    };

    setSlider('depth-base-slider', 'baseDepth', 'depth-base-val');
    setSlider('depth-near-slider', 'nearClip', 'depth-near-val');
    setSlider('depth-far-slider', 'farClip', 'depth-far-val');
    setSlider('depth-contrast-slider', 'contrast', 'depth-contrast-val');
    setSlider('depth-offset-slider', 'offset', 'depth-offset-val');
    setSlider('depth-obj-slider', 'objectDepth', 'depth-obj-val');
    setSlider('depth-smooth-slider', 'smoothRadius', 'depth-smooth-val', v => `${v}px`);

    const typeSelect = this.container.querySelector('#depth-gradient-type');
    if (typeSelect) typeSelect.value = n.getKnobValue('gradientType') || 'ground_plane';
  }
}

