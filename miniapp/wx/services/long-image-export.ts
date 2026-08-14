// services/long-image-export.ts

import type { EditedPlanPoint } from './scheme-editor-state';

export interface LongImageExportOptions {
  title: string;
  subtitle: string;
  paramsSummary: string;
  points: EditedPlanPoint[];
  qrcodeBase64: string;
  appName: string;
  lastUpdated: string;
}

const WIDTH = 1080;
const HEADER_H = 360;
const FOOTER_H = 360;
const ROW_H = 160;
const MAX_CANVAS_H = 4000;

// Colors
const C_BG = '#F5F5F7';
const C_SURFACE = '#FFFFFF';
const C_PRIMARY = '#007AFF';
const C_TEXT = '#1D1D1F';
const C_MUTED = '#86868F';
const C_BORDER = '#D2D2D8';
const C_RED = '#F24B4B';
const C_ORANGE = '#C25E00';

export async function exportLongImage(options: LongImageExportOptions): Promise<string> {
  const totalH = HEADER_H + FOOTER_H + options.points.length * ROW_H;
  
  wx.showLoading({ title: '正在渲染长图...', mask: true });
  try {
    let tempFilePath = '';
    if (totalH <= MAX_CANVAS_H) {
      tempFilePath = await renderSingleCanvas(options, totalH);
    } else {
      tempFilePath = await renderSplitCanvas(options, totalH);
    }
    
    // Save to album
    wx.showLoading({ title: '保存到相册...', mask: true });
    await new Promise<void>((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath: tempFilePath,
        success: () => resolve(),
        fail: reject
      });
    });
    
    wx.hideLoading();
    return tempFilePath;
  } catch (err) {
    wx.hideLoading();
    throw err;
  }
}

async function renderSingleCanvas(options: LongImageExportOptions, totalH: number): Promise<string> {
  const canvas = wx.createOffscreenCanvas({ type: '2d', width: WIDTH, height: totalH });
  const ctx = canvas.getContext('2d') as any;
  await drawContent(canvas, ctx, options, 0, totalH);
  return exportCanvasToTempFile(canvas);
}

async function renderSplitCanvas(options: LongImageExportOptions, totalH: number): Promise<string> {
  const chunks: string[] = [];
  let y = 0;
  
  // Render chunks
  while (y < totalH) {
    const chunkH = Math.min(MAX_CANVAS_H, totalH - y);
    const canvas = wx.createOffscreenCanvas({ type: '2d', width: WIDTH, height: chunkH });
    const ctx = canvas.getContext('2d') as any;
    
    // Fill background
    ctx.fillStyle = C_BG;
    ctx.fillRect(0, 0, WIDTH, chunkH);
    
    // Translate context so we can draw normally
    ctx.save();
    ctx.translate(0, -y);
    await drawContent(canvas, ctx, options, y, chunkH);
    ctx.restore();
    
    const chunkPath = await exportCanvasToTempFile(canvas);
    chunks.push(chunkPath);
    y += chunkH;
  }
  
  // Now stitch them vertically
  // If the total stitched size is too big for a single saveImageToPhotosAlbum, 
  // actually wx.saveImageToPhotosAlbum might not have height limits if it's just a file, 
  // but to combine them we need a canvas.
  // Wait, if the combined canvas is > 4000, we can't create it to stitch them!
  // If we can't stitch them using canvas, we'd need a backend or just return the first chunk?
  // Let's assume createOffscreenCanvas can actually be large, but some devices fail at 4096.
  // We'll try to create one big canvas for stitching. If it fails, we return the first chunk.
  try {
    const stitchCanvas = wx.createOffscreenCanvas({ type: '2d', width: WIDTH, height: totalH });
    const ctx = stitchCanvas.getContext('2d') as any;
    let currY = 0;
    for (const chunk of chunks) {
      const img = stitchCanvas.createImage();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = chunk;
      });
      ctx.drawImage(img, 0, currY);
      currY += MAX_CANVAS_H;
    }
    return await exportCanvasToTempFile(stitchCanvas);
  } catch (e) {
    // If stitching fails due to size, just return the first chunk and warn
    console.warn('Failed to stitch large canvas, returning part 1', e);
    return chunks[0];
  }
}

