/**
 * OpenComp - Viewer Overlays, Safe Areas, Guides & ROI Manager (Phase 2)
 * Manages non-destructive viewport guides, safe title/action areas,
 * rule-of-thirds, grid, pinned pixel sampler target, and interactive ROI.
 */

export class ViewerOverlay {
  constructor() {
    this.guides = {
      actionSafe: false,
      titleSafe: false,
      centerCross: false,
      centerMarks: false,
      ruleOfThirds: false,
      grid: false,
      format16_9: false,
      format1_85: false,
      format2_39: false,
      format4_3: false,
      format1_1: false,
      format9_16: false
    };

    this.formatMaskOpacity = 0.45;

    this.roi = {
      enabled: false,
      x: 0,
      y: 0,
      width: 0,
      height: 0
    };

    this.pinnedSample = {
      pinned: false,
      x: 0,
      y: 0
    };

    this.activeDragHandle = null; // 'nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w', 'move', 'create'
    this.dragStartPos = null;
  }

  setGuide(name, enabled) {
    if (name in this.guides) {
      this.guides[name] = !!enabled;
    }
  }

  setAllGuides(enabled) {
    for (const k of Object.keys(this.guides)) {
      this.guides[k] = !!enabled;
    }
  }

  setGuideMode(mode) {
    this.guideMode = mode;
    this.setAllGuides(false);
    if (mode === 'action_safe') {
      this.setGuide('actionSafe', true);
    } else if (mode === 'title_safe') {
      this.setGuide('titleSafe', true);
    } else if (mode === 'all_safe') {
      this.setGuide('actionSafe', true);
      this.setGuide('titleSafe', true);
    } else if (mode === 'center_cross') {
      this.setGuide('centerCross', true);
    } else if (mode === 'center_marks') {
      this.setGuide('centerCross', true);
    } else if (mode === 'rule_thirds') {
      this.setGuide('ruleOfThirds', true);
    } else if (mode === 'grid') {
      this.setGuide('grid', true);
    } else if (mode === 'format_16_9' || mode === '16:9') {
      this.setGuide('format16_9', true);
    } else if (mode === 'format_1_85' || mode === '1.85:1') {
      this.setGuide('format1_85', true);
    } else if (mode === 'format_2_39' || mode === '2.39:1' || mode === 'scope') {
      this.setGuide('format2_39', true);
    } else if (mode === 'format_4_3' || mode === '4:3') {
      this.setGuide('format4_3', true);
    } else if (mode === 'format_1_1' || mode === '1:1') {
      this.setGuide('format1_1', true);
    } else if (mode === 'format_9_16' || mode === '9:16') {
      this.setGuide('format9_16', true);
    } else if (mode === 'all') {
      this.setAllGuides(true);
    }
  }

  getFormatGuideRect(imgW, imgH, targetAspect) {
    const currentAspect = imgW / imgH;
    let w = imgW;
    let h = imgH;
    let x = 0;
    let y = 0;

    if (currentAspect > targetAspect) {
      // Pillarbox (image is wider than format)
      w = Math.round(imgH * targetAspect);
      x = Math.round((imgW - w) * 0.5);
    } else {
      // Letterbox (image is taller than format)
      h = Math.round(imgW / targetAspect);
      y = Math.round((imgH - h) * 0.5);
    }
    return { x, y, width: w, height: h };
  }

  getActionSafeRect(imgW, imgH) {
    const marginX = Math.round(imgW * 0.05);
    const marginY = Math.round(imgH * 0.05);
    return { x: marginX, y: marginY, width: imgW - marginX * 2, height: imgH - marginY * 2 };
  }

  getTitleSafeRect(imgW, imgH) {
    const marginX = Math.round(imgW * 0.10);
    const marginY = Math.round(imgH * 0.10);
    return { x: marginX, y: marginY, width: imgW - marginX * 2, height: imgH - marginY * 2 };
  }

  setROI(xOrObj, y, w, h) {
    this.roi.enabled = true;
    if (typeof xOrObj === 'object' && xOrObj !== null) {
      this.roi.x = Math.round(xOrObj.x || 0);
      this.roi.y = Math.round(xOrObj.y || 0);
      this.roi.width = Math.round(xOrObj.width !== undefined ? xOrObj.width : (xOrObj.w || 0));
      this.roi.height = Math.round(xOrObj.height !== undefined ? xOrObj.height : (xOrObj.h || 0));
      return;
    }
    this.roi.x = Math.round(xOrObj);
    this.roi.y = Math.round(y);
    this.roi.width = Math.round(w);
    this.roi.height = Math.round(h);
  }

