/**
 * OpenComp - Image Metadata & AOV Inspector (MetadataUI)
 * Comprehensive inspection engine for OpenEXR header attributes and multi-channel AOVs:
 * - Technical format summary: Dimensions, Aspect Ratio, Bit Depth, Color Space, Compression
 * - Layer & Channel Hierarchy: RGBA, depth.Z, normal.XYZ, motion vectors, Cryptomatte, custom AOVs
 * - One-click channel isolation on the Viewer
 * - Real-time metadata key/value filter and copy-to-clipboard
 * - Support for both contiguous 2D PixelBuffers and multi-sample DeepPixelBuffers
 */

export class MetadataUI {
  /**
   * @param {HTMLElement} containerElement DOM container (e.g. #metadata-wrapper)
   * @param {Object} viewerUI Active ViewerUI instance
   * @param {Object} [options={}]
   */
  constructor(containerElement, viewerUI = null, options = {}) {
    this.container = containerElement;
    this.viewerUI = viewerUI;
    this.currentBuffer = null;
    this.searchFilter = '';

    this.render();
  }

  setBuffer(buffer, triggerRender = true) {
    this.currentBuffer = buffer;
    if (triggerRender) {
      this.render();
    }
  }

  setFilter(query) {
    this.searchFilter = (query || '').toLowerCase().trim();
    this.updateTableRows();
  }

  isolateChannel(channelName) {
    if (this.viewerUI && typeof this.viewerUI.setAOVChannel === 'function') {
      this.viewerUI.setAOVChannel(channelName);
    }
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="metadata-inspector-panel">
        <div class="metadata-header">
          <div class="metadata-title-group">
            <span class="meta-icon">📋</span>
            <span class="meta-title">Image Metadata &amp; AOV Inspector</span>
          </div>

          <div class="metadata-toolbar-actions">
            <div class="meta-search-box">
              <input type="text" id="metadata-filter-input" placeholder="Search metadata keys/values (e.g. compression, focal, Z)..." value="${this.searchFilter}" />
              <button id="btn-clear-meta-filter" class="btn-tool-sm" title="Clear filter">✕</button>
            </div>
            <button class="btn-tool" id="btn-copy-metadata" title="Copy all metadata to clipboard">📋 Copy All</button>
          </div>
        </div>

        <div class="metadata-body">
          <!-- Top Technical Format Card -->
          <div class="metadata-card technical-card">
            <div class="card-title">Technical Format &amp; Specifications</div>
            <div class="tech-grid" id="meta-tech-grid">
              <div class="tech-item"><span class="tech-label">Format:</span> <b id="tech-res" class="font-mono">-</b></div>
              <div class="tech-item"><span class="tech-label">Aspect Ratio:</span> <b id="tech-aspect" class="font-mono">-</b></div>
              <div class="tech-item"><span class="tech-label">Bit Depth:</span> <b id="tech-bitdepth" class="font-mono">-</b></div>
              <div class="tech-item"><span class="tech-label">Buffer Type:</span> <b id="tech-buffertype" class="font-mono">-</b></div>
              <div class="tech-item"><span class="tech-label">Color Space:</span> <b id="tech-colorspace" class="font-mono">-</b></div>
              <div class="tech-item"><span class="tech-label">Compression:</span> <b id="tech-compression" class="font-mono">-</b></div>
              <div class="tech-item"><span class="tech-label">Data Window:</span> <b id="tech-datawindow" class="font-mono">-</b></div>
              <div class="tech-item"><span class="tech-label">Memory:</span> <b id="tech-memory" class="font-mono">-</b></div>
            </div>
          </div>

          <!-- Channel & Layer Hierarchy -->
          <div class="metadata-card channels-card">
            <div class="card-title">
              <span>Channel &amp; AOV Hierarchy</span>
              <span class="meta-badge" id="meta-channel-count-badge">0 Channels</span>
            </div>
            <div class="channels-list" id="meta-channels-container">
              <div class="empty-state">No image buffer loaded. Connect a node to view channels.</div>
            </div>
          </div>

          <!-- Raw Header Attributes Table -->
          <div class="metadata-card header-card">
            <div class="card-title">
              <span>OpenEXR Header Attributes</span>
              <span class="meta-badge" id="meta-attr-count-badge">0 Attributes</span>
            </div>
            <div class="attributes-table-wrapper">
              <table class="metadata-table">
                <thead>
                  <tr>
                    <th style="width: 32%;">Attribute Key</th>
                    <th style="width: 22%;">Type</th>
                    <th style="width: 46%;">Value</th>
                  </tr>
                </thead>
                <tbody id="metadata-attributes-rows">
                  <tr><td colspan="3" class="empty-state">No metadata available.</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;

    this.initEventListeners();
    this.updateInspectorContent();
  }

