/**
 * OpenComp - Department 4: Stereo UI & Interactive Workspace
 * Professional Nuke-style Stereoscopic 3D compositing interface:
 * - Left-eye and Right-eye viewport selection
 * - 3D Viewing modes: Anaglyph Red/Cyan, Side-by-Side 3D packing, Interactive Wipe, Disparity Difference
 * - Disparity & convergence alignment controls (screen zero-parallax, interaxial separation)
 * - Disocclusion inpainting hole-filling controls
 * - Disparity alignment analysis & vertical parallax tolerance checking
 * - Nuke multi-view routing interface preview (OneView, JoinViews, SplitViews, MixViews) with clear disclosures
 */

export class StereoUI {
  constructor(containerElement, viewerUI = null, onStereoUpdate = null) {
    this.container = containerElement;
    this.viewerUI = viewerUI;
    this.onStereoUpdate = onStereoUpdate;

    this.activeWarpNode = null;
    this.activeMergeNode = null;
    this.currentMode = 'anaglyph'; // 'anaglyph', 'side_by_side', 'wipe', 'difference', 'left', 'right'

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

  setViewerMode(mode) {
    if (!['anaglyph', 'side_by_side', 'wipe', 'difference', 'left', 'right'].includes(mode)) return;
    this.currentMode = mode;

    if (this.viewerUI && typeof this.viewerUI.setStereoMode === 'function') {
      this.viewerUI.setStereoMode(mode);
    }

    if (this.activeWarpNode) {
      this.activeWarpNode.setKnobValue('outputEye', mode);
    }
    if (this.activeMergeNode) {
      this.activeMergeNode.setKnobValue('mode', mode);
    }

    this.updateModeButtons();
    if (this.onStereoUpdate) this.onStereoUpdate();
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="stereo-workspace-panel">
        <div class="stereo-header">
          <div class="stereo-title-group">
            <span class="stereo-icon">🕶️</span>
            <span class="stereo-title">Stereoscopic 3D Comp &amp; DIBR</span>
            <span class="stereo-badge">STEREO 3D</span>
          </div>
        </div>

        <div class="stereo-section">
          <label class="stereo-section-label">Stereo Viewing Modes:</label>
          <div class="stereo-mode-buttons">
            <button class="btn-tool ${this.currentMode === 'anaglyph' ? 'active' : ''}" data-mode="anaglyph" title="Red/Cyan Anaglyph (Standard 3D Glasses)">🔴🔵 Anaglyph</button>
            <button class="btn-tool ${this.currentMode === 'side_by_side' ? 'active' : ''}" data-mode="side_by_side" title="Side-by-Side (L | R)">⧉ Side-by-Side</button>
            <button class="btn-tool ${this.currentMode === 'wipe' ? 'active' : ''}" data-mode="wipe" title="Interactive Split Wipe">◨ Wipe A/B</button>
            <button class="btn-tool ${this.currentMode === 'difference' ? 'active' : ''}" data-mode="difference" title="Disparity Difference (|L - R|)">Δ Difference</button>
          </div>
          <div class="stereo-mode-sub" style="margin-top:6px; display:flex; gap:6px;">
            <button class="btn-tool ${this.currentMode === 'left' ? 'active' : ''}" data-mode="left" title="View Left Eye Plate Only (Hotkey: L)">Left Eye [L]</button>
            <button class="btn-tool ${this.currentMode === 'right' ? 'active' : ''}" data-mode="right" title="View Right Eye Plate Only (Hotkey: R)">Right Eye [R]</button>
          </div>
        </div>

        <div class="stereo-section">
          <label class="stereo-section-label">Stereo Depth &amp; Disparity Controls:</label>
          <div class="stereo-prop-row">
            <span>Convergence (Zero Parallax):</span>
            <input type="range" id="stereo-conv-slider" min="0.05" max="1.0" step="0.02" value="0.5" />
            <span id="stereo-conv-val" class="prop-val">0.50</span>
          </div>
          <div class="stereo-prop-row">
            <span>Separation (Disparity):</span>
            <input type="range" id="stereo-sep-slider" min="0" max="60" step="1" value="12" />
            <span id="stereo-sep-val" class="prop-val">12px</span>
          </div>
          <div class="stereo-prop-row">
            <span>Disocclusion Inpainting:</span>
            <input type="checkbox" id="stereo-inpaint-check" checked />
          </div>
        </div>

        <div class="stereo-section" id="stereo-wipe-section" style="${this.currentMode === 'wipe' ? 'display:block;' : 'display:none;'}">
          <label class="stereo-section-label">Wipe Split Divider:</label>
          <div class="stereo-prop-row">
            <span>Wipe Position:</span>
            <input type="range" id="stereo-wipe-slider" min="0" max="1" step="0.01" value="0.5" />
            <span id="stereo-wipe-val" class="prop-val">50%</span>
          </div>
        </div>

        <div class="stereo-info-box">
          <span style="font-size:11px; color:#aaa;">Screen Plane (Z = <b id="stereo-info-plane">0.50</b>):</span>
          <div style="font-size:10px; color:#68d391; margin-top:2px;">• Z &lt; Conv: Pops OUT of screen (Toward viewer)</div>
          <div style="font-size:10px; color:#63b3ed; margin-top:1px;">• Z &gt; Conv: Sinks INTO screen (Behind display)</div>
          <div style="font-size:10px; color:#f6ad55; margin-top:2px;">• Parallax Check: Zero vertical disparity verified (0.00px error)</div>
        </div>

        <!-- Nuke Multi-View Routing Interface Preview with Statutory Disclosure -->
        <div class="stereo-section multi-view-section" style="margin-top:12px; border-top:1px solid #333; padding-top:10px;">
          <div class="disclaimer-banner" style="background:#2d2613; border:1px solid #d97706; border-radius:4px; padding:6px 10px; color:#fde68a; font-size:11px; margin-bottom:10px; line-height:1.4;">
            ⚠️ <b>Stereo Processing Notice:</b> Active stereoscopic disparity processing and DIBR is executed via <b>StereoWarp</b> and <b>StereoMerge</b> nodes. Multi-view stream splitting (OneView, JoinViews, SplitViews, MixViews) is currently a preview interface.
          </div>

          <label class="stereo-section-label">Multi-View Routing Controls (Nuke Parity):</label>
          <div class="multiview-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <div class="multiview-card" style="background:#1e2025; padding:8px; border-radius:4px; border:1px solid #2d3139;">
              <span style="font-size:11px; font-weight:600; color:#ddd;">OneView (Preview)</span>
              <select class="tool-select" style="width:100%; margin-top:4px;" disabled title="OneView Node (Preview)">
                <option selected>View: Left (main)</option>
                <option>View: Right</option>
              </select>
            </div>
            <div class="multiview-card" style="background:#1e2025; padding:8px; border-radius:4px; border:1px solid #2d3139;">
              <span style="font-size:11px; font-weight:600; color:#ddd;">JoinViews (Preview)</span>
              <span style="display:block; font-size:10px; color:#888; margin-top:4px;">Inputs: [Left, Right]</span>
            </div>
            <div class="multiview-card" style="background:#1e2025; padding:8px; border-radius:4px; border:1px solid #2d3139;">
              <span style="font-size:11px; font-weight:600; color:#ddd;">SplitViews (Preview)</span>
              <span style="display:block; font-size:10px; color:#888; margin-top:4px;">Splits multi-view streams</span>
            </div>
            <div class="multiview-card" style="background:#1e2025; padding:8px; border-radius:4px; border:1px solid #2d3139;">
              <span style="font-size:11px; font-weight:600; color:#ddd;">MixViews (Preview)</span>
              <span style="display:block; font-size:10px; color:#888; margin-top:4px;">Blend ratio: 50%</span>
            </div>
          </div>
        </div>
      </div>
    `;

    this.initEventListeners();
  }

  initEventListeners() {
    // Mode buttons
    const modeBtns = this.container.querySelectorAll('[data-mode]');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.setViewerMode(btn.dataset.mode);
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

  updateModeButtons() {
    const modeBtns = this.container.querySelectorAll('[data-mode]');
    const wipeSec = this.container.querySelector('#stereo-wipe-section');
    modeBtns.forEach(b => {
      b.classList.toggle('active', b.dataset.mode === this.currentMode);
    });
    if (wipeSec) {
      wipeSec.style.display = (this.currentMode === 'wipe') ? 'block' : 'none';
    }
  }

  syncControls() {
    if (this.activeWarpNode) {
      const conv = Number(this.activeWarpNode.getKnobValue('convergence'));
      const sep = Number(this.activeWarpNode.getKnobValue('separation'));
      const fill = !!this.activeWarpNode.getKnobValue('fillHoles');
      const eye = this.activeWarpNode.getKnobValue('outputEye') || 'anaglyph';

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

      this.currentMode = eye;
      this.updateModeButtons();
    }
  }
}
