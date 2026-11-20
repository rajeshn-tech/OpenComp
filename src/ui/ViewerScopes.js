/**
 * OpenComp - Professional Interactive Viewer Scopes Engine (Phase 2)
 * High-performance Waveform, RGB Parade, Histogram, and Vectorscope computations.
 * Consumes real PixelBuffer image data with intelligent downsampling (<2ms execution),
 * supporting full-frame and Region-of-Interest (ROI) bounds.
 */

export class ViewerScopes {
  constructor(canvasElement = null) {
    this.canvas = canvasElement;
    this.ctx = canvasElement && typeof canvasElement.getContext === 'function' ? canvasElement.getContext('2d') : null;
    this.scopeType = 'waveform'; // 'waveform', 'parade', 'histogram', 'vectorscope', 'pixel_analyzer'
    this.enabled = false;
    this.intensity = 1.0;
    this.dockMode = 'overlay'; // 'overlay', 'docked'
    this.lastBuffer = null;
    this.lastRoi = null;
  }

  resize(width, height) {
    if (this.canvas) {
      this.canvas.width = Math.max(160, Math.round(width));
      this.canvas.height = Math.max(120, Math.round(height));
      if (this.enabled && this.lastBuffer) {
        this.render(this.lastBuffer, this.lastRoi);
      }
    }
  }

  setDockMode(mode) {
    if (['overlay', 'docked'].includes(mode)) {
      this.dockMode = mode;
    }
  }

  setCanvas(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement && typeof canvasElement.getContext === 'function' ? canvasElement.getContext('2d') : null;
  }

  setScopeType(type) {
    this.scopeType = type;
  }

  /**
   * Extract image samples inside bounds with downsampling
   * @param {import('../core/PixelBuffer.js').PixelBuffer} pixelBuffer
   * @param {{ x: number, y: number, width: number, height: number }|null} roi
   * @param {number} maxSamplesW
   * @param {number} maxSamplesH
   */
  sampleBuffer(pixelBuffer, roi = null, maxSamplesW = 320, maxSamplesH = 180) {
    if (!pixelBuffer || !pixelBuffer.data) return null;

    const imgW = pixelBuffer.width;
    const imgH = pixelBuffer.height;

    let startX = 0;
    let startY = 0;
    let endX = imgW;
    let endY = imgH;

    if (roi && roi.width > 0 && roi.height > 0) {
      startX = Math.max(0, Math.min(imgW - 1, Math.floor(roi.x)));
      startY = Math.max(0, Math.min(imgH - 1, Math.floor(roi.y)));
      endX = Math.max(startX + 1, Math.min(imgW, Math.floor(roi.x + roi.width)));
      endY = Math.max(startY + 1, Math.min(imgH, Math.floor(roi.y + roi.height)));
    }

    const regionW = endX - startX;
    const regionH = endY - startY;

    const stepX = Math.max(1, Math.floor(regionW / maxSamplesW));
    const stepY = Math.max(1, Math.floor(regionH / maxSamplesH));

    const sampleCols = Math.ceil(regionW / stepX);
    const sampleRows = Math.ceil(regionH / stepY);

    const rSamples = new Float32Array(sampleCols * sampleRows);
    const gSamples = new Float32Array(sampleCols * sampleRows);
    const bSamples = new Float32Array(sampleCols * sampleRows);
    const lumaSamples = new Float32Array(sampleCols * sampleRows);

    let idx = 0;
    const data = pixelBuffer.data;

    for (let sy = 0; sy < sampleRows; sy++) {
      const y = startY + sy * stepY;
      if (y >= endY) break;
      const rowOffset = y * imgW * 4;

      for (let sx = 0; sx < sampleCols; sx++) {
        const x = startX + sx * stepX;
        if (x >= endX) break;
        const pIdx = rowOffset + x * 4;

        const r = data[pIdx];
        const g = data[pIdx + 1];
        const b = data[pIdx + 2];
        const luma = 0.2126 * (Number.isFinite(r) ? r : 0) + 0.7152 * (Number.isFinite(g) ? g : 0) + 0.0722 * (Number.isFinite(b) ? b : 0);

        rSamples[idx] = r;
        gSamples[idx] = g;
        bSamples[idx] = b;
        lumaSamples[idx] = luma;
        idx++;
      }
    }

    return {
      sampleCols,
      sampleRows,
      count: idx,
      r: rSamples.subarray(0, idx),
      g: gSamples.subarray(0, idx),
      b: bSamples.subarray(0, idx),
      luma: lumaSamples.subarray(0, idx)
    };
  }

