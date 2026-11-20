/**
 * OpenComp - Department 4: Stereo UI & Interactive Workspace
 * Provides professional 3D stereoscopic monitoring: Anaglyph Red/Cyan,
 * Side-by-Side 3D packing, convergence alignment, disparity separation, and interactive wipe.
 */

export class StereoUI {
  constructor(containerElement, viewerUI, onStereoUpdate) {
    this.container = containerElement;
    this.viewerUI = viewerUI;
    this.onStereoUpdate = onStereoUpdate;

    this.activeWarpNode = null;
    this.activeMergeNode = null;
    this.currentMode = 'anaglyph';

    this.render();
  }

  setWarpNode(warpNode) {
    this.activeWarpNode = warpNode;
    this.syncControls();
  }

  setMergeNode(mergeNode) {
    this.activeMergeNode = mergeNode;
    this.syncControls();
  }

  render() {
    this.container.innerHTML = `
      <div class="stereo-workspace-panel">
        <div class="stereo-header">
          <span class="stereo-title">🕶️ Stereoscopic 3D Comp & DIBR</span>
        </div>

        <div class="stereo-section">
          <label class="stereo-section-label">3D Viewing Modes:</label>
          <div class="stereo-mode-buttons">
            <button class="btn-tool active" data-mode="anaglyph" title="Red/Cyan Anaglyph (Standard 3D Glasses)">🔴🔵 Anaglyph</button>
            <button class="btn-tool" data-mode="side_by_side" title="Side-by-Side (L | R)">⧉ Side-by-Side</button>
            <button class="btn-tool" data-mode="wipe" title="Interactive Split Wipe">◨ Wipe A/B</button>
            <button class="btn-tool" data-mode="difference" title="Disparity Difference (|L - R|)">Δ Difference</button>
          </div>
          <div class="stereo-mode-sub" style="margin-top:6px;">
            <button class="btn-tool" data-mode="left" title="View Left Eye Plate Only">Left Eye [L]</button>
            <button class="btn-tool" data-mode="right" title="View Right Eye Plate Only">Right Eye [R]</button>
          </div>
        </div>

        <div class="stereo-section">
          <label class="stereo-section-label">Stereo Depth & Disparity Controls:</label>
          <div class="stereo-prop-row">
            <span>Convergence (Zero Parallax):</span>
            <input type="range" id="stereo-conv-slider" min="0.05" max="1.0" step="0.02" value="0.5" />
            <span id="stereo-conv-val">0.50</span>
          </div>
          <div class="stereo-prop-row">
            <span>Separation (Disparity):</span>
            <input type="range" id="stereo-sep-slider" min="0" max="60" step="1" value="12" />
            <span id="stereo-sep-val">12px</span>
          </div>
          <div class="stereo-prop-row">
            <span>Disocclusion Inpainting:</span>
            <input type="checkbox" id="stereo-inpaint-check" checked />
          </div>
        </div>

        <div class="stereo-section" id="stereo-wipe-section" style="display:none;">
          <label class="stereo-section-label">Wipe Split Divider:</label>
          <div class="stereo-prop-row">
            <span>Wipe Position:</span>
            <input type="range" id="stereo-wipe-slider" min="0" max="1" step="0.01" value="0.5" />
            <span id="stereo-wipe-val">50%</span>
          </div>
        </div>

        <div class="stereo-info-box">
          <span style="font-size:11px; color:#aaa;">Screen Plane (Z = <b id="stereo-info-plane">0.50</b>):</span>
          <div style="font-size:10px; color:#68d391; margin-top:2px;">• Z &lt; Conv: Pops OUT of screen (Toward viewer)</div>
          <div style="font-size:10px; color:#63b3ed; margin-top:1px;">• Z &gt; Conv: Sinks INTO screen (Behind display)</div>
        </div>
      </div>
    `;

    this.initEventListeners();
  }

  initEventListeners() {
    // Mode buttons
    const modeBtns = this.container.querySelectorAll('.stereo-workspace-panel .btn-tool');
    const wipeSec = this.container.querySelector('#stereo-wipe-section');

    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentMode = btn.dataset.mode;

        if (wipeSec) {
          wipeSec.style.display = (this.currentMode === 'wipe') ? 'block' : 'none';
        }

        if (this.activeWarpNode) {
          this.activeWarpNode.setKnobValue('outputEye', this.currentMode);
        }
        if (this.activeMergeNode) {
          this.activeMergeNode.setKnobValue('mode', this.currentMode);
        }
        if (this.onStereoUpdate) this.onStereoUpdate();
      });
    });

    // Convergence
    const convSlider = this.container.querySelector('#stereo-conv-slider');
    const convVal = this.container.querySelector('#stereo-conv-val');
    const planeVal = this.container.querySelector('#stereo-info-plane');
    convSlider?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (convVal) convVal.textContent = val.toFixed(2);
      if (planeVal) planeVal.textContent = val.toFixed(2);
      if (this.activeWarpNode) {
        this.activeWarpNode.setKnobValue('convergence', val);
        if (this.onStereoUpdate) this.onStereoUpdate();
      }
    });

    // Separation
    const sepSlider = this.container.querySelector('#stereo-sep-slider');
    const sepVal = this.container.querySelector('#stereo-sep-val');
    sepSlider?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (sepVal) sepVal.textContent = `${val}px`;
      if (this.activeWarpNode) {
        this.activeWarpNode.setKnobValue('separation', val);
        if (this.onStereoUpdate) this.onStereoUpdate();
      }
    });

    // Disocclusion Inpainting
    const inpaintCheck = this.container.querySelector('#stereo-inpaint-check');
    inpaintCheck?.addEventListener('change', (e) => {
      if (this.activeWarpNode) {
        this.activeWarpNode.setKnobValue('fillHoles', e.target.checked);
        if (this.onStereoUpdate) this.onStereoUpdate();
      }
    });

    // Wipe Position
    const wipeSlider = this.container.querySelector('#stereo-wipe-slider');
    const wipeVal = this.container.querySelector('#stereo-wipe-val');
    wipeSlider?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (wipeVal) wipeVal.textContent = `${Math.round(val * 100)}%`;
      if (this.activeMergeNode) {
        this.activeMergeNode.setKnobValue('wipePos', val);
        if (this.onStereoUpdate) this.onStereoUpdate();
      }
    });
  }

  syncControls() {
    if (this.activeWarpNode) {
      const conv = Number(this.activeWarpNode.getKnobValue('convergence'));
      const sep = Number(this.activeWarpNode.getKnobValue('separation'));
      const fill = !!this.activeWarpNode.getKnobValue('fillHoles');

      const convSlider = this.container.querySelector('#stereo-conv-slider');
      const convVal = this.container.querySelector('#stereo-conv-val');
      const planeVal = this.container.querySelector('#stereo-info-plane');
      if (convSlider && !isNaN(conv)) convSlider.value = conv;
      if (convVal && !isNaN(conv)) convVal.textContent = conv.toFixed(2);
      if (planeVal && !isNaN(conv)) planeVal.textContent = conv.toFixed(2);

      const sepSlider = this.container.querySelector('#stereo-sep-slider');
      const sepVal = this.container.querySelector('#stereo-sep-val');
      if (sepSlider && !isNaN(sep)) sepSlider.value = sep;
      if (sepVal && !isNaN(sep)) sepVal.textContent = `${sep}px`;

      const inpaintCheck = this.container.querySelector('#stereo-inpaint-check');
      if (inpaintCheck) inpaintCheck.checked = fill;
    }
  }
}

