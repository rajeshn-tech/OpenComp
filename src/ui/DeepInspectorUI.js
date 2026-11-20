/**
 * OpenComp - Deep Compositing Interface & Sample Inspector (DeepInspectorUI)
 * Professional Nuke-style Deep sample inspection and visualization engine:
 * - Constant-time O(1) per-pixel sample lookup from authentic DeepPixelBuffer
 * - 1D optical depth ray cross-section visualizer (zFront, zBack, volumetric thickness, transmittance T)
 * - Deep sample data table with color swatches, opacity, cumulative transmittance, and contribution
 * - Sample density heatmap and primary depth visualization modes
 * - Real-time pixel picking, coordinate navigation, and pinned sample monitoring
 * - Authentic Deep EXR metadata and buffer summary
 */

export class DeepInspectorUI {
  /**
   * @param {HTMLElement} containerElement DOM container (e.g. #deepinspector-wrapper)
   * @param {Object} viewerUI Active ViewerUI instance
   * @param {Object} [options={}]
   */
  constructor(containerElement, viewerUI = null, options = {}) {
    this.container = containerElement;
    this.viewerUI = viewerUI;
    this.activeDeepBuffer = null;

    this.inspectX = 0;
    this.inspectY = 0;
    this.isPinned = false;
    this.selectedSampleIdx = -1;
    this.displayMode = 'flatten'; // 'flatten' | 'depth' | 'heatmap'

    this.onModeChange = options.onModeChange || null;

    if (this.viewerUI) {
      this.viewerUI.onDeepSampleInspect = (x, y, samples, deepBuf) => {
        if (!this.isPinned) {
          this.setDeepBuffer(deepBuf, false);
          this.inspectPixel(x, y, false);
        }
      };
    }

    this.render();
  }

  setDeepBuffer(deepBuffer, triggerRender = true) {
    if (this.activeDeepBuffer === deepBuffer) return;
    this.activeDeepBuffer = deepBuffer;
    if (this.activeDeepBuffer) {
      if (this.inspectX >= this.activeDeepBuffer.width) this.inspectX = Math.floor(this.activeDeepBuffer.width / 2);
      if (this.inspectY >= this.activeDeepBuffer.height) this.inspectY = Math.floor(this.activeDeepBuffer.height / 2);
    }
    if (triggerRender) {
      this.render();
    }
  }

  inspectPixel(x, y, pin = false) {
    this.inspectX = Math.max(0, Math.floor(x));
    this.inspectY = Math.max(0, Math.floor(y));
    if (pin) this.isPinned = true;
    this.updateInspectorContent();
  }

  selectPixel(x, y) {
    this.inspectPixel(x, y, true);
  }