  /**
   * Compute Waveform Data (Intensity plot across columns)
   */
  computeWaveform(pixelBuffer, roi = null, numBins = 100) {
    const samples = this.sampleBuffer(pixelBuffer, roi);
    if (!samples) return null;

    const { sampleCols, sampleRows, r, g, b, luma } = samples;
    // 2D grid: [col][bin] = accumulated count
    const waveformGrid = new Float32Array(sampleCols * numBins);

    for (let c = 0; c < sampleCols; c++) {
      for (let row = 0; row < sampleRows; row++) {
        const i = row * sampleCols + c;
        if (i >= luma.length) break;
        const val = luma[i];
        const bin = Math.max(0, Math.min(numBins - 1, Math.floor(val * (numBins - 1))));
        waveformGrid[c * numBins + bin] += 1.0;
      }
    }

    return { sampleCols, numBins, grid: waveformGrid };
  }

  /**
   * Compute RGB Parade Data (3 separate waveforms for R, G, B)
   */
  computeParade(pixelBuffer, roi = null, numBins = 100) {
    const samples = this.sampleBuffer(pixelBuffer, roi, 160, 120);
    if (!samples) return null;

    const { sampleCols, sampleRows, r, g, b } = samples;
    const rGrid = new Float32Array(sampleCols * numBins);
    const gGrid = new Float32Array(sampleCols * numBins);
    const bGrid = new Float32Array(sampleCols * numBins);

    for (let c = 0; c < sampleCols; c++) {
      for (let row = 0; row < sampleRows; row++) {
        const i = row * sampleCols + c;
        if (i >= r.length) break;

        const binR = Math.max(0, Math.min(numBins - 1, Math.floor(r[i] * (numBins - 1))));
        const binG = Math.max(0, Math.min(numBins - 1, Math.floor(g[i] * (numBins - 1))));
        const binB = Math.max(0, Math.min(numBins - 1, Math.floor(b[i] * (numBins - 1))));

        rGrid[c * numBins + binR] += 1.0;
        gGrid[c * numBins + binG] += 1.0;
        bGrid[c * numBins + binB] += 1.0;
      }
    }

    return { sampleCols, numBins, r: rGrid, g: gGrid, b: bGrid };
  }

  /**
   * Compute Histogram Frequency Data (256 bins for R, G, B, Luma)
   */
  computeHistogram(pixelBuffer, roi = null) {
    const samples = this.sampleBuffer(pixelBuffer, roi);
    if (!samples) return null;

    const binsR = new Uint32Array(256);
    const binsG = new Uint32Array(256);
    const binsB = new Uint32Array(256);
    const binsLuma = new Uint32Array(256);

    const { count, r, g, b, luma } = samples;
    let maxFreq = 1;

    for (let i = 0; i < count; i++) {
      const idxR = Math.max(0, Math.min(255, Math.floor(r[i] * 255.0)));
      const idxG = Math.max(0, Math.min(255, Math.floor(g[i] * 255.0)));
      const idxB = Math.max(0, Math.min(255, Math.floor(b[i] * 255.0)));
      const idxL = Math.max(0, Math.min(255, Math.floor(luma[i] * 255.0)));

      binsR[idxR]++;
      binsG[idxG]++;
      binsB[idxB]++;
      binsLuma[idxL]++;

      if (binsR[idxR] > maxFreq) maxFreq = binsR[idxR];
      if (binsG[idxG] > maxFreq) maxFreq = binsG[idxG];
      if (binsB[idxB] > maxFreq) maxFreq = binsB[idxB];
      if (binsLuma[idxL] > maxFreq) maxFreq = binsLuma[idxL];
    }

    return { binsR, binsG, binsB, binsLuma, maxFreq, totalSamples: count };
  }