  hasROI() {
    return !!(this.roi && this.roi.enabled && this.roi.width > 0 && this.roi.height > 0);
  }

  getROI() {
    if (!this.hasROI()) return null;
    return { x: this.roi.x, y: this.roi.y, width: this.roi.width, height: this.roi.height };
  }

  moveROI(dx, dy) {
    if (!this.hasROI()) return;
    this.roi.x += Math.round(dx);
    this.roi.y += Math.round(dy);
  }

  resizeROI(handle, dx, dy) {
    if (!this.hasROI()) return;
    dx = Math.round(dx);
    dy = Math.round(dy);
    if (handle.includes('e')) this.roi.width = Math.max(10, this.roi.width + dx);
    if (handle.includes('s')) this.roi.height = Math.max(10, this.roi.height + dy);
    if (handle.includes('w')) {
      const newW = Math.max(10, this.roi.width - dx);
      this.roi.x += (this.roi.width - newW);
      this.roi.width = newW;
    }
    if (handle.includes('n')) {
      const newH = Math.max(10, this.roi.height - dy);
      this.roi.y += (this.roi.height - newH);
      this.roi.height = newH;
    }
  }

  clampROI(maxW, maxH) {
    if (!this.hasROI()) return;
    this.roi.x = Math.max(0, Math.min(maxW - 10, this.roi.x));
    this.roi.y = Math.max(0, Math.min(maxH - 10, this.roi.y));
    this.roi.width = Math.min(maxW - this.roi.x, Math.max(10, this.roi.width));
    this.roi.height = Math.min(maxH - this.roi.y, Math.max(10, this.roi.height));
  }

  clearROI() {
    this.roi.enabled = false;
    this.roi.x = 0;
    this.roi.y = 0;
    this.roi.width = 0;
    this.roi.height = 0;
  }

  setPinnedSample(x, y) {
    this.pinnedSample.pinned = true;
    this.pinnedSample.x = Math.round(x);
    this.pinnedSample.y = Math.round(y);
  }

  getPinnedSample() {
    return (this.pinnedSample && this.pinnedSample.pinned) ? { x: this.pinnedSample.x, y: this.pinnedSample.y } : null;
  }

  clearPinnedSample() {
    this.pinnedSample.pinned = false;
  }

  screenToImage(sx, sy, zoom, panX, panY) {
    return {
      x: (sx - panX) / zoom,
      y: (sy - panY) / zoom
    };
  }

  imageToScreen(ix, iy, zoom, panX, panY) {
    return {
      x: ix * zoom + panX,
      y: iy * zoom + panY
    };
  }

  /**
   * Render all enabled overlays on the 2D canvas context
   */
  renderOverlays(ctx, imgW, imgH, zoom, panX, panY, options = {}) {
    if (!ctx || !imgW || !imgH) return;

    const imgTopLeft = this.imageToScreen(0, 0, zoom, panX, panY);
    const screenW = imgW * zoom;
    const screenH = imgH * zoom;

    ctx.save();

    // 0. Format Guides / Aspect Ratio Masks
    if (this.guides.format16_9) this.drawFormatGuide(ctx, imgTopLeft.x, imgTopLeft.y, screenW, screenH, imgW, imgH, 16 / 9, '16:9 (1.78:1)');
    if (this.guides.format1_85) this.drawFormatGuide(ctx, imgTopLeft.x, imgTopLeft.y, screenW, screenH, imgW, imgH, 1.85, '1.85:1 FLAT');
    if (this.guides.format2_39) this.drawFormatGuide(ctx, imgTopLeft.x, imgTopLeft.y, screenW, screenH, imgW, imgH, 2.39, '2.39:1 SCOPE');
    if (this.guides.format4_3) this.drawFormatGuide(ctx, imgTopLeft.x, imgTopLeft.y, screenW, screenH, imgW, imgH, 4 / 3, '4:3 ACADEMY');
    if (this.guides.format1_1) this.drawFormatGuide(ctx, imgTopLeft.x, imgTopLeft.y, screenW, screenH, imgW, imgH, 1.0, '1:1 SQUARE');
    if (this.guides.format9_16) this.drawFormatGuide(ctx, imgTopLeft.x, imgTopLeft.y, screenW, screenH, imgW, imgH, 9 / 16, '9:16 VERTICAL');

    // 0.1 Zoom-Dependent Pixel Grid
    if (zoom >= 8.0) {
      this.drawPixelGrid(ctx, imgW, imgH, zoom, panX, panY, options.hoveredPixel, options.buffer);
    }

    // 1. Grid
    if (this.guides.grid) {
      this.drawGrid(ctx, imgW, imgH, zoom, panX, panY);
    }

    // 2. Rule of Thirds
    if (this.guides.ruleOfThirds) {
      this.drawRuleOfThirds(ctx, imgTopLeft.x, imgTopLeft.y, screenW, screenH);
    }

    // 3. Action & Title Safe Areas
    if (this.guides.actionSafe || this.guides.titleSafe) {
      this.drawSafeAreas(ctx, imgTopLeft.x, imgTopLeft.y, screenW, screenH);
    }

    // 4. Center Marks & Center Cross
    if (this.guides.centerCross) {
      this.drawCenterCross(ctx, imgTopLeft.x + screenW * 0.5, imgTopLeft.y + screenH * 0.5);
    }
    if (this.guides.centerMarks) {
      this.drawCenterMarks(ctx, imgTopLeft.x, imgTopLeft.y, screenW, screenH);
    }

    // 5. Region of Interest (ROI)
    if (this.roi.enabled && this.roi.width > 0 && this.roi.height > 0) {
      this.drawROI(ctx, zoom, panX, panY);
    }

    // 6. Pinned Sample Target
    if (this.pinnedSample.pinned) {
      this.drawPinnedSample(ctx, zoom, panX, panY);
    }

    // 7. Interactive Wipe Handle
    if (options.wipeMode && (options.wipeMode === 'wipe_h' || options.wipeMode === 'wipe_v')) {
      this.drawWipeHandle(ctx, options.wipeMode, options.wipePosition, imgW, imgH, zoom, panX, panY);
    }

    ctx.restore();
  }

