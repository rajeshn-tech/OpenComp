/**
 * OpenComp - Keyer UI & Interactive Keying Workspace
 * Professional VFX Chroma Keyer interface with interactive screen color sampling,
 * region box averaging, matte view modes, edge controls, despill suppression,
 * and A/B plate comparison.
 */

export class KeyerUI {
  constructor(containerElement, viewerUI, onKeyerUpdate) {
    this.container = containerElement;
    this.viewerUI = viewerUI;
    this.onKeyerUpdate = onKeyerUpdate;

    this.activeKeyerNode = null;
    this.sampleMode = 'none'; // 'none', 'eyedropper', 'box'
    this.isSamplingBox = false;
    this.boxStart = null;
    this.boxEnd = null;
    this.lastCursor = null;

    // Sampled color
    this.sampledColor = { r: 0.05, g: 0.85, b: 0.05, a: 1.0 };
    this.sampledHex = '#0dd90d';

    // A/B Comparison state
    this.isComparing = false;
    this.savedViewerState = null;

    this.render();
  }

  setKeyerNode(node) {
    this.activeKeyerNode = node;
    this.syncFromNode();
    this.render();
  }

  syncFromNode() {
    if (!this.activeKeyerNode) return;
    const n = this.activeKeyerNode;

    // Read screen color if present
    if (n.knobs['screenColorR'] !== undefined) {
      const r = Number(n.getKnobValue('screenColorR')) ?? 0.05;
      const g = Number(n.getKnobValue('screenColorG')) ?? 0.85;
      const b = Number(n.getKnobValue('screenColorB')) ?? 0.05;
      this.sampledColor = { r, g, b, a: 1.0 };
      const dR = Math.min(255, Math.max(0, Math.round(r * 255)));
      const dG = Math.min(255, Math.max(0, Math.round(g * 255)));
      const dB = Math.min(255, Math.max(0, Math.round(b * 255)));
      this.sampledHex = `#${((1 << 24) + (dR << 16) + (dG << 8) + dB).toString(16).slice(1)}`;
    }
  }