  initEventListeners() {
    const filterInput = this.container.querySelector('#metadata-filter-input');
    const clearBtn = this.container.querySelector('#btn-clear-meta-filter');
    const copyBtn = this.container.querySelector('#btn-copy-metadata');

    filterInput?.addEventListener('input', (e) => {
      this.setFilter(e.target.value);
    });

    clearBtn?.addEventListener('click', () => {
      if (filterInput) filterInput.value = '';
      this.setFilter('');
    });

    copyBtn?.addEventListener('click', () => {
      this.copyMetadata();
    });
  }

  updateInspectorContent() {
    if (!this.container) return;

    const buf = this.currentBuffer;
    const resEl = this.container.querySelector('#tech-res');
    const aspectEl = this.container.querySelector('#tech-aspect');
    const bitDepthEl = this.container.querySelector('#tech-bitdepth');
    const typeEl = this.container.querySelector('#tech-buffertype');
    const colorEl = this.container.querySelector('#tech-colorspace');
    const compEl = this.container.querySelector('#tech-compression');
    const dwEl = this.container.querySelector('#tech-datawindow');
    const memEl = this.container.querySelector('#tech-memory');
    const chanBadge = this.container.querySelector('#meta-channel-count-badge');
    const chanContainer = this.container.querySelector('#meta-channels-container');

    if (!buf) {
      if (resEl) resEl.textContent = '-';
      if (aspectEl) aspectEl.textContent = '-';
      if (bitDepthEl) bitDepthEl.textContent = '-';
      if (typeEl) typeEl.textContent = 'None';
      if (colorEl) colorEl.textContent = '-';
      if (compEl) compEl.textContent = '-';
      if (dwEl) dwEl.textContent = '-';
      if (memEl) memEl.textContent = '-';
      if (chanBadge) chanBadge.textContent = '0 Channels';
      if (chanContainer) chanContainer.innerHTML = `<div class="empty-state">No image buffer loaded. Connect a node to view channels.</div>`;
      this.updateTableRows();
      return;
    }

    const isDeep = !!(buf.isDeep || buf.sampleOffsets);
    const w = buf.width || 1920;
    const h = buf.height || 1080;
    const aspect = (w / Math.max(1, h)).toFixed(3);

    if (resEl) resEl.textContent = `${w} x ${h}`;
    if (aspectEl) aspectEl.textContent = `${aspect}:1`;
    if (bitDepthEl) bitDepthEl.textContent = '32-bit Float (IEEE 754)';
    if (typeEl) typeEl.textContent = isDeep ? 'DeepScanLine (Volumetric)' : (buf.isTiled ? 'Tiled PixelBuffer' : 'ScanLine (2D Planar)');
    if (colorEl) colorEl.textContent = this.viewerUI?.workingSpace || 'ACEScg / Linear';

    const meta = buf.metadata || {};
    let compText = isDeep ? 'ZIPS (zlib)' : 'ZIP (zlib)';
    if (meta.compression !== undefined && meta.compression !== null) {
      if (typeof meta.compression === 'number') {
        const compNames = ['NONE (uncompressed)', 'RLE', 'ZIPS (1 scanline)', 'ZIP (16 scanlines)', 'PIZ', 'PXR24', 'B44', 'B44A', 'DWAA', 'DWAB'];
        compText = compNames[meta.compression] || `Type ${meta.compression}`;
      } else {
        compText = String(meta.compression).toUpperCase();
      }
    }
    if (compEl) compEl.textContent = compText;

    const dw = meta.dataWindow || (buf.bbox ? { xMin: buf.bbox.minX, yMin: buf.bbox.minY, xMax: buf.bbox.maxX, yMax: buf.bbox.maxY } : { xMin: 0, yMin: 0, xMax: w - 1, yMax: h - 1 });
    if (dwEl) dwEl.textContent = `[${dw.xMin}, ${dw.yMin}] - [${dw.xMax}, ${dw.yMax}]`;

    // Calculate approx memory footprint
    let memBytes = 0;
    if (isDeep) {
      memBytes = (buf.sampleOffsets?.byteLength || 0) + (buf.sampleData?.byteLength || 0);
    } else if (buf.data) {
      memBytes = buf.data.byteLength;
      if (buf.extraChannels) {
        for (const ch of Object.values(buf.extraChannels)) {
          if (ch && ch.byteLength) memBytes += ch.byteLength;
        }
      }
    }
    const memMb = (memBytes / (1024 * 1024)).toFixed(2);
    if (memEl) memEl.textContent = `${memMb} MB`;

    // Collect and group channels
    let channelNames = [];
    if (isDeep) {
      channelNames = buf.channels || ['Z', 'ZBack', 'R', 'G', 'B', 'A'];
    } else if (typeof buf.getChannelNames === 'function') {
      channelNames = buf.getChannelNames();
    } else {
      channelNames = ['R', 'G', 'B', 'A'];
    }

    if (chanBadge) chanBadge.textContent = `${channelNames.length} Channel${channelNames.length === 1 ? '' : 's'}`;

    // Group into layers (e.g. 'rgba', 'depth', 'normal', 'motion', 'crypto')
    const layers = {};
    for (const name of channelNames) {
      const parts = name.split('.');
      const layerName = parts.length > 1 ? parts[0] : (['R', 'G', 'B', 'A', 'r', 'g', 'b', 'a'].includes(name) ? 'rgba' : 'other');
      const subName = parts.length > 1 ? parts.slice(1).join('.') : name;
      if (!layers[layerName]) layers[layerName] = [];
      layers[layerName].push({ full: name, sub: subName });
    }

    if (chanContainer) {
      let chanHtml = '';
      for (const [layer, chList] of Object.entries(layers)) {
        chanHtml += `
          <div class="channel-layer-group">
            <div class="layer-header">
              <span class="layer-icon">📁</span>
              <span class="layer-name">${layer.toUpperCase()}</span>
              <span class="layer-count">(${chList.length})</span>
            </div>
            <div class="channel-pills">
        `;

        for (const ch of chList) {
          chanHtml += `
            <div class="channel-pill" title="Channel: ${ch.full}">
              <span class="channel-name">${ch.full}</span>
              <span class="channel-type">FLOAT</span>
              <button class="btn-isolate-ch" data-channel="${ch.full}" title="Isolate ${ch.full} on Viewer">👁️</button>
            </div>
          `;
        }

        chanHtml += `</div></div>`;
      }
      chanContainer.innerHTML = chanHtml;

      // Wire isolate buttons
      const isoBtns = chanContainer.querySelectorAll('.btn-isolate-ch');
      isoBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          this.isolateChannel(btn.dataset.channel);
        });
      });
    }

    this.updateTableRows();
  }

  getHeaderAttributes() {
    if (!this.currentBuffer) return [];
    const buf = this.currentBuffer;
    const meta = buf.metadata || {};
    const attributes = [];

    attributes.push({ key: 'opencomp/format', type: 'string', value: `${buf.width}x${buf.height}` });
    attributes.push({ key: 'opencomp/bitDepth', type: 'string', value: '32-bit Float Linear' });
    attributes.push({ key: 'opencomp/isDeep', type: 'boolean', value: String(!!(buf.isDeep || buf.sampleOffsets)) });

    if (buf.isDeep || buf.sampleOffsets) {
      attributes.push({ key: 'deep/totalSamples', type: 'int', value: String(buf.totalSamples || 0) });
      attributes.push({ key: 'deep/partType', type: 'string', value: 'deepscanline' });
      attributes.push({ key: 'deep/version', type: 'int', value: '1' });
    }

    for (const [k, v] of Object.entries(meta)) {
      if (k === 'channels') {
        const chanStr = Array.isArray(v) ? v.map(c => c.name || c).join(', ') : JSON.stringify(v);
        attributes.push({ key: 'channels', type: 'chlist', value: chanStr });
      } else if (typeof v === 'object' && v !== null) {
        attributes.push({ key: k, type: 'box2i / struct', value: JSON.stringify(v) });
      } else {
        attributes.push({ key: k, type: typeof v, value: String(v) });
      }
    }

    return attributes;
  }

  updateTableRows() {
    const rowsBody = this.container?.querySelector('#metadata-attributes-rows');
    const attrBadge = this.container?.querySelector('#meta-attr-count-badge');
    if (!rowsBody) return;

    if (!this.currentBuffer) {
      rowsBody.innerHTML = `<tr><td colspan="3" class="empty-state">No metadata available.</td></tr>`;
      if (attrBadge) attrBadge.textContent = '0 Attributes';
      return;
    }

    const attributes = this.getHeaderAttributes();

    // Filter attributes
    const q = this.searchFilter;
    const filtered = q ? attributes.filter(a => a.key.toLowerCase().includes(q) || a.value.toLowerCase().includes(q) || a.type.toLowerCase().includes(q)) : attributes;

    if (attrBadge) attrBadge.textContent = `${filtered.length} Attribute${filtered.length === 1 ? '' : 's'}`;

    if (filtered.length === 0) {
      rowsBody.innerHTML = `<tr><td colspan="3" class="empty-state">No attributes match search query "${this.searchFilter}".</td></tr>`;
      return;
    }

    let html = '';
    for (const attr of filtered) {
      html += `
        <tr>
          <td class="col-key font-mono">${attr.key}</td>
          <td class="col-type font-mono">${attr.type}</td>
          <td class="col-val font-mono">${attr.value}</td>
        </tr>
      `;
    }
    rowsBody.innerHTML = html;
  }

  copyMetadata() {
    if (!this.currentBuffer) return;
    const meta = {
      technical: {
        width: this.currentBuffer.width,
        height: this.currentBuffer.height,
        isDeep: !!(this.currentBuffer.isDeep || this.currentBuffer.sampleOffsets),
        channels: typeof this.currentBuffer.getChannelNames === 'function' ? this.currentBuffer.getChannelNames() : (this.currentBuffer.channels || ['R', 'G', 'B', 'A'])
      },
      header: this.currentBuffer.metadata || {}
    };
    const jsonStr = JSON.stringify(meta, null, 2);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(jsonStr).then(() => {
        alert('Image metadata copied to clipboard!');
      }).catch(() => {});
    }
  }
}