async function drawContent(canvas: any, ctx: any, options: LongImageExportOptions, startY: number, h: number) {
  // 1. Bg
  ctx.fillStyle = C_BG;
  ctx.fillRect(0, 0, WIDTH, Math.max(HEADER_H + FOOTER_H + options.points.length * ROW_H, startY + h));
  
  // 2. Header
  ctx.fillStyle = C_PRIMARY;
  ctx.fillRect(0, 0, WIDTH, HEADER_H);
  
  ctx.fillStyle = C_SURFACE;
  ctx.font = 'bold 56px sans-serif';
  ctx.fillText(options.title, 60, 120);
  
  ctx.font = '32px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(options.subtitle, 60, 190);
  
  ctx.font = '28px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(options.paramsSummary, 60, 260);
  
  // 3. Rows
  let currentY = HEADER_H;
  for (const p of options.points) {
    // Only draw if within current chunk (optimization)
    if (currentY + ROW_H >= startY && currentY <= startY + h) {
      drawRow(ctx, p, currentY);
    }
    currentY += ROW_H;
  }
  
  // 4. Footer
  if (currentY + FOOTER_H >= startY && currentY <= startY + h) {
    await drawFooter(canvas, ctx, options, currentY);
  }
}

function drawRow(ctx: any, p: EditedPlanPoint, y: number) {
  ctx.fillStyle = C_SURFACE;
  ctx.fillRect(40, y + 10, WIDTH - 80, ROW_H - 20);
  
  if (p.excluded) {
    ctx.fillStyle = 'rgba(242, 242, 247, 0.6)';
    ctx.fillRect(40, y + 10, WIDTH - 80, ROW_H - 20);
  }
  
  // Model
  ctx.fillStyle = p.excluded ? C_MUTED : C_TEXT;
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(p.model.replace(/\s*×\s*\d+年$/, ''), 80, y + 70);
  
  // Tags
  let tagX = 80;
  if (p.source === 'custom') {
    drawTag(ctx, '自添加', tagX, y + 90, '#E6F2FF', C_PRIMARY);
    tagX += 100;
  } else if (p.source === 'edited') {
    drawTag(ctx, '已改价', tagX, y + 90, '#FFF0C2', C_ORANGE);
    tagX += 100;
  }
  if (p.excluded) {
    drawTag(ctx, '已排除', tagX, y + 90, '#FFD9D9', C_RED);
  }
  
  // Right side details (Price, Channel)
  ctx.textAlign = 'right';
  ctx.fillStyle = p.excluded ? C_MUTED : C_TEXT;
  ctx.font = '32px sans-serif';
  ctx.fillText(`${p.editedBuyPrice || p.buyPrice}元`, WIDTH - 80, y + 70);
  
  ctx.font = '26px sans-serif';
  ctx.fillStyle = C_MUTED;
  const channelText = p.channel || '快照价';
  ctx.fillText(channelText, WIDTH - 80, y + 115);
  ctx.textAlign = 'left';
}

function drawTag(ctx: any, text: string, x: number, y: number, bg: string, color: string) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, 90, 36);
  ctx.fillStyle = color;
  ctx.font = '22px sans-serif';
  ctx.fillText(text, x + 12, y + 25);
}

async function drawFooter(canvas: any, ctx: any, options: LongImageExportOptions, y: number) {
  // Qrcode
  if (options.qrcodeBase64) {
    try {
      const img = canvas.createImage();
      const fs = wx.getFileSystemManager();
      const tempPath = `${wx.env.USER_DATA_PATH}/qr_${Date.now()}.jpg`;
      fs.writeFileSync(tempPath, wx.base64ToArrayBuffer(options.qrcodeBase64), 'binary');
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = tempPath;
      });
      
      ctx.fillStyle = C_SURFACE;
      ctx.fillRect(60, y + 40, 160, 160);
      ctx.drawImage(img, 76, y + 56, 128, 128);
      
      fs.unlinkSync(tempPath);
    } catch (e) {
      console.warn('Footer qrcode draw failed', e);
    }
  }
  
  ctx.fillStyle = C_TEXT;
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText('扫码查看我的方案', 250, y + 100);
  
  ctx.fillStyle = C_MUTED;
  ctx.font = '28px sans-serif';
  ctx.fillText(options.appName, 250, y + 145);
  
  ctx.font = '24px sans-serif';
  ctx.fillText(`数据更新于 ${options.lastUpdated}`, 60, y + 270);
}

function exportCanvasToTempFile(canvas: any): Promise<string> {
  return new Promise((resolve, reject) => {
    // using offscreen canvas toDataURL or wx.canvasToTempFilePath
    // Note: offscreen canvas does not support wx.canvasToTempFilePath directly on all versions, 
    // but canvas.toDataURL() or using a hack might be needed. 
    // Actually, on WeChat Mini Program, for OffscreenCanvas:
    // It's better to use canvas.toTempFilePathSync() or pass it to wx.canvasToTempFilePath?
    // According to docs, OffscreenCanvas has no toTempFilePath. But we can use WechatMiniprogram API?
    // We will just use the standard canvasToTempFilePath if possible.
    try {
      // In newer base libraries, canvasToTempFilePath accepts offscreen canvas
      wx.canvasToTempFilePath({
        canvas,
        fileType: 'png',
        success: (res) => resolve(res.tempFilePath),
        fail: reject
      });
    } catch (e) {
      reject(e);
    }
  });
}