  render() {
    if (!this.container) return;

    const n = this.activeKeyerNode;
    const isChromaKeyer = n && (n.type === 'ChromaKeyer');
    const isGenericKeyer = n && (n.type === 'Keyer');
    const isDespill = n && (n.type === 'Despill');
    const isMatteControl = n && (n.type === 'MatteControl');

    const curOutputMode = n ? (n.getKnobValue('output') || n.getKnobValue('outputMode') || 'composite') : 'composite';
    const screenType = n ? (n.getKnobValue('screenType') || n.getKnobValue('keyType') || 'green') : 'green';

    const tol = n ? (Number(n.getKnobValue('tolerance')) ?? 0.35) : 0.35;
    const soft = n ? (Number(n.getKnobValue('softness')) ?? 0.15) : 0.15;
    const clipBlack = n ? (Number(n.getKnobValue('clipBlack') ?? n.getKnobValue('blackPoint')) ?? 0.02) : 0.02;
    const clipWhite = n ? (Number(n.getKnobValue('clipWhite') ?? n.getKnobValue('whitePoint')) ?? 0.98) : 0.98;
    const despillStrength = n ? (Number(n.getKnobValue('despill') ?? n.getKnobValue('spillStrength')) ?? 1.0) : 1.0;
    const erode = n ? (Number(n.getKnobValue('erode')) ?? 0.0) : 0.0;
    const blur = n ? (Number(n.getKnobValue('blur')) ?? 0.0) : 0.0;

    this.container.innerHTML = `
      <div class="keyer-workspace-panel" style="font-size:12px; color:#e2e8f0; display:flex; flex-direction:column; gap:8px;">
        
        <!-- Disclaimer / Notice Banner -->
        <div class="keyer-algorithm-notice" style="background:#2d2105; border:1px solid #d97706; border-radius:4px; padding:6px 8px; font-size:11px; color:#fbbf24; line-height:1.4;">
          <strong>⚠️ Notice:</strong> OpenComp utilizes differential chromatic distance and edge despill algorithms.
          Automated IBK color-model extraction (IBKColour/IBKGizmo) and Primatte polyhedral color-slicing are not yet implemented in this release.
        </div>

        <!-- Header & Matte View Modes -->
        <div style="background:#1e1e1e; border:1px solid #333; border-radius:4px; padding:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:bold; color:#ff922b;">👁 Matte Visualization Mode:</span>
            <button id="keyer-btn-compare-ab" class="btn-tool ${this.isComparing ? 'active' : ''}" style="font-size:10px;" title="Compare A/B Wipe (Input Plate vs Keyed Output)">
              ${this.isComparing ? '◀▶ Wipe A/B Active' : '⚖ Compare A/B'}
            </button>
          </div>
          <div class="keyer-view-modes" style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:4px;">
            <button class="btn-tool keyer-view-btn ${curOutputMode === 'composite' ? 'active' : ''}" data-mode="composite" title="Premultiplied Composite RGBA">Composite</button>
            <button class="btn-tool keyer-view-btn ${curOutputMode === 'matte' ? 'active' : ''}" data-mode="matte" title="Matte Grayscale (Alpha in RGB)">Matte</button>
            <button class="btn-tool keyer-view-btn ${curOutputMode === 'status' ? 'active' : ''}" data-mode="status" title="Diagnostic Status View (Black=BG, White=Core, Red=Edge)">Status</button>
            <button class="btn-tool keyer-view-btn ${curOutputMode === 'unpremult' || curOutputMode === 'despill' ? 'active' : ''}" data-mode="${isChromaKeyer ? 'unpremult' : 'despill'}" title="Despilled RGB plate">Despilled</button>
          </div>
        </div>

        <!-- Interactive Screen Color Sampling Section -->
        <div style="background:#1e1e1e; border:1px solid #333; border-radius:4px; padding:8px;">
          <div style="font-weight:bold; color:#ff922b; margin-bottom:6px;">🎨 Screen Color Sampling:</div>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <!-- Live Color Swatch -->
            <div id="keyer-color-swatch" style="width:36px; height:36px; border-radius:4px; border:1px solid #555; background:${this.sampledHex}; flex-shrink:0; box-shadow:inset 0 0 4px rgba(0,0,0,0.5);" title="Sampled Screen Color"></div>
            <div style="display:flex; flex-direction:column; gap:2px; flex-grow:1;">
              <div style="font-family:monospace; font-size:11px; color:#8ce99a;" id="keyer-color-readout">
                R: ${this.sampledColor.r.toFixed(3)} G: ${this.sampledColor.g.toFixed(3)} B: ${this.sampledColor.b.toFixed(3)}
              </div>
              <div style="font-size:10px; color:#aaa;" id="keyer-hex-readout">HEX: ${this.sampledHex.toUpperCase()}</div>
            </div>
          </div>
          <div style="display:flex; gap:6px;">
            <button id="keyer-btn-sample-eyedropper" class="btn-tool ${this.sampleMode === 'eyedropper' ? 'active' : ''}" style="flex:1;" title="Sample single pixel in Viewer">
              🎯 Eyedropper
            </button>
            <button id="keyer-btn-sample-box" class="btn-tool ${this.sampleMode === 'box' ? 'active' : ''}" style="flex:1;" title="Drag box in Viewer to average color (or Ctrl+Drag)">
              ⧉ Box Sample
            </button>
          </div>
        </div>

        <!-- Matte & Edge Tuning Controls -->
        <div style="background:#1e1e1e; border:1px solid #333; border-radius:4px; padding:8px;">
          <div style="font-weight:bold; color:#ff922b; margin-bottom:6px;">📐 Matte &amp; Edge Extraction:</div>
          
          <div class="prop-knob-row">
            <span>Tolerance:</span>
            <input type="range" id="keyer-tol-slider" min="0.01" max="1.0" step="0.01" value="${tol}" />
            <input type="number" id="keyer-tol-num" class="paint-num-input" min="0.01" max="1.0" step="0.01" value="${tol.toFixed(2)}" />
          </div>

          <div class="prop-knob-row">
            <span>Softness:</span>
            <input type="range" id="keyer-soft-slider" min="0.0" max="0.8" step="0.01" value="${soft}" />
            <input type="number" id="keyer-soft-num" class="paint-num-input" min="0.0" max="0.8" step="0.01" value="${soft.toFixed(2)}" />
          </div>

          <div class="prop-knob-row">
            <span>Clip Black:</span>
            <input type="range" id="keyer-cb-slider" min="0.0" max="0.5" step="0.01" value="${clipBlack}" />
            <input type="number" id="keyer-cb-num" class="paint-num-input" min="0.0" max="0.5" step="0.01" value="${clipBlack.toFixed(2)}" />
          </div>

          <div class="prop-knob-row">
            <span>Clip White:</span>
            <input type="range" id="keyer-cw-slider" min="0.5" max="1.0" step="0.01" value="${clipWhite}" />
            <input type="number" id="keyer-cw-num" class="paint-num-input" min="0.5" max="1.0" step="0.01" value="${clipWhite.toFixed(2)}" />
          </div>

          <div class="prop-knob-row">
            <span>Erode / Dilate:</span>
            <input type="range" id="keyer-erode-slider" min="-20" max="20" step="0.5" value="${erode}" />
            <input type="number" id="keyer-erode-num" class="paint-num-input" min="-20" max="20" step="0.5" value="${erode.toFixed(1)}" />
          </div>

          <div class="prop-knob-row">
            <span>Edge Blur:</span>
            <input type="range" id="keyer-blur-slider" min="0" max="50" step="0.5" value="${blur}" />
            <input type="number" id="keyer-blur-num" class="paint-num-input" min="0" max="50" step="0.5" value="${blur.toFixed(1)}" />
          </div>
        </div>

        <!-- Spill Suppression Section -->
        <div style="background:#1e1e1e; border:1px solid #333; border-radius:4px; padding:8px;">
          <div style="font-weight:bold; color:#ff922b; margin-bottom:6px;">💧 Despill Suppression:</div>
          
          <div class="prop-knob-row">
            <span>Screen Type:</span>
            <select id="keyer-screen-type-select" class="tool-select">
              <option value="green" ${screenType.includes('green') ? 'selected' : ''}>Green Screen</option>
              <option value="blue" ${screenType.includes('blue') ? 'selected' : ''}>Blue Screen</option>
              <option value="custom" ${screenType === 'custom' ? 'selected' : ''}>Custom Color</option>
            </select>
          </div>

          <div class="prop-knob-row">
            <span>Spill Strength:</span>
            <input type="range" id="keyer-despill-slider" min="0.0" max="2.0" step="0.05" value="${despillStrength}" />
            <input type="number" id="keyer-despill-num" class="paint-num-input" min="0.0" max="2.0" step="0.05" value="${despillStrength.toFixed(2)}" />
          </div>
        </div>

      </div>
    `;

    this.initEventListeners();
  }

