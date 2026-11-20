/**
 * OpenComp - Dedicated Dope Sheet UI
 * Professional Nuke-style Dope Sheet interface.
 * Features hierarchical node and parameter tracks, expand/collapse tree,
 * summary keyframe bars, per-knob keyframe ticks, marquee box selection,
 * drag-to-retime, keyframe block scaling, duplication, deletion, and timeline synchronization.
 */

export class DopeSheetUI {
  /**
   * @param {HTMLElement} containerElement
   * @param {Object} [options={}]
   * @param {function(number): void} [options.onFrameChange]
   * @param {function(Object): void} [options.onKeyframesChanged]
   */
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.onFrameChange = options.onFrameChange || null;
    this.onKeyframesChanged = options.onKeyframesChanged || null;

    // Timeline state
    this.startFrame = options.startFrame !== undefined ? options.startFrame : 1;
    this.endFrame = options.endFrame !== undefined ? options.endFrame : 100;
    this.currentFrame = options.currentFrame !== undefined ? options.currentFrame : 1;
    this.inPoint = options.inPoint !== undefined ? options.inPoint : 1;
    this.outPoint = options.outPoint !== undefined ? options.outPoint : 100;

    // Viewport
    this.viewStart = this.startFrame;
    this.viewEnd = this.endFrame;

    // Track Tree Model:
    // Array of NodeEntry: {
    //   id: string,
    //   name: string,
    //   node: Object,
    //   expanded: boolean,
    //   channels: Array<{ key: string, name: string, knob: Object, keys: Set<number> }>
    // }
    this.nodes = [];
    this.filterText = '';

    // Selection Model:
    // Set of KeyRef: { nodeId, knobKey, frame }
    this.selectedKeys = new Set();
    this.selectedNodeBar = null; // nodeId if summary bar selected

    // Interaction state
    this.isDraggingPlayhead = false;
    this.isMarquee = false;
    this.marqueeStart = { x: 0, y: 0 };
    this.marqueeEnd = { x: 0, y: 0 };
    this.isRetiming = false;
    this.retimeStartFrame = 0;
    this.initialKeyframes = new Map(); // keyRef -> initialFrame
    this.isPanning = false;
    this.lastMouseX = 0;

    // Layout metrics
    this.treeWidth = 220;
    this.headerHeight = 28;
    this.rowHeight = 22;