  drawFormatGuide(ctx, sx, sy, sw, sh, imgW, imgH, targetAspect, label) {
    const f = this.getFormatGuideRect(imgW, imgH, targetAspect);
    const fx = sx + f.x * (sw / imgW);
    const fy = sy + f.y * (sh / imgH);
    const fw = f.width * (sw / imgW);
    const fh = f.height * (sh / imgH);

    ctx.save();
    // Translucent mask outside format rect
    ctx.fillStyle = `rgba(0, 0, 0, ${this.formatMaskOpacity || 0.45})`;
    if (fy > sy) ctx.fillRect(sx, sy, sw, fy - sy);
    if (fy + fh < sy + sh) ctx.fillRect(sx, fy + fh, sw, sy + sh - (fy + fh));
    if (fx > sx) ctx.fillRect(sx, fy, fx - sx, fh);
    if (fx + fw < sx + sw) ctx.fillRect(fx + fw, fy, sx + sw - (fx + fw), fh);

    // Format outline
    ctx.strokeStyle = '#38bdf8'; // Sky blue
    ctx.lineWidth = 1;
    ctx.strokeRect(fx, fy, fw, fh);

    // Corner marks (L shapes)
    const tick = 12;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // NW
    ctx.moveTo(fx, fy + tick); ctx.lineTo(fx, fy); ctx.lineTo(fx + tick, fy);
    // NE
    ctx.moveTo(fx + fw - tick, fy); ctx.lineTo(fx + fw, fy); ctx.lineTo(fx + fw, fy + tick);
    // SW
    ctx.moveTo(fx, fy + fh - tick); ctx.lineTo(fx, fy + fh); ctx.lineTo(fx + tick, fy + fh);
    // SE
    ctx.moveTo(fx + fw - tick, fy + fh); ctx.lineTo(fx + fw, fy + fh); ctx.lineTo(fx + fw, fy + fh - tick);
    ctx.stroke();

    // Label tag
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(fx + 4, fy + 4, 110, 16);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '9px monospace';
    ctx.fillText(label, fx + 8, fy + 15);
    ctx.restore();
  }