  setDisplayMode(mode) {
    if (!['flatten', 'depth', 'heatmap'].includes(mode)) return;
    this.displayMode = mode;
    if (this.viewerUI) {
      this.viewerUI.deepDisplayMode = mode;
      this.viewerUI.render();
    }
    if (this.onModeChange) this.onModeChange(mode);
    this.updateModeButtons();
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="deep-inspector-panel">
        <div class="deep-inspector-header">
          <div class="deep-title-group">
            <span class="deep-icon">🌊</span>
            <span class="deep-title">Deep Sample Inspector</span>
            <span class="deep-badge" id="deep-status-badge">DEEP BUFFER</span>
          </div>

          <div class="deep-toolbar-controls">
            <div class="deep-coord-picker">
              <label>Pixel X:</label>
              <input type="number" id="deep-coord-x" value="${this.inspectX}" min="0" />
              <label>Y:</label>
              <input type="number" id="deep-coord-y" value="${this.inspectY}" min="0" />
              <button class="btn-tool ${this.isPinned ? 'active' : ''}" id="btn-deep-pin" title="Pin sample inspection to coordinates">📌 Pin</button>
            </div>

            <div class="deep-mode-group">
              <button class="btn-tool ${this.displayMode === 'flatten' ? 'active' : ''}" data-deep-mode="flatten" title="Standard 2D Flattened Volumetric Preview">🖼️ 2D Preview</button>
              <button class="btn-tool ${this.displayMode === 'depth' ? 'active' : ''}" data-deep-mode="depth" title="Primary Depth Grayscale Map">📏 Depth</button>
              <button class="btn-tool ${this.displayMode === 'heatmap' ? 'active' : ''}" data-deep-mode="heatmap" title="Sample Density False-Color Heatmap">🔥 Heatmap</button>
            </div>
          </div>
        </div>

        <div class="deep-stats-bar" id="deep-stats-bar">
          <span class="stat-item">Buffer: <b>No Deep Buffer Loaded</b></span>
        </div>

        <div class="deep-inspector-body">
          <!-- 1D Optical Depth Ray Visualizer -->
          <div class="deep-section">
            <div class="deep-section-header">
              <span>Ray Optical Depth Profile (Pixel <b id="deep-ray-coords">[${this.inspectX}, ${this.inspectY}]</b>)</span>
              <span class="deep-sample-count-badge" id="deep-sample-count-badge" data-id="deep-sample-count">0 Samples</span>
            </div>
            <div class="deep-ray-canvas-wrapper">
              <canvas id="deep-ray-canvas" width="700" height="110"></canvas>
            </div>
          </div>

          <!-- Deep Samples Data Table -->
          <div class="deep-section deep-table-section">
            <div class="deep-section-header">
              <span>Sample Attribute Table</span>
              <div class="deep-table-actions">
                <button class="btn-tool-sm" id="btn-copy-samples" title="Copy sample data as JSON">📋 Copy JSON</button>
              </div>
            </div>
            <div class="deep-table-wrapper" id="deep-table-container">
              <table class="deep-sample-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Z Front</th>
                    <th>Z Back</th>
                    <th>ΔZ</th>
                    <th>Color</th>
                    <th>R</th>
                    <th>G</th>
                    <th>B</th>
                    <th>Alpha</th>
                    <th>Transmittance (T)</th>
                    <th>Contribution</th>
                  </tr>
                </thead>
                <tbody id="deep-sample-rows">
                  <tr><td colspan="11" class="empty-state">No Deep samples selected. Hover or click on the Viewer to inspect.</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Deep Buffer Summary & Metadata -->
          <div class="deep-section deep-meta-section">
            <div class="deep-section-header">
              <span>Deep EXR Buffer Summary</span>
            </div>
            <div class="deep-summary-grid" id="deep-summary-grid">
              <div class="summary-cell">Dimensions: <b id="meta-res">-</b></div>
              <div class="summary-cell">Total Samples: <b id="meta-total-samples">-</b></div>
              <div class="summary-cell">Max Samples/Px: <b id="meta-max-samples">-</b></div>
              <div class="summary-cell">Channels: <b id="meta-channels">Z, ZBack, R, G, B, A</b></div>
              <div class="summary-cell">Bounding Box: <b id="meta-bbox">-</b></div>
              <div class="summary-cell">Storage: <b id="meta-storage">Float32 Contiguous</b></div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.initEventListeners();
    this.updateInspectorContent();
  }