  initEventListeners() {
    // Matte View Mode buttons
    const modeBtns = this.container.querySelectorAll('.keyer-view-btn');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        this.setOutputMode(mode);
      });
    });

    // A/B Comparison Toggle button
    this.container.querySelector('#keyer-btn-compare-ab')?.addEventListener('click', () => {
      this.toggleCompareAB();
    });

    // Eyedropper & Box sample buttons
    const btnEye = this.container.querySelector('#keyer-btn-sample-eyedropper');
    const btnBox = this.container.querySelector('#keyer-btn-sample-box');

    btnEye?.addEventListener('click', () => {
      this.sampleMode = (this.sampleMode === 'eyedropper') ? 'none' : 'eyedropper';
      btnEye.classList.toggle('active', this.sampleMode === 'eyedropper');
      if (btnBox) btnBox.classList.remove('active');
      if (this.viewerUI) this.viewerUI.canvas.style.cursor = (this.sampleMode === 'eyedropper') ? 'crosshair' : 'default';
      this.viewerUI?.render();
    });

    btnBox?.addEventListener('click', () => {
      this.sampleMode = (this.sampleMode === 'box') ? 'none' : 'box';
      btnBox.classList.toggle('active', this.sampleMode === 'box');
      if (btnEye) btnEye.classList.remove('active');
      if (this.viewerUI) this.viewerUI.canvas.style.cursor = (this.sampleMode === 'box') ? 'crosshair' : 'default';
      this.viewerUI?.render();
    });

    // Parameter Knobs Wiring
    const wireKnob = (sliderId, numId, knobName, fallbackKnobName = null) => {
      const slider = this.container.querySelector(`#${sliderId}`);
      const num = this.container.querySelector(`#${numId}`);
      const updateVal = (val) => {
        const numVal = parseFloat(val);
        if (slider) slider.value = numVal;
        if (num) num.value = numVal.toFixed(2);
        if (this.activeKeyerNode) {
          if (this.activeKeyerNode.knobs[knobName] !== undefined) {
            this.activeKeyerNode.setKnobValue(knobName, numVal);
          } else if (fallbackKnobName && this.activeKeyerNode.knobs[fallbackKnobName] !== undefined) {
            this.activeKeyerNode.setKnobValue(fallbackKnobName, numVal);
          }
          this.activeKeyerNode.markDirty();
          if (this.onKeyerUpdate) this.onKeyerUpdate(this.activeKeyerNode);
          this.viewerUI?.render();
        }
      };
      slider?.addEventListener('input', (e) => updateVal(e.target.value));
      num?.addEventListener('change', (e) => updateVal(e.target.value));
    };

    wireKnob('keyer-tol-slider', 'keyer-tol-num', 'tolerance');
    wireKnob('keyer-soft-slider', 'keyer-soft-num', 'softness');
    wireKnob('keyer-cb-slider', 'keyer-cb-num', 'clipBlack', 'blackPoint');
    wireKnob('keyer-cw-slider', 'keyer-cw-num', 'clipWhite', 'whitePoint');
    wireKnob('keyer-despill-slider', 'keyer-despill-num', 'despill', 'spillStrength');
    wireKnob('keyer-erode-slider', 'keyer-erode-num', 'erode');
    wireKnob('keyer-blur-slider', 'keyer-blur-num', 'blur');

    // Screen type select
    const screenTypeSelect = this.container.querySelector('#keyer-screen-type-select');
    screenTypeSelect?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!this.activeKeyerNode) return;
      if (this.activeKeyerNode.knobs['screenType'] !== undefined) {
        this.activeKeyerNode.setKnobValue('screenType', val);
      } else if (this.activeKeyerNode.knobs['keyType'] !== undefined) {
        this.activeKeyerNode.setKnobValue('keyType', val === 'blue' ? 'chroma_blue' : 'chroma_green');
      }
      this.activeKeyerNode.markDirty();
      if (this.onKeyerUpdate) this.onKeyerUpdate(this.activeKeyerNode);
      this.viewerUI?.render();
    });
  }

  setOutputMode(mode) {
    if (!this.activeKeyerNode) return;
    if (this.activeKeyerNode.knobs['output'] !== undefined) {
      this.activeKeyerNode.setKnobValue('output', mode);
    } else if (this.activeKeyerNode.knobs['outputMode'] !== undefined) {
      this.activeKeyerNode.setKnobValue('outputMode', mode);
    }
    this.activeKeyerNode.markDirty();
    if (this.onKeyerUpdate) this.onKeyerUpdate(this.activeKeyerNode);
    this.viewerUI?.render();
  }

  setSampledColor(r, g, b, a = 1.0) {
    this.sampledColor = { r, g, b, a };
    const dR = Math.min(255, Math.max(0, Math.round(r * 255)));
    const dG = Math.min(255, Math.max(0, Math.round(g * 255)));
    const dB = Math.min(255, Math.max(0, Math.round(b * 255)));
    this.sampledHex = `#${((1 << 24) + (dR << 16) + (dG << 8) + dB).toString(16).slice(1)}`;

    const swatch = this.container.querySelector('#keyer-color-swatch');
    if (swatch) swatch.style.backgroundColor = this.sampledHex;

    const readout = this.container.querySelector('#keyer-color-readout');
    if (readout) readout.textContent = `R: ${r.toFixed(3)} G: ${g.toFixed(3)} B: ${b.toFixed(3)}`;

    const hexReadout = this.container.querySelector('#keyer-hex-readout');
    if (hexReadout) hexReadout.textContent = `HEX: ${this.sampledHex.toUpperCase()}`;

    // Apply to node
    if (this.activeKeyerNode) {
      if (this.activeKeyerNode.knobs['screenColorR'] !== undefined) {
        this.activeKeyerNode.setKnobValue('screenColorR', r);
        this.activeKeyerNode.setKnobValue('screenColorG', g);
        this.activeKeyerNode.setKnobValue('screenColorB', b);
        this.activeKeyerNode.setKnobValue('screenType', 'custom');
        const stSelect = this.container.querySelector('#keyer-screen-type-select');
        if (stSelect) stSelect.value = 'custom';
      }
      this.activeKeyerNode.markDirty();
      if (this.onKeyerUpdate) this.onKeyerUpdate(this.activeKeyerNode);
      this.viewerUI?.render();
    }
  }

  toggleCompareAB() {
    this.isComparing = !this.isComparing;
    const btn = this.container.querySelector('#keyer-btn-compare-ab');
    if (btn) {
      btn.classList.toggle('active', this.isComparing);
      btn.textContent = this.isComparing ? '◀▶ Wipe A/B Active' : '⚖ Compare A/B';
    }

    if (!this.viewerUI) return;

    if (this.isComparing) {
      // Save current compare mode
      this.savedViewerState = {
        compareMode: this.viewerUI.compareMode || 'single',
        wipePos: this.viewerUI.wipePosition || 0.5
      };
      this.viewerUI.compareMode = 'wipe_h';
      if (this.viewerUI.activeViewerNode) {
        this.viewerUI.activeViewerNode.setKnobValue('compareMode', 'wipe_h');
      }
    } else if (this.savedViewerState) {
      this.viewerUI.compareMode = this.savedViewerState.compareMode;
      if (this.viewerUI.activeViewerNode) {
        this.viewerUI.activeViewerNode.setKnobValue('compareMode', this.savedViewerState.compareMode);
      }
    }
    this.viewerUI.render();
  }

  drawOverlay(ctx, zoom, panX, panY) {
    if (!this.activeKeyerNode) return;

    // Eyedropper Loupe & Floating Readout
    if (this.sampleMode === 'eyedropper' && this.lastCursor) {
      const cx = this.lastCursor.imgX * zoom + panX;
      const cy = this.lastCursor.imgY * zoom + panY;

      ctx.save();
      // Crosshair
      ctx.strokeStyle = '#ff922b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy);
      ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12);
      ctx.stroke();

      // Outer Loupe Ring
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2.0;
      ctx.stroke();

      // Floating readout box
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillRect(cx + 24, cy - 18, 120, 36);
      ctx.strokeStyle = '#ff922b';
      ctx.strokeRect(cx + 24, cy - 18, 120, 36);

      // Swatch pip
      ctx.fillStyle = this.sampledHex;
      ctx.fillRect(cx + 28, cy - 14, 12, 12);
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(cx + 28, cy - 14, 12, 12);

      ctx.font = '10px monospace';
      ctx.fillStyle = '#ff922b';
      ctx.fillText(`Sample Pixel`, cx + 46, cy - 4);
      ctx.fillStyle = '#fff';
      ctx.fillText(`(${Math.round(this.lastCursor.imgX)}, ${Math.round(this.lastCursor.imgY)})`, cx + 28, cy + 12);

      ctx.restore();
    }

    // Region Box Dragging Preview
    if (this.isSamplingBox && this.boxStart && this.boxEnd) {
      const minX = Math.min(this.boxStart.x, this.boxEnd.x);
      const minY = Math.min(this.boxStart.y, this.boxEnd.y);
      const maxX = Math.max(this.boxStart.x, this.boxEnd.x);
      const maxY = Math.max(this.boxStart.y, this.boxEnd.y);

      const sx = minX * zoom + panX;
      const sy = minY * zoom + panY;
      const sw = (maxX - minX) * zoom;
      const sh = (maxY - minY) * zoom;

      ctx.save();
      ctx.fillStyle = 'rgba(255, 146, 43, 0.18)';
      ctx.fillRect(sx, sy, sw, sh);

      ctx.strokeStyle = '#ff922b';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(sx, sy, sw, sh);

      // Box dimensions tag
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(sx, sy - 18, 90, 16);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#ff922b';
      ctx.fillText(`${Math.round(maxX - minX)}x${Math.round(maxY - minY)} px`, sx + 4, sy - 6);

      ctx.restore();
    }
  }

  onMouseDown(e, imgX, imgY) {
    if (!this.activeKeyerNode) return false;

    // Box sampling initiated via Box tool or Ctrl+Click
    if (this.sampleMode === 'box' || e.ctrlKey) {
      this.isSamplingBox = true;
      this.boxStart = { x: imgX, y: imgY };
      this.boxEnd = { x: imgX, y: imgY };
      return true;
    }

    // Eyedropper sampling
    if (this.sampleMode === 'eyedropper') {
      this.samplePoint(imgX, imgY);
      if (!e.shiftKey) {
        this.sampleMode = 'none';
        const btnEye = this.container.querySelector('#keyer-btn-sample-eyedropper');
        if (btnEye) btnEye.classList.remove('active');
        if (this.viewerUI) this.viewerUI.canvas.style.cursor = 'default';
      }
      return true;
    }

    return false;
  }

  onMouseMove(e, imgX, imgY) {
    this.lastCursor = { imgX, imgY };

    if (this.isSamplingBox && this.boxStart) {
      this.boxEnd = { x: imgX, y: imgY };
      // Real-time preview of box average
      this.sampleBox(this.boxStart.x, this.boxStart.y, this.boxEnd.x, this.boxEnd.y, false);
      this.viewerUI?.render();
      return;
    }

    if (this.sampleMode === 'eyedropper') {
      this.viewerUI?.render();
    }
  }

  onMouseUp(e, imgX, imgY) {
    if (this.isSamplingBox && this.boxStart) {
      this.boxEnd = { x: imgX, y: imgY };
      this.sampleBox(this.boxStart.x, this.boxStart.y, this.boxEnd.x, this.boxEnd.y, true);
      this.isSamplingBox = false;
      this.boxStart = null;
      this.boxEnd = null;
      this.sampleMode = 'none';

      const btnBox = this.container.querySelector('#keyer-btn-sample-box');
      if (btnBox) btnBox.classList.remove('active');
      if (this.viewerUI) this.viewerUI.canvas.style.cursor = 'default';
      this.viewerUI?.render();
      return true;
    }
    return false;
  }

  onKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
      return false;
    }

    // View mode shortcuts: 1=Composite, 2=Matte, 3=Status, 4=Despilled
    if (e.key === 'F1') {
      this.setOutputMode('composite');
      return true;
    }
    if (e.key === 'F2') {
      this.setOutputMode('matte');
      return true;
    }
    if (e.key === 'F3') {
      this.setOutputMode('status');
      return true;
    }
    if (e.key === 'F4') {
      this.setOutputMode('despill');
      return true;
    }

    return false;
  }

  samplePoint(imgX, imgY) {
    const ix = Math.round(imgX);
    const iy = Math.round(imgY);

    if (this.viewerUI && typeof this.viewerUI.samplePixel === 'function') {
      const sp = this.viewerUI.samplePixel(ix, iy);
      if (sp && sp.linear) {
        this.setSampledColor(sp.linear.r, sp.linear.g, sp.linear.b, sp.linear.a);
        return;
      }
    }

    // Fallback: sample directly from active node's input buffer
    const inBuf = this.activeKeyerNode?.inputs?.['in']?.getOutputBuffer?.() || this.viewerUI?.currentBuffer;
    if (inBuf && ix >= 0 && ix < inBuf.width && iy >= 0 && iy < inBuf.height) {
      const [r, g, b, a] = inBuf.getPixel(ix, iy);
      this.setSampledColor(r, g, b, a);
    }
  }

  sampleBox(x0, y0, x1, y1, commit = true) {
    const minX = Math.max(0, Math.round(Math.min(x0, x1)));
    const minY = Math.max(0, Math.round(Math.min(y0, y1)));
    const buf = this.viewerUI?.currentBuffer || this.activeKeyerNode?.inputs?.['in']?.getOutputBuffer?.();
    if (!buf) return;

    const maxX = Math.min(buf.width - 1, Math.round(Math.max(x0, x1)));
    const maxY = Math.min(buf.height - 1, Math.round(Math.max(y0, y1)));

    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const [r, g, b] = buf.getPixel(x, y);
        sumR += r;
        sumG += g;
        sumB += b;
        count++;
      }
    }

    if (count > 0) {
      const avgR = sumR / count;
      const avgG = sumG / count;
      const avgB = sumB / count;
      if (commit) {
        this.setSampledColor(avgR, avgG, avgB, 1.0);
      } else {
        // Just update preview labels
        const readout = this.container.querySelector('#keyer-color-readout');
        if (readout) readout.textContent = `Avg: R:${avgR.toFixed(3)} G:${avgG.toFixed(3)} B:${avgB.toFixed(3)}`;
      }
    }
  }
}

