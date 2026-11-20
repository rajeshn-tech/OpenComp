/**
 * OpenComp - Professional 2D & Planar Tracking Interface
 * Viewer-integrated tracking overlay and control workspace.
 * Supports point feature tracking (pattern area, search area, anchor, trajectory trail),
 * planar surface tracking (4-corner quadrilateral mesh, grid deformation, homography),
 * interactive forward/backward/step tracking transport controls, track data inspector,
 * and direct export to Transform / CornerPin2D nodes.
 *
 * Notice: Synthetic tracking engine verification; production accuracy subject to footage SNR and feature saliency.
 */

export class TrackingUI {
  /**
   * @param {HTMLElement} containerElement
   * @param {Object} viewerUI
   * @param {Function} [onUpdateCallback]
   */
  constructor(containerElement, viewerUI, onUpdateCallback = null) {
    this.container = containerElement;
    this.viewerUI = viewerUI;
    this.onUpdateCallback = onUpdateCallback;

    /** @type {Object|null} TrackerNode or PlanarTrackerNode */
    this.activeNode = null;
    this.isPlanar = false;

    this.currentFrame = 1;
    this.selectedTrackId = null; // Point tracker active track id
    this.selectedCornerIdx = null; // Planar tracker active corner (0..3) or 'center'

    // Interaction state
    this.activeHandle = null; // 'anchor' | 'patternCorner' | 'searchCorner' | 'planarCorner' | 'planarCenter'
    this.isDragging = false;
    this.dragStartPos = { x: 0, y: 0 };
    this.initialCornerPositions = [];
    this.isTracking = false;

    // Display flags
    this.showOverlay = true;
    this.showSearchWindow = true;
    this.showPatternWindow = true;
    this.showTrajectoryTrail = true;
    this.showPlanarGrid = true;

    // Synthetic disclaimer
    this.disclaimer = 'Synthetic tracking engine verification; production accuracy subject to footage SNR and feature saliency.';

    if (this.container) {
      this.render();
    }
  }

  // -------------------------------------------------------------
  // Node Binding & Frame Sync
  // -------------------------------------------------------------

  setTrackerNode(node) {
    this.activeNode = node;
    this.isPlanar = (node && node.type === 'PlanarTracker');

    if (this.isPlanar) {
      this.selectedCornerIdx = null;
    } else if (node && node.tracks && node.tracks.length > 0) {
      this.selectedTrackId = node.tracks[0].id;
    } else {
      this.selectedTrackId = null;
    }

    if (this.viewerUI) {
      this.viewerUI.departmentHandler = this;
      this.viewerUI.render();
    }

    this.render();
  }

  setFrame(frame) {
    this.currentFrame = Math.round(frame) || 1;
    this.updateInspectorTable();
    if (this.viewerUI) {
      this.viewerUI.render();
    }
  }

  // -------------------------------------------------------------
  // Point Tracker Management
  // -------------------------------------------------------------

  getActiveTrack() {
    if (!this.activeNode || this.isPlanar || !this.activeNode.tracks) return null;
    if (this.selectedTrackId) {
      return this.activeNode.tracks.find(t => t.id === this.selectedTrackId) || this.activeNode.tracks[0] || null;
    }
    return this.activeNode.tracks[0] || null;
  }

  addTrack(name = null, x = 960, y = 540) {
    if (!this.activeNode || this.isPlanar) return null;
    const track = this.activeNode.addTrack(name, x, y);
    if (track) {
      this.selectedTrackId = track.id;
      this.notifyUpdate();
      this.render();
    }
    return track;
  }

  removeSelectedTrack() {
    if (!this.activeNode || this.isPlanar || !this.selectedTrackId) return;
    this.activeNode.removeTrack(this.selectedTrackId);
    this.selectedTrackId = this.activeNode.tracks.length > 0 ? this.activeNode.tracks[0].id : null;
    this.notifyUpdate();
    this.render();
  }

  // -------------------------------------------------------------
  // Tracking Transport Controls
  // -------------------------------------------------------------