  /**
   * Compute Vectorscope Chrominance Polar Data
   */
  computeVectorscope(pixelBuffer, roi = null, maxPoints = 8000) {
    const samples = this.sampleBuffer(pixelBuffer, roi, 200, 150);
    if (!samples) return null;

    const { count, r, g, b } = samples;
    const stride = Math.max(1, Math.floor(count / maxPoints));
    const pointsCb = [];
    const pointsCr = [];

    for (let i = 0; i < count; i += stride) {
      const rVal = r[i];
      const gVal = g[i];
      const bVal = b[i];

      // ITU-R BT.709 / BT.601 Color Matrix (Cb / Cr)
      const cb = -0.168736 * rVal - 0.331264 * gVal + 0.500000 * bVal;
      const cr = 0.500000 * rVal - 0.418688 * gVal - 0.081312 * bVal;

      pointsCb.push(cb);
      pointsCr.push(cr);
    }

    // Standard 75% SMPTE color target coordinates
    const targets = {
      R: { cb: -0.1265, cr: 0.3750, name: 'R' },
      Mg: { cb: 0.2484, cr: 0.3140, name: 'Mg' },
      B: { cb: 0.3750, cr: -0.0610, name: 'B' },
      Cy: { cb: 0.1265, cr: -0.3750, name: 'Cy' },
      G: { cb: -0.2484, cr: -0.3140, name: 'G' },
      Yl: { cb: -0.3750, cr: 0.0610, name: 'Yl' }
    };

    return { pointsCb, pointsCr, targets, sampleCount: pointsCb.length };
  }

  /**
   * Render active scope onto canvas
   */
  render(pixelBuffer, roi = null) {
    this.lastBuffer = pixelBuffer;
    this.lastRoi = roi;
    if (!this.canvas || !this.ctx || !pixelBuffer) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Dark background
    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, w, h);