  drawPixelGrid(ctx, imgW, imgH, zoom, panX, panY, hoveredPixel = null, buffer = null) {
    if (!ctx || zoom < 8.0) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 0.5;

    // Viewport visible pixel boundaries
    const canvasW = ctx.canvas?.width || 1920;
    const canvasH = ctx.canvas?.height || 1080;
    const startX = Math.max(0, Math.floor(-panX / zoom));
    const endX = Math.min(imgW, Math.ceil((canvasW - panX) / zoom));
    const startY = Math.max(0, Math.floor(-panY / zoom));
    const endY = Math.min(imgH, Math.ceil((canvasH - panY) / zoom));

    ctx.beginPath();
    for (let x = startX; x <= endX; x++) {
      const sx = x * zoom + panX;
      ctx.moveTo(sx, startY * zoom + panY);
      ctx.lineTo(sx, endY * zoom + panY);
    }
    for (let y = startY; y <= endY; y++) {
      const sy = y * zoom + panY;
      ctx.moveTo(startX * zoom + panX, sy);
      ctx.lineTo(endX * zoom + panX, sy);
    }
    ctx.stroke();

    // Highlight hovered pixel
    if (hoveredPixel && hoveredPixel.x >= 0 && hoveredPixel.x < imgW && hoveredPixel.y >= 0 && hoveredPixel.y < imgH) {
      const hx = hoveredPixel.x * zoom + panX;
      const hy = hoveredPixel.y * zoom + panY;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.strokeRect(hx, hy, zoom, zoom);

      if (zoom >= 24.0 && buffer) {
        const [r, g, b] = buffer.getPixel(hoveredPixel.x, hoveredPixel.y);
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.max(8, Math.min(14, Math.round(zoom * 0.2)))}px monospace`;
        ctx.fillText(`R:${r.toFixed(2)}`, hx + 4, hy + zoom * 0.3);
        ctx.fillText(`G:${g.toFixed(2)}`, hx + 4, hy + zoom * 0.6);
        ctx.fillText(`B:${b.toFixed(2)}`, hx + 4, hy + zoom * 0.9);
      }
    }
    ctx.restore();
  }

  drawWipeHandle(ctx, mode, position, imgW, imgH, zoom, panX, panY) {
    if (!ctx || position === undefined) return;
    ctx.save();
    const wipePos = Math.max(0.0, Math.min(1.0, position));

    if (mode === 'wipe_h') {
      const imgX = imgW * wipePos;
      const sX = imgX * zoom + panX;
      const sY1 = panY;
      const sY2 = imgH * zoom + panY;

      // Glow line
      ctx.strokeStyle = 'rgba(255, 146, 43, 0.45)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(sX, sY1);
      ctx.lineTo(sX, sY2);
      ctx.stroke();

      // Sharp line
      ctx.strokeStyle = '#ff922b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sX, sY1);
      ctx.lineTo(sX, sY2);
      ctx.stroke();

      // Center pill handle
      const midY = (sY1 + sY2) * 0.5;
      ctx.fillStyle = '#ff922b';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(sX - 14, midY - 14, 28, 28, 6);
      } else {
        ctx.rect(sX - 14, midY - 14, 28, 28);
      }
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('◀ ▶', sX, midY);
    } else if (mode === 'wipe_v') {
      const imgY = imgH * wipePos;
      const sY = imgY * zoom + panY;
      const sX1 = panX;
      const sX2 = imgW * zoom + panX;

      ctx.strokeStyle = 'rgba(255, 146, 43, 0.45)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(sX1, sY);
      ctx.lineTo(sX2, sY);
      ctx.stroke();

      ctx.strokeStyle = '#ff922b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sX1, sY);
      ctx.lineTo(sX2, sY);
      ctx.stroke();

      const midX = (sX1 + sX2) * 0.5;
      ctx.fillStyle = '#ff922b';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(midX - 14, sY - 14, 28, 28, 6);
      } else {
        ctx.rect(midX - 14, sY - 14, 28, 28);
      }
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('▲ ▼', midX, sY);
    }
    ctx.restore();
  }

  drawSafeAreas(ctx, sx, sy, sw, sh) {
    ctx.lineWidth = 1;

    // Action Safe (90% SMPTE / EBU)
    if (this.guides.actionSafe) {
      const marginX = sw * 0.05;
      const marginY = sh * 0.05;
      ctx.strokeStyle = '#f59e0b'; // Amber dashed
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(sx + marginX, sy + marginY, sw - marginX * 2, sh - marginY * 2);

      ctx.fillStyle = '#f59e0b';
      ctx.font = '9px monospace';
      ctx.fillText('ACTION SAFE 90%', sx + marginX + 4, sy + marginY + 12);
    }

    // Title Safe (80% SMPTE / EBU)
    if (this.guides.titleSafe) {
      const marginX = sw * 0.10;
      const marginY = sh * 0.10;
      ctx.strokeStyle = '#06b6d4'; // Cyan dashed
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(sx + marginX, sy + marginY, sw - marginX * 2, sh - marginY * 2);

      ctx.fillStyle = '#06b6d4';
      ctx.font = '9px monospace';
      ctx.fillText('TITLE SAFE 80%', sx + marginX + 4, sy + marginY + 12);
    }

    ctx.setLineDash([]);
  }

  drawCenterCross(ctx, cx, cy) {
    ctx.strokeStyle = '#ef4444'; // Red
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy);
    ctx.lineTo(cx + 16, cy);
    ctx.moveTo(cx, cy - 16);
    ctx.lineTo(cx, cy + 16);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawCenterMarks(ctx, sx, sy, sw, sh) {
    ctx.strokeStyle = '#a855f7'; // Purple
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    const tick = 14;

    ctx.beginPath();
    // Top
    ctx.moveTo(sx + sw * 0.5, sy);
    ctx.lineTo(sx + sw * 0.5, sy + tick);
    // Bottom
    ctx.moveTo(sx + sw * 0.5, sy + sh);
    ctx.lineTo(sx + sw * 0.5, sy + sh - tick);
    // Left
    ctx.moveTo(sx, sy + sh * 0.5);
    ctx.lineTo(sx + tick, sy + sh * 0.5);
    // Right
    ctx.moveTo(sx + sw, sy + sh * 0.5);
    ctx.lineTo(sx + sw - tick, sy + sh * 0.5);
    ctx.stroke();
  }

  drawRuleOfThirds(ctx, sx, sy, sw, sh) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    // Vertical thirds
    ctx.moveTo(sx + sw / 3, sy);
    ctx.lineTo(sx + sw / 3, sy + sh);
    ctx.moveTo(sx + (sw * 2) / 3, sy);
    ctx.lineTo(sx + (sw * 2) / 3, sy + sh);
    // Horizontal thirds
    ctx.moveTo(sx, sy + sh / 3);
    ctx.lineTo(sx + sw, sy + sh / 3);
    ctx.moveTo(sx, sy + (sh * 2) / 3);
    ctx.lineTo(sx + sw, sy + (sh * 2) / 3);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawGrid(ctx, imgW, imgH, zoom, panX, panY, gridSize = 100) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([]);

    ctx.beginPath();
    for (let x = 0; x <= imgW; x += gridSize) {
      const sx = x * zoom + panX;
      ctx.moveTo(sx, panY);
      ctx.lineTo(sx, imgH * zoom + panY);
    }
    for (let y = 0; y <= imgH; y += gridSize) {
      const sy = y * zoom + panY;
      ctx.moveTo(panX, sy);
      ctx.lineTo(imgW * zoom + panX, sy);
    }
    ctx.stroke();
  }

  drawROI(ctx, zoom, panX, panY) {
    const sPos = this.imageToScreen(this.roi.x, this.roi.y, zoom, panX, panY);
    const sw = this.roi.width * zoom;
    const sh = this.roi.height * zoom;

    // ROI Box
    ctx.strokeStyle = '#e6a100'; // Amber/Orange
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(sPos.x, sPos.y, sw, sh);
    ctx.setLineDash([]);

    // Corner Handles
    ctx.fillStyle = '#ffb703';
    const hs = 6;
    ctx.fillRect(sPos.x - hs * 0.5, sPos.y - hs * 0.5, hs, hs);
    ctx.fillRect(sPos.x + sw - hs * 0.5, sPos.y - hs * 0.5, hs, hs);
    ctx.fillRect(sPos.x - hs * 0.5, sPos.y + sh - hs * 0.5, hs, hs);
    ctx.fillRect(sPos.x + sw - hs * 0.5, sPos.y + sh - hs * 0.5, hs, hs);

    // Dimension Tag
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(sPos.x, sPos.y - 18, 120, 16);
    ctx.fillStyle = '#ffb703';
    ctx.font = '10px monospace';
    ctx.fillText(`ROI: ${this.roi.width}x${this.roi.height}`, sPos.x + 4, sPos.y - 6);
  }

  drawPinnedSample(ctx, zoom, panX, panY) {
    const sPos = this.imageToScreen(this.pinnedSample.x, this.pinnedSample.y, zoom, panX, panY);
    const cx = sPos.x;
    const cy = sPos.y;

    ctx.strokeStyle = '#f97316'; // Vivid orange
    ctx.lineWidth = 2;
    ctx.setLineDash([]);

    // Concentric crosshair target
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - 18, cy);
    ctx.lineTo(cx + 18, cy);
    ctx.moveTo(cx, cy - 18);
    ctx.lineTo(cx, cy + 18);
    ctx.stroke();

    // Coordinates Tag
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(cx + 12, cy - 20, 85, 16);
    ctx.fillStyle = '#fb923c';
    ctx.font = '9px monospace';
    ctx.fillText(`[${this.pinnedSample.x}, ${this.pinnedSample.y}]`, cx + 16, cy - 8);
  }
}