    this.render();
  }

  // -------------------------------------------------------------
  // Data Population API
  // -------------------------------------------------------------

  /**
   * Populate Dope Sheet from DAG nodes
   * @param {Array<Object>} graphNodes
   */
  setNodes(graphNodes) {
    this.nodes = [];
    if (!Array.isArray(graphNodes)) return;

    for (const node of graphNodes) {
      if (!node.knobs) continue;
      const channels = [];

      for (const [key, knob] of Object.entries(node.knobs)) {
        if (knob && knob.keyframes && Object.keys(knob.keyframes).length > 0) {
          const frames = new Set(Object.keys(knob.keyframes).map(Number));
          channels.push({
            key,
            name: knob.label || key,
            knob,
            keys: frames
          });
        }
      }

      if (channels.length > 0) {
        this.nodes.push({
          id: node.id,
          name: node.name || node.id,
          node,
          expanded: true,
          channels
        });
      }
    }

    this.renderTree();
    this.drawCanvas();
  }

  setFrame(frame) {
    const f = Math.max(this.startFrame, Math.min(this.endFrame, Math.round(frame)));
    if (this.currentFrame === f) return;
    this.currentFrame = f;
    this.drawCanvas();
  }

  setFrameRange(start, end) {
    this.startFrame = Number(start);
    this.endFrame = Number(end);
    this.viewStart = this.startFrame;
    this.viewEnd = this.endFrame;
    this.drawCanvas();
  }

  setInOut(inPt, outPt) {
    this.inPoint = Number(inPt);
    this.outPoint = Number(outPt);
    this.drawCanvas();
  }

  // -------------------------------------------------------------
  // Coordinate Mapping
  // -------------------------------------------------------------

  get canvasWidth() {
    const canvas = this.container.querySelector('#dopesheet-canvas');
    return canvas ? canvas.width : 600;
  }

  get canvasHeight() {
    const canvas = this.container.querySelector('#dopesheet-canvas');
    return canvas ? canvas.height : 300;
  }

  frameToX(frame) {
    const span = Math.max(1, this.viewEnd - this.viewStart);
    const u = (frame - this.viewStart) / span;
    return u * this.canvasWidth;
  }

  xToFrame(x) {
    const u = x / this.canvasWidth;
    return this.viewStart + u * (this.viewEnd - this.viewStart);
  }

  // -------------------------------------------------------------
  // Flattened Row Calculation
  // -------------------------------------------------------------

  getVisibleRows() {
    const rows = [];
    for (const n of this.nodes) {
      if (this.filterText && !n.name.toLowerCase().includes(this.filterText.toLowerCase())) {
        continue;
      }
      // Node Master Row
      const allFrames = new Set();
      for (const ch of n.channels) {
        for (const f of ch.keys) allFrames.add(f);
      }
      const sorted = Array.from(allFrames).sort((a, b) => a - b);
      const spanMin = sorted.length > 0 ? sorted[0] : 0;
      const spanMax = sorted.length > 0 ? sorted[sorted.length - 1] : 0;

      rows.push({
        type: 'node',
        nodeId: n.id,
        name: n.name,
        expanded: n.expanded,
        spanMin,
        spanMax,
        keys: allFrames,
        node: n.node
      });

      // Channel Child Rows
      if (n.expanded) {
        for (const ch of n.channels) {
          rows.push({
            type: 'channel',
            nodeId: n.id,
            knobKey: ch.key,
            name: ch.name,
            keys: ch.keys,
            knob: ch.knob,
            node: n.node
          });
        }
      }
    }
    return rows;
  }

  // -------------------------------------------------------------
  // Keyframe Retiming & Manipulation
  // -------------------------------------------------------------

  moveSelectedKeys(deltaFrames) {
    if (deltaFrames === 0 || this.selectedKeys.size === 0) return;

    for (const keyId of this.selectedKeys) {
      const parts = keyId.split('::');
      const nodeId = parts[0];
      const knobKey = parts[1];
      const oldFrame = Number(parts[2]);

      const n = this.nodes.find(x => x.id === nodeId);
      if (n) {
        const ch = n.channels.find(c => c.key === knobKey);
        if (ch && ch.knob && ch.knob.keyframes && ch.knob.keyframes[oldFrame] !== undefined) {
          const val = ch.knob.keyframes[oldFrame];
          delete ch.knob.keyframes[oldFrame];
          ch.keys.delete(oldFrame);

          const newFrame = Math.round(oldFrame + deltaFrames);
          ch.knob.keyframes[newFrame] = val;
          ch.keys.add(newFrame);
        }
      }
    }

    // Update selected keys set with new frames
    const updated = new Set();
    for (const keyId of this.selectedKeys) {
      const parts = keyId.split('::');
      const newFrame = Math.round(Number(parts[2]) + deltaFrames);
      updated.add(`${parts[0]}::${parts[1]}::${newFrame}`);
    }
    this.selectedKeys = updated;

    this.notifyChanges();
    this.drawCanvas();
  }

  deleteSelectedKeys() {
    if (this.selectedKeys.size === 0) return;

    for (const keyId of this.selectedKeys) {
      const parts = keyId.split('::');
      const nodeId = parts[0];
      const knobKey = parts[1];
      const frame = Number(parts[2]);

      const n = this.nodes.find(x => x.id === nodeId);
      if (n) {
        const ch = n.channels.find(c => c.key === knobKey);
        if (ch && ch.knob && ch.knob.keyframes) {
          delete ch.knob.keyframes[frame];
          ch.keys.delete(frame);
        }
      }
    }

    this.selectedKeys.clear();
    this.notifyChanges();
    this.renderTree();
    this.drawCanvas();
  }

  duplicateSelectedKeys(deltaFrames = 1) {
    if (this.selectedKeys.size === 0) return;
    const newSelected = new Set();

    for (const keyId of this.selectedKeys) {
      const parts = keyId.split('::');
      const nodeId = parts[0];
      const knobKey = parts[1];
      const frame = Number(parts[2]);

      const n = this.nodes.find(x => x.id === nodeId);
      if (n) {
        const ch = n.channels.find(c => c.key === knobKey);
        if (ch && ch.knob && ch.knob.keyframes && ch.knob.keyframes[frame] !== undefined) {
          const val = ch.knob.keyframes[frame];
          const targetFrame = Math.round(frame + deltaFrames);
          ch.knob.keyframes[targetFrame] = val;
          ch.keys.add(targetFrame);
          newSelected.add(`${nodeId}::${knobKey}::${targetFrame}`);
        }
      }
    }

    this.selectedKeys = newSelected;
    this.notifyChanges();
    this.drawCanvas();
  }

  scaleSelectedKeys(scaleFactor, pivotFrame = null) {
    if (this.selectedKeys.size === 0 || scaleFactor <= 0) return;

    const frames = [];
    for (const keyId of this.selectedKeys) {
      frames.push(Number(keyId.split('::')[2]));
    }
    const pivot = pivotFrame !== null ? pivotFrame : Math.min(...frames);

    const remapped = [];
    for (const keyId of this.selectedKeys) {
      const parts = keyId.split('::');
      const nodeId = parts[0];
      const knobKey = parts[1];
      const oldFrame = Number(parts[2]);

      const n = this.nodes.find(x => x.id === nodeId);
      if (n) {
        const ch = n.channels.find(c => c.key === knobKey);
        if (ch && ch.knob && ch.knob.keyframes && ch.knob.keyframes[oldFrame] !== undefined) {
          const val = ch.knob.keyframes[oldFrame];
          delete ch.knob.keyframes[oldFrame];
          ch.keys.delete(oldFrame);
          const newFrame = Math.round(pivot + (oldFrame - pivot) * scaleFactor);
          remapped.push({ ch, newFrame, val, nodeId, knobKey });
        }
      }
    }

    this.selectedKeys.clear();
    for (const item of remapped) {
      item.ch.knob.keyframes[item.newFrame] = item.val;
      item.ch.keys.add(item.newFrame);
      this.selectedKeys.add(`${item.nodeId}::${item.knobKey}::${item.newFrame}`);
    }

    this.notifyChanges();
    this.drawCanvas();
  }

  notifyChanges() {
    for (const n of this.nodes) {
      if (n.node && typeof n.node.markDirty === 'function') {
        n.node.markDirty();
      }
    }
    if (this.onKeyframesChanged) {
      this.onKeyframesChanged(this.nodes);
    }
  }

  // -------------------------------------------------------------
  // Tree Rendering (Left Pane)
  // -------------------------------------------------------------

  renderTree() {
    const treeEl = this.container.querySelector('#dopesheet-tree');
    if (!treeEl) return;
    treeEl.innerHTML = '';

    const rows = this.getVisibleRows();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowDiv = document.createElement('div');
      rowDiv.className = `dopesheet-tree-row ${r.type}`;
      rowDiv.style.height = `${this.rowHeight}px`;

      if (r.type === 'node') {
        const arrow = document.createElement('span');
        arrow.className = 'dopesheet-expander';
        arrow.textContent = r.expanded ? '▼' : '▶';
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          const target = this.nodes.find(x => x.id === r.nodeId);
          if (target) {
            target.expanded = !target.expanded;
            this.renderTree();
            this.drawCanvas();
          }
        });

        const icon = document.createElement('span');
        icon.className = 'dopesheet-node-icon';
        icon.textContent = '⬡';

        const label = document.createElement('span');
        label.className = 'dopesheet-label';
        label.textContent = r.name;
        label.title = `Node: ${r.name} (${r.keys.size} keyframes)`;

        rowDiv.appendChild(arrow);
        rowDiv.appendChild(icon);
        rowDiv.appendChild(label);
      } else {
        // Channel row
        const indent = document.createElement('span');
        indent.className = 'dopesheet-indent';

        const dot = document.createElement('span');
        dot.className = 'dopesheet-ch-dot';
        dot.textContent = '•';

        const label = document.createElement('span');
        label.className = 'dopesheet-label ch-label';
        label.textContent = r.name;
        label.title = `Knob: ${r.name} (${r.keys.size} keyframes)`;

        rowDiv.appendChild(indent);
        rowDiv.appendChild(dot);
        rowDiv.appendChild(label);
      }

      treeEl.appendChild(rowDiv);
    }
  }

  // -------------------------------------------------------------
  // Canvas Rendering (Right Pane)
  // -------------------------------------------------------------

  drawCanvas() {
    const canvas = this.container.querySelector('#dopesheet-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) return;

    ctx.clearRect(0, 0, w, h);

    // 1. Dark Background
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(0, 0, w, h);

    // 2. In/Out Range Highlight
    const inX = this.frameToX(this.inPoint);
    const outX = this.frameToX(this.outPoint);
    ctx.fillStyle = 'rgba(74, 144, 226, 0.08)';
    ctx.fillRect(inX, 0, Math.max(1, outX - inX), h);

    // 3. Grid Lines & Header Ruler
    this.drawRulerAndGrid(ctx, w, h);

    // 4. Track Rows & Keyframe Blocks
    const rows = this.getVisibleRows();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const y = this.headerHeight + i * this.rowHeight;

      // Row separator
      ctx.strokeStyle = '#282828';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + this.rowHeight);
      ctx.lineTo(w, y + this.rowHeight);
      ctx.stroke();

      if (r.type === 'node') {
        // Master Node Summary Bar (Draw span bar if keys exist)
        if (r.keys.size > 0) {
          const x0 = this.frameToX(r.spanMin);
          const x1 = this.frameToX(r.spanMax);
          const barW = Math.max(4, x1 - x0);

          // Span Bar Body
          ctx.fillStyle = 'rgba(255, 146, 43, 0.25)';
          ctx.fillRect(x0, y + 4, barW, this.rowHeight - 8);

          // Span Border
          ctx.strokeStyle = '#ff922b';
          ctx.lineWidth = 1;
          ctx.strokeRect(x0, y + 4, barW, this.rowHeight - 8);

          // Summary tick marks for all keyframes
          ctx.fillStyle = '#ff922b';
          for (const kf of r.keys) {
            const kx = this.frameToX(kf);
            ctx.fillRect(kx - 1.5, y + 3, 3, this.rowHeight - 6);
          }
        }
      } else {
        // Channel Keyframe Rectangles
        for (const kf of r.keys) {
          const kx = this.frameToX(kf);
          const keyId = `${r.nodeId}::${r.knobKey}::${kf}`;
          const isSelected = this.selectedKeys.has(keyId);

          ctx.fillStyle = isSelected ? '#ff922b' : '#ced4da';
          ctx.strokeStyle = '#141414';
          ctx.lineWidth = 1;

          // Draw Diamond Keyframe Tick
          const cy = y + this.rowHeight * 0.5;
          ctx.beginPath();
          ctx.moveTo(kx, cy - 5);
          ctx.lineTo(kx + 5, cy);
          ctx.lineTo(kx, cy + 5);
          ctx.lineTo(kx - 5, cy);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          if (isSelected) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(kx, cy - 7);
            ctx.lineTo(kx + 7, cy);
            ctx.lineTo(kx, cy + 7);
            ctx.lineTo(kx - 7, cy);
            ctx.closePath();
            ctx.stroke();
          }
        }
      }
    }

    // 5. Marquee Box
    if (this.isMarquee) {
      const left = Math.min(this.marqueeStart.x, this.marqueeEnd.x);
      const top = Math.min(this.marqueeStart.y, this.marqueeEnd.y);
      const mw = Math.abs(this.marqueeEnd.x - this.marqueeStart.x);
      const mh = Math.abs(this.marqueeEnd.y - this.marqueeStart.y);

      ctx.strokeStyle = '#4a90e2';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(left, top, mw, mh);

      ctx.fillStyle = 'rgba(74, 144, 226, 0.15)';
      ctx.fillRect(left, top, mw, mh);
      ctx.setLineDash([]);
    }

    // 6. Playhead Indicator Line
    const curX = this.frameToX(this.currentFrame);
    ctx.strokeStyle = '#ff922b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(curX, 0);
    ctx.lineTo(curX, h);
    ctx.stroke();

    // Playhead Top Flag
    ctx.fillStyle = '#ff922b';
    ctx.beginPath();
    ctx.moveTo(curX - 4, 0);
    ctx.lineTo(curX + 4, 0);
    ctx.lineTo(curX + 4, 6);
    ctx.lineTo(curX, 12);
    ctx.lineTo(curX - 4, 6);
    ctx.fill();
  }

  drawRulerAndGrid(ctx, w, h) {
    // Header Bar Background
    ctx.fillStyle = '#222222';
    ctx.fillRect(0, 0, w, this.headerHeight);

    ctx.strokeStyle = '#333333';
    ctx.beginPath();
    ctx.moveTo(0, this.headerHeight);
    ctx.lineTo(w, this.headerHeight);
    ctx.stroke();

    const span = Math.max(1, this.viewEnd - this.viewStart);
    let step = 10;
    if (span > 500) step = 50;
    else if (span > 200) step = 25;
    else if (span < 30) step = 5;
    else if (span < 15) step = 1;

    ctx.fillStyle = '#888';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    const firstTick = Math.ceil(this.viewStart / step) * step;
    for (let f = firstTick; f <= this.viewEnd; f += step) {
      const x = this.frameToX(f);

      // Header tick & label
      ctx.strokeStyle = '#555';
      ctx.beginPath();
      ctx.moveTo(x, this.headerHeight - 8);
      ctx.lineTo(x, this.headerHeight);
      ctx.stroke();

      ctx.fillText(String(f), x, this.headerHeight - 11);

      // Vertical grid down the canvas
      ctx.strokeStyle = '#252525';
      ctx.beginPath();
      ctx.moveTo(x, this.headerHeight);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }

  // -------------------------------------------------------------
  // Events
  // -------------------------------------------------------------

  initEvents() {
    const canvas = this.container.querySelector('#dopesheet-canvas');
    if (!canvas) return;

    // Resize observer / window resize
    const resizeCanvas = () => {
      const wrapper = canvas.parentElement;
      if (wrapper && wrapper.clientWidth > 0) {
        canvas.width = wrapper.clientWidth;
        canvas.height = Math.max(200, wrapper.clientHeight);
        this.drawCanvas();
      }
    };
    setTimeout(resizeCanvas, 50);
    window.addEventListener('resize', resizeCanvas);

    // Mouse wheel zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const fCenter = this.xToFrame(mouseX);
      const zoom = e.deltaY < 0 ? 1.15 : 0.87;

      const fRange = (this.viewEnd - this.viewStart) / zoom;
      const u = mouseX / canvas.width;

      this.viewStart = fCenter - u * fRange;
      this.viewEnd = this.viewStart + fRange;
      this.drawCanvas();
    }, { passive: false });

    // Canvas Mouse Down
    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Pan with Middle Click or Alt+Click
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this.isPanning = true;
        this.lastMouseX = e.clientX;
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }

      if (e.button === 0) {
        // 1. Click on Header Ruler: Scrub playhead
        if (mouseY <= this.headerHeight) {
          const targetF = Math.round(this.xToFrame(mouseX));
          this.setFrame(targetF);
          if (this.onFrameChange) this.onFrameChange(targetF);
          this.isDraggingPlayhead = true;
          return;
        }

        // 2. Click on Keyframe or Track Row
        const rows = this.getVisibleRows();
        const clickedRowIdx = Math.floor((mouseY - this.headerHeight) / this.rowHeight);
        const clickedRow = rows[clickedRowIdx];

        if (clickedRow) {
          if (clickedRow.type === 'channel') {
            // Find if a diamond was clicked
            let clickedKf = null;
            for (const kf of clickedRow.keys) {
              const kx = this.frameToX(kf);
              if (Math.abs(mouseX - kx) <= 8) {
                clickedKf = kf;
                break;
              }
            }

            if (clickedKf !== null) {
              const keyId = `${clickedRow.nodeId}::${clickedRow.knobKey}::${clickedKf}`;
              if (e.shiftKey) {
                if (this.selectedKeys.has(keyId)) this.selectedKeys.delete(keyId);
                else this.selectedKeys.add(keyId);
              } else {
                if (!this.selectedKeys.has(keyId)) {
                  this.selectedKeys.clear();
                  this.selectedKeys.add(keyId);
                }
              }

              // Start Retiming Drag
              this.isRetiming = true;
              this.retimeStartFrame = this.xToFrame(mouseX);
              this.drawCanvas();
              return;
            }
          } else if (clickedRow.type === 'node') {
            // Check if clicked summary span bar
            const x0 = this.frameToX(clickedRow.spanMin);
            const x1 = this.frameToX(clickedRow.spanMax);
            if (mouseX >= x0 - 4 && mouseX <= x1 + 4) {
              // Select all keyframes under this node
              if (!e.shiftKey) this.selectedKeys.clear();
              const targetNode = this.nodes.find(n => n.id === clickedRow.nodeId);
              if (targetNode) {
                for (const ch of targetNode.channels) {
                  for (const kf of ch.keys) {
                    this.selectedKeys.add(`${targetNode.id}::${ch.key}::${kf}`);
                  }
                }
              }
              this.isRetiming = true;
              this.retimeStartFrame = this.xToFrame(mouseX);
              this.drawCanvas();
              return;
            }
          }
        }

        // 3. Clicked Empty Area: Start Marquee Box
        if (!e.shiftKey) this.selectedKeys.clear();
        this.isMarquee = true;
        this.marqueeStart = { x: mouseX, y: mouseY };
        this.marqueeEnd = { x: mouseX, y: mouseY };
        this.drawCanvas();
      }
    });

    // Window Mouse Move
    window.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (this.isPanning) {
        const dx = e.clientX - this.lastMouseX;
        this.lastMouseX = e.clientX;
        const df = (dx / canvas.width) * (this.viewEnd - this.viewStart);
        this.viewStart -= df;
        this.viewEnd -= df;
        this.drawCanvas();
        return;
      }

      if (this.isDraggingPlayhead) {
        const targetF = Math.round(this.xToFrame(mouseX));
        this.setFrame(targetF);
        if (this.onFrameChange) this.onFrameChange(targetF);
        return;
      }

      if (this.isRetiming) {
        const curF = this.xToFrame(mouseX);
        const delta = Math.round(curF - this.retimeStartFrame);
        if (delta !== 0) {
          this.moveSelectedKeys(delta);
          this.retimeStartFrame = curF;
        }
        return;
      }

      if (this.isMarquee) {
        this.marqueeEnd = { x: mouseX, y: mouseY };
        this.updateMarquee();
        this.drawCanvas();
      }
    });

    // Window Mouse Up
    window.addEventListener('mouseup', () => {
      this.isPanning = false;
      this.isDraggingPlayhead = false;
      this.isRetiming = false;
      this.isMarquee = false;
      canvas.style.cursor = 'default';
      this.drawCanvas();
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        this.deleteSelectedKeys();
      } else if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        this.duplicateSelectedKeys(1);
      }
    });
  }

  updateMarquee() {
    const left = Math.min(this.marqueeStart.x, this.marqueeEnd.x);
    const right = Math.max(this.marqueeStart.x, this.marqueeEnd.x);
    const top = Math.min(this.marqueeStart.y, this.marqueeEnd.y);
    const bottom = Math.max(this.marqueeStart.y, this.marqueeEnd.y);

    const fMin = this.xToFrame(left);
    const fMax = this.xToFrame(right);

    const rows = this.getVisibleRows();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.type !== 'channel') continue;

      const y = this.headerHeight + i * this.rowHeight;
      if (y + this.rowHeight >= top && y <= bottom) {
        for (const kf of r.keys) {
          if (kf >= fMin && kf <= fMax) {
            this.selectedKeys.add(`${r.nodeId}::${r.knobKey}::${kf}`);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // Layout Rendering
  // -------------------------------------------------------------

  render() {
    this.container.innerHTML = `
      <div class="dopesheet-wrapper">
        <div class="dopesheet-toolbar">
          <input type="text" id="dopesheet-filter" placeholder="Filter animated tracks..." class="dopesheet-filter-input" />
          <button class="btn-tool" id="btn-ds-duplicate" title="Duplicate Selected Keyframes (Ctrl+D)">⧉ Duplicate</button>
          <button class="btn-tool" id="btn-ds-delete" title="Delete Selected Keyframes (Delete)">⌫ Delete</button>
          <button class="btn-tool" id="btn-ds-fit" title="Fit View to Keyframes">Fit All</button>
        </div>
        <div class="dopesheet-body">
          <div class="dopesheet-tree-pane" id="dopesheet-tree"></div>
          <div class="dopesheet-canvas-pane">
            <canvas id="dopesheet-canvas" class="dopesheet-canvas"></canvas>
          </div>
        </div>
      </div>
    `;

    // Filter input
    const filterInput = this.container.querySelector('#dopesheet-filter');
    filterInput.addEventListener('input', (e) => {
      this.filterText = e.target.value;
      this.renderTree();
      this.drawCanvas();
    });

    // Toolbar buttons
    this.container.querySelector('#btn-ds-duplicate').addEventListener('click', () => this.duplicateSelectedKeys(1));
    this.container.querySelector('#btn-ds-delete').addEventListener('click', () => this.deleteSelectedKeys());
    this.container.querySelector('#btn-ds-fit').addEventListener('click', () => {
      let minF = Infinity, maxF = -Infinity;
      for (const n of this.nodes) {
        for (const ch of n.channels) {
          for (const f of ch.keys) {
            if (f < minF) minF = f;
            if (f > maxF) maxF = f;
          }
        }
      }
      if (minF !== Infinity) {
        const span = Math.max(10, maxF - minF);
        this.viewStart = Math.floor(minF - span * 0.1);
        this.viewEnd = Math.ceil(maxF + span * 0.1);
        this.drawCanvas();
      }
    });

    this.initEvents();
  }
}