    switch (this.scopeType) {
      case 'parade':
        this.renderParade(ctx, w, h, pixelBuffer, roi);
        break;
      case 'histogram':
        this.renderHistogram(ctx, w, h, pixelBuffer, roi);
        break;
      case 'vectorscope':
        this.renderVectorscope(ctx, w, h, pixelBuffer, roi);
        break;
      case 'pixel_analyzer':
      case 'analyzer':
        this.renderPixelAnalyzer(ctx, w, h, pixelBuffer, roi);
        break;
      case 'waveform':
      default:
        this.renderWaveform(ctx, w, h, pixelBuffer, roi);
        break;
    }
  }

  renderWaveform(ctx, w, h, pixelBuffer, roi) {
    const pad = 24;
    const plotW = w - pad * 2;
    const plotH = h - pad * 2;

    // Draw Graticule Grid (0 IRE to 100 IRE)
    ctx.strokeStyle = '#282f3b';
    ctx.lineWidth = 1;
    ctx.font = '9px Inter, monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';

    const ireSteps = [0, 25, 50, 75, 100];
    for (const ire of ireSteps) {
      const y = pad + plotH - (ire / 100) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + plotW, y);
      ctx.stroke();
      ctx.fillText(`${ire}%`, pad - 4, y + 3);
    }

    const data = this.computeWaveform(pixelBuffer, roi, 100);
    if (!data) return;

    const { sampleCols, numBins, grid } = data;

    // Phosphor green trace
    ctx.fillStyle = 'rgba(74, 222, 128, 0.45)';
    for (let c = 0; c < sampleCols; c++) {
      const px = pad + (c / sampleCols) * plotW;
      for (let b = 0; b < numBins; b++) {
        const val = grid[c * numBins + b];
        if (val > 0) {
          const py = pad + plotH - (b / numBins) * plotH;
          ctx.fillRect(px, py, Math.max(1, plotW / sampleCols), 2);
        }
      }
    }

    // Title label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('WAVEFORM (LUMA)', pad, 14);
  }

  renderParade(ctx, w, h, pixelBuffer, roi) {
    const pad = 20;
    const plotH = h - pad * 2;
    const chW = (w - pad * 2) / 3;

    const data = this.computeParade(pixelBuffer, roi, 100);
    if (!data) return;

    const { sampleCols, numBins, r, g, b } = data;

    const channels = [
      { name: 'RED', grid: r, color: 'rgba(239, 68, 68, 0.55)', xOff: pad },
      { name: 'GREEN', grid: g, color: 'rgba(34, 197, 94, 0.55)', xOff: pad + chW },
      { name: 'BLUE', grid: b, color: 'rgba(59, 130, 246, 0.55)', xOff: pad + chW * 2 }
    ];

    // Graticules
    ctx.strokeStyle = '#262d38';
    ctx.lineWidth = 1;
    for (const ch of channels) {
      for (const pct of [0, 50, 100]) {
        const y = pad + plotH - (pct / 100) * plotH;
        ctx.beginPath();
        ctx.moveTo(ch.xOff, y);
        ctx.lineTo(ch.xOff + chW - 4, y);
        ctx.stroke();
      }

      ctx.fillStyle = ch.color;
      for (let c = 0; c < sampleCols; c++) {
        const px = ch.xOff + (c / sampleCols) * (chW - 6);
        for (let bin = 0; bin < numBins; bin++) {
          const val = ch.grid[c * numBins + bin];
          if (val > 0) {
            const py = pad + plotH - (bin / numBins) * plotH;
            ctx.fillRect(px, py, Math.max(1, chW / sampleCols), 2);
          }
        }
      }

      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(ch.name, ch.xOff + 4, 14);
    }
  }

  renderHistogram(ctx, w, h, pixelBuffer, roi) {
    const pad = 24;
    const plotW = w - pad * 2;
    const plotH = h - pad * 2;

    const data = this.computeHistogram(pixelBuffer, roi);
    if (!data) return;

    const { binsR, binsG, binsB, maxFreq } = data;

    // Grid
    ctx.strokeStyle = '#222834';
    ctx.lineWidth = 1;
    for (const pct of [0, 25, 50, 75, 100]) {
      const y = pad + plotH - (pct / 100) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + plotW, y);
      ctx.stroke();
    }

    const drawCurve = (bins, strokeColor, fillColor) => {
      ctx.beginPath();
      ctx.moveTo(pad, pad + plotH);
      for (let i = 0; i < 256; i++) {
        const x = pad + (i / 255) * plotW;
        const normY = Math.min(1.0, bins[i] / maxFreq);
        const y = pad + plotH - normY * plotH;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(pad + plotW, pad + plotH);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };

    drawCurve(binsB, 'rgba(59, 130, 246, 0.8)', 'rgba(59, 130, 246, 0.15)');
    drawCurve(binsG, 'rgba(34, 197, 94, 0.8)', 'rgba(34, 197, 94, 0.15)');
    drawCurve(binsR, 'rgba(239, 68, 68, 0.8)', 'rgba(239, 68, 68, 0.15)');

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('HISTOGRAM (RGB)', pad, 14);
  }

  renderVectorscope(ctx, w, h, pixelBuffer, roi) {
    const cx = w * 0.5;
    const cy = h * 0.5 + 4;
    const radius = Math.min(w, h) * 0.40;

    // Draw Graticule
    ctx.strokeStyle = '#2c3645';
    ctx.lineWidth = 1;

    // Outer & 75% saturation circles
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.75, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();

    // Skin Tone / I-Axis Line (~57 deg or 123 deg)
    const skinAngle = 123 * (Math.PI / 180);
    ctx.strokeStyle = '#92400e';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(skinAngle) * radius, cy - Math.sin(skinAngle) * radius);
    ctx.stroke();

    const data = this.computeVectorscope(pixelBuffer, roi);
    if (!data) return;

    // Draw Color Targets (R, Mg, B, Cy, G, Yl)
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    for (const [key, t] of Object.entries(data.targets)) {
      const tx = cx + t.cb * 2.0 * radius;
      const ty = cy - t.cr * 2.0 * radius;
      ctx.strokeStyle = '#f59e0b';
      ctx.strokeRect(tx - 4, ty - 4, 8, 8);
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(key, tx, ty - 6);
    }

    // Draw Chrominance Trace (Cyan phosphor)
    ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
    const { pointsCb, pointsCr } = data;
    for (let i = 0; i < pointsCb.length; i++) {
      const px = cx + pointsCb[i] * 2.0 * radius;
      const py = cy - pointsCr[i] * 2.0 * radius;
      ctx.fillRect(px, py, 1.5, 1.5);
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('VECTORSCOPE', 16, 16);
  }

  /**
   * Compute comprehensive statistical image analysis metrics
   */
  computePixelAnalyzer(pixelBuffer, roi = null) {
    const samples = this.sampleBuffer(pixelBuffer, roi, 320, 180);
    if (!samples || samples.count === 0) return null;

    const { count, r, g, b, luma } = samples;
    let minR = Infinity, maxR = -Infinity, sumR = 0;
    let minG = Infinity, maxG = -Infinity, sumG = 0;
    let minB = Infinity, maxB = -Infinity, sumB = 0;
    let minLuma = Infinity, maxLuma = -Infinity, sumLuma = 0;
    let sumSqLuma = 0;

    let nanCount = 0;
    let infCount = 0;
    let negCount = 0;
    let clipHighCount = 0;
    let clipLowCount = 0;

    for (let i = 0; i < count; i++) {
      const rVal = r[i];
      const gVal = g[i];
      const bVal = b[i];
      const lVal = luma[i];

      if (Number.isNaN(rVal) || Number.isNaN(gVal) || Number.isNaN(bVal)) {
        nanCount++;
        continue;
      }
      if (!Number.isFinite(rVal) || !Number.isFinite(gVal) || !Number.isFinite(bVal)) {
        infCount++;
        continue;
      }
      if (rVal < 0 || gVal < 0 || bVal < 0) {
        negCount++;
      }
      if (rVal > 1.0 || gVal > 1.0 || bVal > 1.0) {
        clipHighCount++;
      }
      if (rVal <= 0.0 && gVal <= 0.0 && bVal <= 0.0) {
        clipLowCount++;
      }

      if (rVal < minR) minR = rVal;
      if (rVal > maxR) maxR = rVal;
      sumR += rVal;

      if (gVal < minG) minG = gVal;
      if (gVal > maxG) maxG = gVal;
      sumG += gVal;

      if (bVal < minB) minB = bVal;
      if (bVal > maxB) maxB = bVal;
      sumB += bVal;

      if (lVal < minLuma) minLuma = lVal;
      if (lVal > maxLuma) maxLuma = lVal;
      sumLuma += lVal;
      sumSqLuma += lVal * lVal;
    }

    const validCount = count - nanCount - infCount;
    if (validCount <= 0) {
      return { count, nanCount, infCount, negCount, clipHighCount, clipLowCount, valid: false };
    }

    const avgR = sumR / validCount;
    const avgG = sumG / validCount;
    const avgB = sumB / validCount;
    const avgLuma = sumLuma / validCount;

    const variance = Math.max(0, (sumSqLuma / validCount) - (avgLuma * avgLuma));
    const stdDev = Math.sqrt(variance);

    const safeMin = Math.max(0.0001, minLuma);
    const safeMax = Math.max(safeMin, maxLuma);
    const dynamicRangeEV = Math.log2(safeMax / safeMin);

    return {
      count,
      validCount,
      minR: isFinite(minR) ? minR : 0,
      maxR: isFinite(maxR) ? maxR : 0,
      avgR,
      minG: isFinite(minG) ? minG : 0,
      maxG: isFinite(maxG) ? maxG : 0,
      avgG,
      minB: isFinite(minB) ? minB : 0,
      maxB: isFinite(maxB) ? maxB : 0,
      avgB,
      minLuma: isFinite(minLuma) ? minLuma : 0,
      maxLuma: isFinite(maxLuma) ? maxLuma : 0,
      avgLuma,
      stdDev,
      dynamicRangeEV,
      nanCount,
      infCount,
      negCount,
      clipHighCount,
      clipLowCount,
      clipHighPct: (clipHighCount / count) * 100,
      clipLowPct: (clipLowCount / count) * 100,
      valid: true
    };
  }

  renderPixelAnalyzer(ctx, w, h, pixelBuffer, roi) {
    const data = this.computePixelAnalyzer(pixelBuffer, roi);
    if (!data) return;

    const pad = 12;
    ctx.save();

    // Header
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'left';
    const roiTag = (roi && roi.width > 0) ? ` (ROI: ${Math.round(roi.width)}x${Math.round(roi.height)})` : ' (FULL FRAME)';
    ctx.fillText(`PIXEL ANALYZER${roiTag}`, pad, 14);

    // Channel Metrics Table
    const tableTop = 26;
    const rowH = 18;
    const colNameX = pad;
    const colMinX = pad + 45;
    const colMaxX = pad + 105;
    const colAvgX = pad + 165;
    const barX = pad + 225;
    const barW = Math.max(40, w - barX - pad);

    // Table Header
    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.fillText('CHAN', colNameX, tableTop + 8);
    ctx.fillText('MIN', colMinX, tableTop + 8);
    ctx.fillText('MAX', colMaxX, tableTop + 8);
    ctx.fillText('AVG', colAvgX, tableTop + 8);
    ctx.fillText('RANGE BAR', barX, tableTop + 8);

    const rows = [
      { name: 'Red', min: data.minR, max: data.maxR, avg: data.avgR, color: '#ef4444' },
      { name: 'Green', min: data.minG, max: data.maxG, avg: data.avgG, color: '#22c55e' },
      { name: 'Blue', min: data.minB, max: data.maxB, avg: data.avgB, color: '#3b82f6' },
      { name: 'Luma', min: data.minLuma, max: data.maxLuma, avg: data.avgLuma, color: '#f8fafc' }
    ];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const y = tableTop + 14 + i * rowH;

      ctx.fillStyle = r.color;
      ctx.font = 'bold 9px monospace';
      ctx.fillText(r.name, colNameX, y + 10);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '9px monospace';
      ctx.fillText(r.min.toFixed(3), colMinX, y + 10);
      ctx.fillText(r.max.toFixed(3), colMaxX, y + 10);
      ctx.fillText(r.avg.toFixed(3), colAvgX, y + 10);

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(barX, y + 2, barW, 10);

      const maxScale = Math.max(1.0, data.maxLuma, data.maxR, data.maxG, data.maxB);
      const bMinX = barX + Math.max(0, Math.min(barW, (Math.max(0, r.min) / maxScale) * barW));
      const bMaxX = barX + Math.max(0, Math.min(barW, (Math.max(0, r.max) / maxScale) * barW));
      const bW = Math.max(2, bMaxX - bMinX);

      ctx.fillStyle = r.color;
      ctx.fillRect(bMinX, y + 2, bW, 10);

      const bAvgX = barX + Math.max(0, Math.min(barW, (Math.max(0, r.avg) / maxScale) * barW));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(bAvgX - 1, y + 1, 2, 12);
    }

    const divY = tableTop + 16 + rows.length * rowH;
    ctx.strokeStyle = '#282f3b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, divY);
    ctx.lineTo(w - pad, divY);
    ctx.stroke();

    const statY = divY + 14;
    const colW = (w - pad * 2) / 3;

    ctx.fillStyle = '#64748b';
    ctx.font = '8px Inter, sans-serif';
    ctx.fillText('DYNAMIC RANGE', pad, statY);
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`${data.dynamicRangeEV.toFixed(1)} EV`, pad, statY + 14);

    ctx.fillStyle = '#64748b';
    ctx.font = '8px Inter, sans-serif';
    ctx.fillText('RMS CONTRAST', pad + colW, statY);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`${data.stdDev.toFixed(3)}`, pad + colW, statY + 14);

    ctx.fillStyle = '#64748b';
    ctx.font = '8px Inter, sans-serif';
    ctx.fillText('CLIPPED (>1.0)', pad + colW * 2, statY);
    ctx.fillStyle = data.clipHighCount > 0 ? '#f43f5e' : '#10b981';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`${data.clipHighPct.toFixed(1)}% (${data.clipHighCount})`, pad + colW * 2, statY + 14);

    const badgeY = statY + 34;
    ctx.font = '9px monospace';

    ctx.fillStyle = data.nanCount === 0 ? '#10b981' : '#ef4444';
    ctx.fillText(`NaN: ${data.nanCount}`, pad, badgeY);

    ctx.fillStyle = data.infCount === 0 ? '#10b981' : '#ef4444';
    ctx.fillText(`Inf: ${data.infCount}`, pad + colW, badgeY);

    ctx.fillStyle = data.negCount === 0 ? '#10b981' : '#f59e0b';
    ctx.fillText(`Negative: ${data.negCount}`, pad + colW * 2, badgeY);

    ctx.restore();
  }
}