  async stepTrackForward() {
    if (!this.activeNode || !this.viewerUI) return;
    const nextF = this.currentFrame + 1;
    const buffer = this.viewerUI.currentBuffer;
    if (buffer && typeof this.activeNode.trackStep === 'function') {
      this.activeNode.trackStep(buffer, this.currentFrame, nextF);
    }
    if (this.viewerUI.timelineUI) {
      this.viewerUI.timelineUI.setFrame(nextF);
    } else {
      this.setFrame(nextF);
    }
    this.notifyUpdate();
  }

  async stepTrackBackward() {
    if (!this.activeNode || !this.viewerUI) return;
    const prevF = this.currentFrame - 1;
    if (prevF < 1) return;
    const buffer = this.viewerUI.currentBuffer;
    if (buffer && typeof this.activeNode.trackStep === 'function') {
      this.activeNode.trackStep(buffer, this.currentFrame, prevF);
    }
    if (this.viewerUI.timelineUI) {
      this.viewerUI.timelineUI.setFrame(prevF);
    } else {
      this.setFrame(prevF);
    }
    this.notifyUpdate();
  }

  async trackForward() {
    if (!this.activeNode || !this.viewerUI || this.isTracking) return;
    this.isTracking = true;
    const endF = this.viewerUI.timelineUI ? this.viewerUI.timelineUI.endFrame : 100;

    const stepFn = () => {
      if (!this.isTracking || this.currentFrame >= endF) {
        this.stopTracking();
        return;
      }
      this.stepTrackForward();
      requestAnimationFrame(stepFn);
    };
    stepFn();
  }

  async trackBackward() {
    if (!this.activeNode || !this.viewerUI || this.isTracking) return;
    this.isTracking = true;
    const startF = this.viewerUI.timelineUI ? this.viewerUI.timelineUI.startFrame : 1;

    const stepFn = () => {
      if (!this.isTracking || this.currentFrame <= startF) {
        this.stopTracking();
        return;
      }
      this.stepTrackBackward();
      requestAnimationFrame(stepFn);
    };
    stepFn();
  }

  stopTracking() {
    this.isTracking = false;
    this.notifyUpdate();
  }

  // -------------------------------------------------------------
  // Export Tracking Workflows
  // -------------------------------------------------------------

  exportTransform(mode = 'matchmove') {
    if (!this.activeNode) return null;
    const node = this.activeNode;
    node.setKnobValue('transformMode', mode);
    this.notifyUpdate();
    return {
      type: 'Transform',
      mode,
      referenceFrame: node.referenceFrame || 1,
      transform: typeof node.getTransformAtFrame === 'function' ? node.getTransformAtFrame(this.currentFrame) : null
    };
  }

  exportCornerPin(mode = 'matchmove') {
    if (!this.activeNode) return null;
    if (this.isPlanar && typeof this.activeNode.exportCornerPinKnobs === 'function') {
      const pinKnobs = this.activeNode.exportCornerPinKnobs(this.currentFrame);
      return { type: 'CornerPin2D', mode, knobs: pinKnobs };
    }
    return { type: 'CornerPin2D', mode, trackId: this.selectedTrackId };
  }

  notifyUpdate() {
    if (this.activeNode) {
      this.activeNode.markDirty();
    }
    if (this.onUpdateCallback) {
      this.onUpdateCallback(this.activeNode);
    }
    if (this.viewerUI) {
      this.viewerUI.render();
    }
    this.updateInspectorTable();
  }

  // -------------------------------------------------------------
  // Viewer Canvas Mouse Events
  // -------------------------------------------------------------