  initEventListeners() {
    const coordX = this.container.querySelector('#deep-coord-x');
    const coordY = this.container.querySelector('#deep-coord-y');
    const pinBtn = this.container.querySelector('#btn-deep-pin');

    coordX?.addEventListener('change', (e) => {
      this.inspectX = Math.max(0, parseInt(e.target.value, 10) || 0);
      this.updateInspectorContent();
    });

    coordY?.addEventListener('change', (e) => {
      this.inspectY = Math.max(0, parseInt(e.target.value, 10) || 0);
      this.updateInspectorContent();
    });

    pinBtn?.addEventListener('click', () => {
      this.isPinned = !this.isPinned;
      pinBtn.classList.toggle('active', this.isPinned);
    });

    const modeBtns = this.container.querySelectorAll('[data-deep-mode]');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.setDisplayMode(btn.dataset.deepMode);
      });
    });

    const copyBtn = this.container.querySelector('#btn-copy-samples');
    copyBtn?.addEventListener('click', () => {
      this.copySampleData();
    });
  }

  updateModeButtons() {
    const modeBtns = this.container.querySelectorAll('[data-deep-mode]');
    modeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.deepMode === this.displayMode);
    });
  }

  updateInspectorContent() {
    if (!this.container) return;

    const coordXInput = this.container.querySelector('#deep-coord-x');
    const coordYInput = this.container.querySelector('#deep-coord-y');
    const rayCoords = this.container.querySelector('#deep-ray-coords');
    const countBadge = this.container.querySelector('#deep-sample-count-badge');
    const statsBar = this.container.querySelector('#deep-stats-bar');
    const rowsBody = this.container.querySelector('#deep-sample-rows');

    if (coordXInput && document.activeElement !== coordXInput) coordXInput.value = this.inspectX;
    if (coordYInput && document.activeElement !== coordYInput) coordYInput.value = this.inspectY;
    if (rayCoords) rayCoords.textContent = `[${this.inspectX}, ${this.inspectY}]`;

    if (!this.activeDeepBuffer || typeof this.activeDeepBuffer.getSampleCount !== 'function') {
      const is2D = !!this.activeDeepBuffer;
      if (statsBar) statsBar.innerHTML = `<span class="stat-item">Buffer: <b>${is2D ? '2D Standard Image (Planar)' : 'No Deep Buffer Loaded'}</b> (Connect a DeepRead, DeepMerge, or DeepFromImage node)</span>`;
      if (countBadge) {
        countBadge.textContent = '0 Samples';
        countBadge.className = 'deep-sample-count-badge no-samples';
      }
      if (rowsBody) rowsBody.innerHTML = `<tr><td colspan="11" class="empty-state">${is2D ? 'Active image is 2D planar data. Connect a Deep compositing node to inspect volumetric samples.' : 'No Deep buffer available.'}</td></tr>`;
      this.drawDepthRay([]);
      this.updateMetadataSummary(null);
      return;
    }

    const buf = this.activeDeepBuffer;
    const count = buf.getSampleCount(this.inspectX, this.inspectY);
    const samples = buf.getSamples(this.inspectX, this.inspectY);

    if (countBadge) {
      countBadge.textContent = `${count} Sample${count === 1 ? '' : 's'}`;
      countBadge.className = `deep-sample-count-badge ${count > 0 ? 'has-samples' : 'no-samples'}`;
    }

    const avgSamples = buf.totalPixels > 0 ? (buf.totalSamples / buf.totalPixels).toFixed(2) : 0;
    if (statsBar) {
      statsBar.innerHTML = `
        <span class="stat-item">Format: <b>${buf.width}x${buf.height}</b></span>
        <span class="stat-divider">|</span>
        <span class="stat-item">Total Samples: <b>${buf.totalSamples.toLocaleString()}</b></span>
        <span class="stat-divider">|</span>
        <span class="stat-item">Avg: <b>${avgSamples} spl/px</b></span>
        <span class="stat-divider">|</span>
        <span class="stat-item">Pixel [${this.inspectX}, ${this.inspectY}]: <b>${count} Samples</b></span>
      `;
    }

    // Populate Samples Table
    if (rowsBody) {
      if (count === 0) {
        rowsBody.innerHTML = `<tr><td colspan="11" class="empty-state">No deep samples at pixel [${this.inspectX}, ${this.inspectY}] (Empty background ray).</td></tr>`;
      } else {
        let html = '';
        let T = 1.0;
        for (let i = 0; i < samples.length; i++) {
          const s = samples[i];
          const deltaZ = (s.zBack - s.zFront).toFixed(3);
          const rDisp = s.r.toFixed(3);
          const gDisp = s.g.toFixed(3);
          const bDisp = s.b.toFixed(3);
          const aDisp = s.a.toFixed(3);
          const tDisp = T.toFixed(3);

          const contribR = (s.r * T).toFixed(3);
          const contribG = (s.g * T).toFixed(3);
          const contribB = (s.b * T).toFixed(3);

          const rByte = Math.min(255, Math.max(0, Math.round(s.r * 255)));
          const gByte = Math.min(255, Math.max(0, Math.round(s.g * 255)));
          const bByte = Math.min(255, Math.max(0, Math.round(s.b * 255)));
          const swatchBg = `rgb(${rByte},${gByte},${bByte})`;

          const isSelected = (i === this.selectedSampleIdx);

          html += `
            <tr class="${isSelected ? 'selected-sample-row' : ''}" data-sample-idx="${i}">
              <td class="col-idx">#${i}</td>
              <td class="col-num font-mono">${s.zFront.toFixed(3)}</td>
              <td class="col-num font-mono">${s.zBack.toFixed(3)}</td>
              <td class="col-num font-mono">${deltaZ}</td>
              <td class="col-swatch">
                <span class="sample-swatch" style="background:${swatchBg}; opacity:${Math.max(0.2, s.a)};"></span>
              </td>
              <td class="col-num font-mono" style="color:#ff6b6b">${rDisp}</td>
              <td class="col-num font-mono" style="color:#51cf66">${gDisp}</td>
              <td class="col-num font-mono" style="color:#339af0">${bDisp}</td>
              <td class="col-num font-mono" style="color:#ced4da">${aDisp}</td>
              <td class="col-num font-mono" style="color:#f59e0b">${tDisp}</td>
              <td class="col-num font-mono" style="color:#a78bfa">(${contribR}, ${contribG}, ${contribB})</td>
            </tr>
          `;

          T *= (1.0 - Math.max(0, Math.min(1, s.a)));
        }
        rowsBody.innerHTML = html;

        // Wire row clicks for sample selection
        const rows = rowsBody.querySelectorAll('tr[data-sample-idx]');
        rows.forEach(r => {
          r.addEventListener('click', () => {
            const idx = parseInt(r.dataset.sampleIdx, 10);
            this.selectedSampleIdx = (this.selectedSampleIdx === idx) ? -1 : idx;
            this.updateInspectorContent();
          });
        });
      }
    }

    this.drawDepthRay(samples);
    this.updateMetadataSummary(buf);
  }

  drawDepthRay(samples) {
    const canvas = this.container?.querySelector('#deep-ray-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // Background
    ctx.fillStyle = '#141416';
    ctx.fillRect(0, 0, W, H);

    // Grid lines along ray
    ctx.strokeStyle = '#23252b';
    ctx.lineWidth = 1;
    for (let x = 50; x < W; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H - 20);
      ctx.stroke();
    }

    // Axis line
    const axisY = H - 24;
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, axisY);
    ctx.lineTo(W - 20, axisY);
    ctx.stroke();

    // Axis ticks & Camera Icon (Apex)
    ctx.fillStyle = '#ff922b';
    ctx.font = '10px monospace';
    ctx.fillText('📷 Apex (Z=0)', 10, axisY + 16);

    if (!samples || samples.length === 0) {
      ctx.fillStyle = '#666';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No samples along this optical ray', W / 2, H / 2 - 10);
      return;
    }

    // Compute min/max depth bounds for scaling
    let minZ = samples[0].zFront;
    let maxZ = samples[samples.length - 1].zBack;
    for (const s of samples) {
      if (s.zFront < minZ) minZ = s.zFront;
      if (s.zBack > maxZ) maxZ = s.zBack;
    }

    const startZ = Math.max(0, minZ * 0.8);
    const endZ = Math.max(10.0, maxZ * 1.15);
    const zRange = endZ - startZ || 1.0;
    const usableW = W - 100;
    const leftPad = 40;

    const zToX = (z) => leftPad + ((z - startZ) / zRange) * usableW;

    // Draw Transmittance Decay Curve in background
    ctx.save();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let curT = 1.0;
    let prevX = zToX(startZ);
    let prevY = 20 + (1.0 - curT) * (axisY - 30);
    ctx.moveTo(prevX, prevY);

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const sx1 = zToX(s.zFront);
      const sx2 = zToX(s.zBack);
      ctx.lineTo(sx1, 20 + (1.0 - curT) * (axisY - 30));
      curT *= (1.0 - Math.max(0, Math.min(1, s.a)));
      ctx.lineTo(sx2, 20 + (1.0 - curT) * (axisY - 30));
    }
    ctx.lineTo(W - 20, 20 + (1.0 - curT) * (axisY - 30));
    ctx.stroke();
    ctx.restore();

    // Render each volumetric sample block
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const x1 = zToX(s.zFront);
      const x2 = Math.max(x1 + 4, zToX(s.zBack));
      const boxW = Math.max(4, x2 - x1);
      const boxH = Math.max(16, s.a * (axisY - 30));
      const boxY = axisY - boxH;

      const rByte = Math.min(255, Math.max(0, Math.round(s.r * 255)));
      const gByte = Math.min(255, Math.max(0, Math.round(s.g * 255)));
      const bByte = Math.min(255, Math.max(0, Math.round(s.b * 255)));
      const isSelected = (i === this.selectedSampleIdx);

      // Block fill
      ctx.fillStyle = `rgba(${rByte}, ${gByte}, ${bByte}, ${Math.max(0.3, s.a * 0.85)})`;
      ctx.fillRect(x1, boxY, boxW, boxH);

      // Border outline
      ctx.strokeStyle = isSelected ? '#ff922b' : `rgb(${rByte}, ${gByte}, ${bByte})`;
      ctx.lineWidth = isSelected ? 2.5 : 1;
      ctx.strokeRect(x1, boxY, boxW, boxH);

      // Top label with index
      ctx.fillStyle = isSelected ? '#ff922b' : '#eee';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`#${i}`, x1 + boxW / 2, boxY - 4);

      // Bottom depth ticks on axis
      ctx.strokeStyle = '#777';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, axisY - 2);
      ctx.lineTo(x1, axisY + 4);
      ctx.stroke();

      ctx.fillStyle = '#888';
      ctx.font = '8px monospace';
      ctx.fillText(`${s.zFront.toFixed(1)}`, x1, axisY + 14);
    }

    // Legend tag
    ctx.fillStyle = '#f59e0b';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Transmittance T(z)', W - 15, 14);
  }

  updateMetadataSummary(buf) {
    const resEl = this.container?.querySelector('#meta-res');
    const totEl = this.container?.querySelector('#meta-total-samples');
    const maxEl = this.container?.querySelector('#meta-max-samples');
    const bboxEl = this.container?.querySelector('#meta-bbox');

    if (!buf) {
      if (resEl) resEl.textContent = '-';
      if (totEl) totEl.textContent = '-';
      if (maxEl) maxEl.textContent = '-';
      if (bboxEl) bboxEl.textContent = '-';
      return;
    }

    if (resEl) resEl.textContent = `${buf.width} x ${buf.height}`;
    if (totEl) totEl.textContent = buf.totalSamples.toLocaleString();

    let maxSpl = 0;
    const offsets = buf.sampleOffsets;
    for (let p = 0; p < buf.totalPixels; p++) {
      const c = offsets[p + 1] - offsets[p];
      if (c > maxSpl) maxSpl = c;
    }
    if (maxEl) maxEl.textContent = `${maxSpl} samples/px`;

    if (bboxEl && buf.bbox) {
      bboxEl.textContent = `[${buf.bbox.minX}, ${buf.bbox.minY}] to [${buf.bbox.maxX}, ${buf.bbox.maxY}] (${buf.bbox.width}x${buf.bbox.height})`;
    }
  }

  copySampleData() {
    if (!this.activeDeepBuffer) return;
    const samples = this.activeDeepBuffer.getSamples(this.inspectX, this.inspectY);
    const data = {
      pixel: { x: this.inspectX, y: this.inspectY },
      sampleCount: samples.length,
      samples: samples
    };
    const jsonStr = JSON.stringify(data, null, 2);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(jsonStr).then(() => {
        alert('Deep sample data copied to clipboard!');
      }).catch(() => { });
    }
  }
}