  onMouseDown(e, imgX, imgY) {
    if (!this.showOverlay || !this.activeNode) return false;

    if (this.isPlanar) {
      // Planar tracker corner hit detection
      const corners = this.activeNode.getCornersAtFrame(this.currentFrame);
      if (Array.isArray(corners) && corners.length === 4) {
        for (let i = 0; i < 4; i++) {
          const c = corners[i];
          if (Math.hypot(imgX - c.x, imgY - c.y) <= 18) {
            this.selectedCornerIdx = i;
            this.activeHandle = 'planarCorner';
            this.isDragging = true;
            this.dragStartPos = { x: imgX, y: imgY };
            return true;
          }
        }

        // Center hit
        const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) * 0.25;
        const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) * 0.25;
        if (Math.hypot(imgX - cx, imgY - cy) <= 20) {
          this.selectedCornerIdx = 'center';
          this.activeHandle = 'planarCenter';
          this.isDragging = true;
          this.dragStartPos = { x: imgX, y: imgY };
          this.initialCornerPositions = corners.map(pt => ({ x: pt.x, y: pt.y }));
          return true;
        }
      }
    } else {
      // Point tracker hit detection
      const track = this.getActiveTrack();
      if (!track) return false;
      const pos = track.getPos(this.currentFrame);
      const dist = Math.hypot(imgX - pos.x, imgY - pos.y);

      if (dist <= 14) {
        this.activeHandle = 'anchor';
        this.isDragging = true;
        this.dragStartPos = { x: imgX, y: imgY };
        return true;
      }

      // Check pattern corner / search corner
      const pw = track.patternWidth || 31;
      const ph = track.patternHeight || 31;
      if (Math.abs(imgX - (pos.x + pw * 0.5)) <= 8 && Math.abs(imgY - (pos.y + ph * 0.5)) <= 8) {
        this.activeHandle = 'patternCorner';
        this.isDragging = true;
        this.dragStartPos = { x: imgX, y: imgY };
        return true;
      }

      const sw = track.searchWidth || 61;
      const sh = track.searchHeight || 61;
      if (Math.abs(imgX - (pos.x + sw * 0.5)) <= 8 && Math.abs(imgY - (pos.y + sh * 0.5)) <= 8) {
        this.activeHandle = 'searchCorner';
        this.isDragging = true;
        this.dragStartPos = { x: imgX, y: imgY };
        return true;
      }
    }

    return false;
  }

  onMouseMove(e, imgX, imgY) {
    if (!this.isDragging || !this.activeNode) return false;

    if (this.isPlanar) {
      const corners = this.activeNode.getCornersAtFrame(this.currentFrame);
      if (this.activeHandle === 'planarCorner' && typeof this.selectedCornerIdx === 'number') {
        corners[this.selectedCornerIdx].x = Math.round(imgX);
        corners[this.selectedCornerIdx].y = Math.round(imgY);
        this.activeNode.setCorners(corners[0], corners[1], corners[2], corners[3], this.currentFrame);
        this.notifyUpdate();
        return true;
      } else if (this.activeHandle === 'planarCenter' && this.initialCornerPositions.length === 4) {
        const dx = imgX - this.dragStartPos.x;
        const dy = imgY - this.dragStartPos.y;
        const p1 = { x: Math.round(this.initialCornerPositions[0].x + dx), y: Math.round(this.initialCornerPositions[0].y + dy) };
        const p2 = { x: Math.round(this.initialCornerPositions[1].x + dx), y: Math.round(this.initialCornerPositions[1].y + dy) };
        const p3 = { x: Math.round(this.initialCornerPositions[2].x + dx), y: Math.round(this.initialCornerPositions[2].y + dy) };
        const p4 = { x: Math.round(this.initialCornerPositions[3].x + dx), y: Math.round(this.initialCornerPositions[3].y + dy) };
        this.activeNode.setCorners(p1, p2, p3, p4, this.currentFrame);
        this.notifyUpdate();
        return true;
      }
    } else {
      const track = this.getActiveTrack();
      if (!track) return false;

      if (this.activeHandle === 'anchor') {
        track.setManualKey(this.currentFrame, Math.round(imgX), Math.round(imgY));
        this.notifyUpdate();
        return true;
      } else if (this.activeHandle === 'patternCorner') {
        const pos = track.getPos(this.currentFrame);
        track.patternWidth = Math.max(11, Math.round(Math.abs(imgX - pos.x) * 2));
        track.patternHeight = Math.max(11, Math.round(Math.abs(imgY - pos.y) * 2));
        this.notifyUpdate();
        return true;
      } else if (this.activeHandle === 'searchCorner') {
        const pos = track.getPos(this.currentFrame);
        track.searchWidth = Math.max(21, Math.round(Math.abs(imgX - pos.x) * 2));
        track.searchHeight = Math.max(21, Math.round(Math.abs(imgY - pos.y) * 2));
        this.notifyUpdate();
        return true;
      }
    }

    return false;
  }

  onMouseUp() {
    if (this.isDragging) {
      this.isDragging = false;
      this.activeHandle = null;
      this.notifyUpdate();
      return true;
    }
    return false;
  }

  onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return false;

    if (e.key === 't' || e.key === 'T') {
      this.showOverlay = !this.showOverlay;
      this.viewerUI.render();
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------
  // Viewer Overlay Rendering
  // -------------------------------------------------------------

  drawOverlay(ctx, zoom, panX, panY) {
    if (!this.showOverlay || !this.activeNode) return;

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    if (this.isPlanar) {
      this.drawPlanarOverlay(ctx);
    } else {
      this.drawPointTrackerOverlay(ctx);
    }

    ctx.restore();
  }

  drawPointTrackerOverlay(ctx) {
    const tracks = this.activeNode.tracks || [];
    for (const track of tracks) {
      if (!track.enabled) continue;
      const isSelected = (track.id === this.selectedTrackId);
      const pos = track.getPos(this.currentFrame);

      const pw = track.patternWidth || 31;
      const ph = track.patternHeight || 31;
      const sw = track.searchWidth || 61;
      const sh = track.searchHeight || 61;

      // 1. Draw Trajectory Trail
      if (this.showTrajectoryTrail && track.keyframes && track.keyframes.size > 1) {
        ctx.strokeStyle = isSelected ? '#ff922b' : '#339af0';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        let first = true;
        const sortedFrames = Array.from(track.keyframes.keys()).sort((a, b) => a - b);
        for (const f of sortedFrames) {
          const pt = track.keyframes.get(f);
          if (first) { ctx.moveTo(pt.x, pt.y); first = false; } else { ctx.lineTo(pt.x, pt.y); }
        }
        ctx.stroke();

        // Trail frame dots
        for (const f of sortedFrames) {
          const pt = track.keyframes.get(f);
          ctx.fillStyle = f === this.currentFrame ? '#ffffff' : (isSelected ? '#ff922b' : '#339af0');
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, f === this.currentFrame ? 3.5 : 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 2. Search Window (Outer dashed box)
      if (this.showSearchWindow) {
        ctx.strokeStyle = isSelected ? '#ff922b' : '#888888';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(pos.x - sw * 0.5, pos.y - sh * 0.5, sw, sh);
        ctx.setLineDash([]);
      }

      // 3. Pattern Window (Inner solid box)
      if (this.showPatternWindow) {
        ctx.strokeStyle = track.trackLost ? '#ff4d4f' : (isSelected ? '#51cf66' : '#cccccc');
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.strokeRect(pos.x - pw * 0.5, pos.y - ph * 0.5, pw, ph);
      }

      // 4. Center Anchor Crosshair (+)
      ctx.strokeStyle = isSelected ? '#ff922b' : '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pos.x - 7, pos.y);
      ctx.lineTo(pos.x + 7, pos.y);
      ctx.moveTo(pos.x, pos.y - 7);
      ctx.lineTo(pos.x, pos.y + 7);
      ctx.stroke();

      // Track Label Tag
      ctx.fillStyle = isSelected ? '#ff922b' : '#cccccc';
      ctx.font = '10px monospace';
      ctx.fillText(`${track.name} [f:${this.currentFrame}]`, pos.x + pw * 0.5 + 4, pos.y - ph * 0.5 + 8);
    }
  }

  drawPlanarOverlay(ctx) {
    const corners = this.activeNode.getCornersAtFrame(this.currentFrame);
    if (!Array.isArray(corners) || corners.length !== 4) return;

    const [p1, p2, p3, p4] = corners;

    // 1. Planar Surface Quadrilateral Boundary
    ctx.strokeStyle = '#51cf66';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.stroke();

    // Translucent planar fill
    ctx.fillStyle = 'rgba(81, 207, 102, 0.12)';
    ctx.fill();

    // 2. Interior Perspective Grid Lines
    if (this.showPlanarGrid) {
      ctx.strokeStyle = 'rgba(81, 207, 102, 0.4)';
      ctx.lineWidth = 1;
      const divs = 4;
      for (let i = 1; i < divs; i++) {
        const u = i / divs;
        // Horizontal grid
        const lx = p1.x + (p4.x - p1.x) * u;
        const ly = p1.y + (p4.y - p1.y) * u;
        const rx = p2.x + (p3.x - p2.x) * u;
        const ry = p2.y + (p3.y - p2.y) * u;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(rx, ry);
        ctx.stroke();

        // Vertical grid
        const tx = p1.x + (p2.x - p1.x) * u;
        const ty = p1.y + (p2.y - p1.y) * u;
        const bx = p4.x + (p3.x - p4.x) * u;
        const by = p4.y + (p3.y - p4.y) * u;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    // 3. Four Corner Control Handles
    const labels = ['1 (TL)', '2 (TR)', '3 (BR)', '4 (BL)'];
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      const isSelected = (this.selectedCornerIdx === i);

      ctx.fillStyle = isSelected ? '#ff922b' : '#51cf66';
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.arc(c.x, c.y, isSelected ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '9px monospace';
      ctx.fillText(labels[i], c.x + 8, c.y + 4);
    }

    // 4. Center Translation Anchor
    const cx = (p1.x + p2.x + p3.x + p4.x) * 0.25;
    const cy = (p1.y + p2.y + p3.y + p4.y) * 0.25;
    ctx.fillStyle = (this.selectedCornerIdx === 'center') ? '#ff922b' : '#339af0';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // -------------------------------------------------------------
  // Properties / Inspector Workspace DOM Render
  // -------------------------------------------------------------

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="tracking-workspace">
        <!-- Prominent Disclaimer Requirement -->
        <div class="tracking-disclaimer-banner">
          ⚠️ <b>Engine Notice:</b> ${this.disclaimer}
        </div>

        <!-- Tracking Transport Bar -->
        <div class="tracking-transport-bar">
          <button class="btn-tool" id="btn-track-bwd" title="Track Backward Sequence">◀ Track Rev</button>
          <button class="btn-tool" id="btn-track-step-bwd" title="Step Track 1 Frame Backward (|◀)">|◀ Step Rev</button>
          <button class="btn-tool btn-stop" id="btn-track-stop" title="Stop Tracking">⏹ Stop</button>
          <button class="btn-tool" id="btn-track-step-fwd" title="Step Track 1 Frame Forward (▶|)">▶| Step Fwd</button>
          <button class="btn-tool" id="btn-track-fwd" title="Track Forward Sequence">Track Fwd ▶</button>
        </div>

        <!-- Track Management & Display Controls -->
        <div class="tracking-controls-row">
          ${!this.isPlanar ? `
            <button class="btn-tool" id="btn-track-add">+ Add Track</button>
            <button class="btn-tool" id="btn-track-del">- Del Track</button>
            <select id="tracking-track-select" class="prop-select"></select>
          ` : `
            <span class="tracking-mode-badge">Planar 4-Corner Homography</span>
          `}
          <label class="tracking-chk"><input type="checkbox" id="chk-show-overlay" ${this.showOverlay ? 'checked' : ''}/> Overlay</label>
          <label class="tracking-chk"><input type="checkbox" id="chk-show-trail" ${this.showTrajectoryTrail ? 'checked' : ''}/> Trail</label>
        </div>

        <!-- Export Tracking Data Buttons -->
        <div class="tracking-export-row">
          <button class="btn-tool btn-export" id="btn-export-matchmove" title="Export Matchmove Transform">Export MatchMove</button>
          <button class="btn-tool btn-export" id="btn-export-stabilize" title="Export Stabilize Transform">Export Stabilize</button>
          <button class="btn-tool btn-export" id="btn-export-cornerpin" title="Export CornerPin2D Node">Export CornerPin</button>
        </div>

        <!-- Track Data Inspector Table -->
        <div class="tracking-table-wrapper">
          <table class="tracking-data-table" id="tracking-data-table">
            <thead>
              <tr>
                <th>Frame</th>
                <th>X</th>
                <th>Y</th>
                <th>Correlation</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="tracking-table-body"></tbody>
          </table>
        </div>
      </div>
    `;

    // Transport events
    this.container.querySelector('#btn-track-fwd')?.addEventListener('click', () => this.trackForward());
    this.container.querySelector('#btn-track-bwd')?.addEventListener('click', () => this.trackBackward());
    this.container.querySelector('#btn-track-step-fwd')?.addEventListener('click', () => this.stepTrackForward());
    this.container.querySelector('#btn-track-step-bwd')?.addEventListener('click', () => this.stepTrackBackward());
    this.container.querySelector('#btn-track-stop')?.addEventListener('click', () => this.stopTracking());

    // Export events
    this.container.querySelector('#btn-export-matchmove')?.addEventListener('click', () => this.exportTransform('matchmove'));
    this.container.querySelector('#btn-export-stabilize')?.addEventListener('click', () => this.exportTransform('stabilize'));
    this.container.querySelector('#btn-export-cornerpin')?.addEventListener('click', () => this.exportCornerPin('matchmove'));

    // Checkbox toggles
    this.container.querySelector('#chk-show-overlay')?.addEventListener('change', (e) => {
      this.showOverlay = e.target.checked;
      if (this.viewerUI) this.viewerUI.render();
    });
    this.container.querySelector('#chk-show-trail')?.addEventListener('change', (e) => {
      this.showTrajectoryTrail = e.target.checked;
      if (this.viewerUI) this.viewerUI.render();
    });

    // Point track selector
    if (!this.isPlanar) {
      this.container.querySelector('#btn-track-add')?.addEventListener('click', () => this.addTrack());
      this.container.querySelector('#btn-track-del')?.addEventListener('click', () => this.removeSelectedTrack());
      const select = this.container.querySelector('#tracking-track-select');
      if (select && this.activeNode && this.activeNode.tracks) {
        select.innerHTML = '';
        for (const t of this.activeNode.tracks) {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = t.name;
          opt.selected = (t.id === this.selectedTrackId);
          select.appendChild(opt);
        }
        select.addEventListener('change', (e) => {
          this.selectedTrackId = Number(e.target.value);
          this.notifyUpdate();
        });
      }
    }

    this.updateInspectorTable();
  }

  updateInspectorTable() {
    const tbody = this.container ? this.container.querySelector('#tracking-table-body') : null;
    if (!tbody || !this.activeNode) return;
    tbody.innerHTML = '';

    if (this.isPlanar) {
      const corners = this.activeNode.getCornersAtFrame(this.currentFrame);
      if (Array.isArray(corners)) {
        for (let i = 0; i < corners.length; i++) {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>Corner ${i + 1}</td>
            <td>${corners[i].x.toFixed(1)}</td>
            <td>${corners[i].y.toFixed(1)}</td>
            <td>1.00</td>
            <td><span class="track-status-ok">LOCKED</span></td>
          `;
          tbody.appendChild(tr);
        }
      }
    } else {
      const track = this.getActiveTrack();
      if (!track || !track.keyframes) return;

      const sortedFrames = Array.from(track.keyframes.keys()).sort((a, b) => a - b);
      // Show closest 5 frames around current frame
      const nearby = sortedFrames.filter(f => Math.abs(f - this.currentFrame) <= 5);
      const displayFrames = nearby.length > 0 ? nearby : sortedFrames.slice(-5);

      for (const f of displayFrames) {
        const kf = track.keyframes.get(f);
        const isCur = (f === this.currentFrame);
        const tr = document.createElement('tr');
        if (isCur) tr.className = 'cur-frame-row';
        tr.innerHTML = `
          <td>${f}${isCur ? ' (Cur)' : ''}</td>
          <td>${kf.x.toFixed(1)}</td>
          <td>${kf.y.toFixed(1)}</td>
          <td>${(kf.correlation || 1.0).toFixed(2)}</td>
          <td>${kf.trackLost ? '<span class="track-status-lost">LOST</span>' : '<span class="track-status-ok">TRACKED</span>'}</td>
        `;
        tbody.appendChild(tr);
      }
    }
  }
}

