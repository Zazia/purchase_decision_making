// components/share-card-canvas/share-card-canvas.ts
// 分享卡 canvas 2d 离屏渲染组件: 1080×1440 竖图
// 绘制内容: 标题 + 用户预算 + 推荐方案摘要 + 帕累托缩略图 + 小程序码 + 数据声明
// 小程序码来自云函数 wx.openapi.wxacode.getUnlimited 返回的 base64, 经 base64ToArrayBuffer
// + 写临时文件 + canvas.createImage + drawImage 绘制; 无码时降级为小程序名称文字

/** 与 PlanPoint 对齐的方案点 */
interface PlanPoint {
  model: string;
  chip: string;
  buyTiming: 'new' | 'used';
  holdingYears: number;
  monthlyCost: number;
  avgPerformance: number;
  buyPrice: number;
  residual: number;
  maintenanceCost: number;
  holdingMonths: number;
  performanceS0: number;
  performanceSN: number;
}

/** canvas.createImage() 返回的图片对象 (mini program Canvas 2D API) */
interface CanvasImageLike {
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

// 设计 token
const C_PRIMARY = '#007AFF';
const C_BG = '#F5F5F7';
const C_SURFACE = '#FFFFFF';
const C_FG = '#1D1D1F';
const C_MUTED = '#86868F';
const C_BORDER = '#D2D2D8';
const C_GRAY = '#B9B9C1';
const C_SUCCESS = '#2A8A61';

// 底部码区布局 (左对齐: 圆角矩形码框 + 右侧说明文字)
const CODE_BOX_SIZE = 160; // 圆角矩形边长
const CODE_INNER_SIZE = Math.round(CODE_BOX_SIZE * 0.8); // 小程序码实际尺寸 = 128, 占圆角矩形 80%
const CODE_BOX_X = 60; // 左对齐
const CODE_BOX_Y = 1140;
const CODE_INNER_X = CODE_BOX_X + (CODE_BOX_SIZE - CODE_INNER_SIZE) / 2; // 76, 码在框内居中
const CODE_INNER_Y = CODE_BOX_Y + (CODE_BOX_SIZE - CODE_INNER_SIZE) / 2; // 1156
const CODE_TEXT_X = CODE_BOX_X + CODE_BOX_SIZE + 28; // 248, 码框右侧文字起始 x
const CODE_BOX_CENTER_Y = CODE_BOX_Y + CODE_BOX_SIZE / 2; // 1220, 用于文字垂直对齐

Component({
  properties: {
    budget: { type: Number, value: 0 },
    category: { type: String, value: '' },
    categoryLabel: { type: String, value: '' },
    topPlan: { type: Object, value: null },
    frontier: { type: Array, value: [] },
    lastUpdated: { type: String, value: '' },
    /** 小程序码 base64 (云函数返回; 空字符串 → 文字模式只显小程序名) */
    qrcodeBase64: { type: String, value: '' },
    /** 小程序名称 (文字模式显示) */
    appName: { type: String, value: '帕累托买苹果' },
  },

  data: {
    canvasReady: false,
    renderFailed: false,
  },

  // 实例属性 (非 data, 不参与 setData)
  // _canvas: WechatMiniprogram.Canvas | null
  // _qrcodeImg: Image | null  (canvas.createImage 返回的图片对象, 加载完成后用于 drawImage)
  // _qrcodeLoading: boolean
  // _qrcodeReadyPromise: Promise<void> | null  (供 whenQrcodeReady 等待)
  // _pendingQrcodeBase64: string  (canvas 未就绪时缓存的 base64)
  // _pendingQrcodeResolve: ((v: void) => void) | null  (pending promise 的 resolver)

  lifetimes: {
    attached() {
      // 延迟初始化, 确保组件已挂载
      setTimeout(() => this.initCanvas(), 200);
    },
    detached() {
      this._canvas = null;
      this._qrcodeImg = null;
      this._qrcodeLoading = false;
      this._qrcodeReadyPromise = null;
      this._pendingQrcodeBase64 = '';
      this._pendingQrcodeResolve = null;
    },
  },

  observers: {
    'topPlan, frontier': function () {
      if (this.data.canvasReady) {
        this.redraw();
      }
    },
    'qrcodeBase64': function (val: string) {
      this.loadQrcodeImage(val);
    },
  },

  methods: {
    /** 初始化 canvas 并绘制 */
    initCanvas() {
      const query = this.createSelectorQuery();
      query
        .select('#share-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) {
            console.warn('[share-card-canvas] Canvas node not found, retrying...');
            setTimeout(() => this.initCanvas(), 300);
            return;
          }

          const canvas = res[0].node as WechatMiniprogram.Canvas;
          this._canvas = canvas;
          const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

          // 设置像素缓冲区为 1080×1440
          canvas.width = 1080;
          canvas.height = 1440;

          try {
            this.drawCard(ctx);
            this.setData({ canvasReady: true, renderFailed: false });
            // 处理 canvas 未就绪时 property 已就绪或 observer 已缓存 pending 的情况
            const pendingBase64 = this._pendingQrcodeBase64;
            if (pendingBase64 && this._pendingQrcodeResolve) {
              const resolve = this._pendingQrcodeResolve;
              this._pendingQrcodeBase64 = '';
              this._pendingQrcodeResolve = null;
              // 重新走 loadQrcodeImage, 把 pending promise 关联到真正的加载 promise
              this.loadQrcodeImage(pendingBase64);
              // 把 pending promise 与新 promise 串联
              (this._qrcodeReadyPromise || Promise.resolve()).then(() => resolve());
            } else if (this.properties.qrcodeBase64 && !this._qrcodeImg && !this._qrcodeLoading) {
              this.loadQrcodeImage(this.properties.qrcodeBase64);
            }
          } catch (err) {
            console.error('[share-card-canvas] Draw failed:', err);
            this.setData({ renderFailed: true });
          }
        });
    },

    /** 重绘 */
    redraw() {
      if (!this._canvas) {
        this.initCanvas();
        return;
      }
      const ctx = this._canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
      this._canvas.width = 1080;
      this._canvas.height = 1440;
      try {
        this.drawCard(ctx);
      } catch (err) {
        console.error('[share-card-canvas] Redraw failed:', err);
      }
    },

    /**
     * 加载云函数返回的小程序码 base64 为 canvas Image
     * 加载完成后触发一次重绘, 把图片绘制到 canvas
     * 失败时静默降级为文字模式 (qrcodeImg 保持 null)
     *
     * 同时维护 _qrcodeReadyPromise, 供 whenQrcodeReady() 等待图片加载完成
     */
    loadQrcodeImage(base64: string) {
      // 无值 → 清空已加载图片 + 重绘回文字模式, 立即 resolve
      if (!base64) {
        this._qrcodeImg = null;
        this._qrcodeLoading = false;
        this._qrcodeReadyPromise = Promise.resolve();
        if (this.data.canvasReady) this.redraw();
        return;
      }

      // canvas 未就绪 → 等 initCanvas 完成后再触发
      if (!this._canvas) {
        this._qrcodeLoading = true;
        this._qrcodeReadyPromise = new Promise((resolve) => {
          this._pendingQrcodeBase64 = base64;
          this._pendingQrcodeResolve = resolve;
        });
        return;
      }

      this._qrcodeLoading = true;
      this._qrcodeReadyPromise = new Promise<void>((resolve) => {
        const fs = wx.getFileSystemManager();
        const filePath = `${wx.env.USER_DATA_PATH}/share_qrcode_${Date.now()}.jpg`;

        try {
          const buffer = wx.base64ToArrayBuffer(base64);
          fs.writeFile({
            filePath,
            data: buffer,
            encoding: 'binary',
            success: () => {
              const img = (this._canvas as WechatMiniprogram.Canvas).createImage();
              img.onload = () => {
                this._qrcodeImg = img;
                this._qrcodeLoading = false;
                // 清理临时文件 (图片已加载到内存, 文件可删)
                fs.unlink({ filePath, fail: () => {} });
                if (this.data.canvasReady) this.redraw();
                resolve();
              };
              img.onerror = () => {
                console.warn('[share-card-canvas] Qrcode image load failed');
                this._qrcodeImg = null;
                this._qrcodeLoading = false;
                if (this.data.canvasReady) this.redraw();
                resolve(); // 失败也 resolve, 让调用方继续走文字模式
              };
              img.src = filePath;
            },
            fail: (err) => {
              console.warn('[share-card-canvas] Qrcode temp file write failed:', err);
              this._qrcodeImg = null;
              this._qrcodeLoading = false;
              if (this.data.canvasReady) this.redraw();
              resolve();
            },
          });
        } catch (e) {
          console.warn('[share-card-canvas] base64ToArrayBuffer failed:', e);
          this._qrcodeImg = null;
          this._qrcodeLoading = false;
          if (this.data.canvasReady) this.redraw();
          resolve();
        }
      });
    },

    /**
     * 等待小程序码图片加载完成 (或失败/无码), 供 share-card 页在 exportImage 前调用
     * 返回的 Promise 总会 resolve, 不会 reject (失败时降级为文字模式)
     */
    whenQrcodeReady(): Promise<void> {
      return this._qrcodeReadyPromise || Promise.resolve();
    },

    /** 绘制分享卡 */
    drawCard(ctx: CanvasRenderingContext2D) {
      const topPlan = this.properties.topPlan as unknown as PlanPoint | null;
      const frontier = this.properties.frontier as unknown as PlanPoint[] | null;
      const appName = this.properties.appName || '帕累托买苹果';
      const qrcodeImg = this._qrcodeImg as unknown as CanvasImageLike | null;

      // ===== 1. 背景 =====
      ctx.fillStyle = C_BG;
      ctx.fillRect(0, 0, 1080, 1440);

      // ===== 2. 顶部蓝色色块 =====
      ctx.fillStyle = C_PRIMARY;
      ctx.fillRect(0, 0, 1080, 280);

      // 标题
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 56px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText('苹果购买决策分析', 60, 110);

      // 副标题
      ctx.font = '32px -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillText('用数据帮你选 · 帕累托前沿筛选', 60, 170);

      // 预算标签
      const budgetText = `预算 ${this.properties.budget} 元 · ${this.properties.categoryLabel || this.properties.category}`;
      ctx.font = '28px -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillText(budgetText, 60, 230);

      // ===== 3. 推荐方案卡片 =====
      if (topPlan) {
        const cardY = 340;
        const cardH = 340;

        // 卡片背景
        ctx.fillStyle = C_SURFACE;
        this.roundRect(ctx, 40, cardY, 1000, cardH, 24);
        ctx.fill();

        // 标签
        ctx.fillStyle = C_SUCCESS;
        ctx.font = '28px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText('推荐方案', 80, cardY + 50);

        // 机型名
        const modelLabel = topPlan.model
          .replace(/\s*×\s*\d+年$/, '')
          .replace(/_/g, ' ');
        ctx.fillStyle = C_FG;
        ctx.font = 'bold 44px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText(modelLabel, 80, cardY + 110);

        // 持有期 + 买入时机
        const timingText = `${topPlan.buyTiming === 'new' ? '新品' : '二手'} · 持有 ${topPlan.holdingYears} 年`;
        ctx.fillStyle = C_MUTED;
        ctx.font = '30px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText(timingText, 80, cardY + 160);

        // 月均成本(大字)
        ctx.fillStyle = C_PRIMARY;
        ctx.font = 'bold 80px "DM Sans", -apple-system, sans-serif';
        const costText = `${(Math.round(topPlan.monthlyCost * 100) / 100).toFixed(2)}`;
        ctx.fillText(costText, 80, cardY + 260);

        // 单位
        ctx.fillStyle = C_MUTED;
        ctx.font = '32px -apple-system, "PingFang SC", sans-serif';
        const costWidth = ctx.measureText(costText).width;
        // 重新测量大字宽度
        ctx.font = 'bold 80px "DM Sans", -apple-system, sans-serif';
        const bigWidth = ctx.measureText(costText).width;
        ctx.font = '32px -apple-system, "PingFang SC", sans-serif';
        ctx.fillStyle = C_MUTED;
        ctx.fillText('元/月', 80 + bigWidth + 12, cardY + 260);

        // 性能满足度
        const perfText = `性能满足度 ${Math.round(topPlan.avgPerformance * 1000) / 10}%`;
        ctx.fillStyle = C_FG;
        ctx.font = '32px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText(perfText, 80, cardY + 310);
      }

      // ===== 4. 帕累托前沿缩略图 =====
      if (frontier && frontier.length > 0) {
        const chartX = 40;
        const chartY = 720;
        const chartW = 1000;
        const chartH = 380;

        // 图表背景
        ctx.fillStyle = C_SURFACE;
        this.roundRect(ctx, chartX, chartY, chartW, chartH, 24);
        ctx.fill();

        // 图表标题
        ctx.fillStyle = C_FG;
        ctx.font = 'bold 32px -apple-system, "PingFang SC", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('帕累托前沿图', chartX + 40, chartY + 50);

        // 图表说明 (标题下方左对齐, 浅色, 帮助理解前沿含义)
        ctx.fillStyle = C_GRAY;
        ctx.font = '22px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText('前沿上的点不存在性能更高且价格更低的选择', chartX + 40, chartY + 74);

        // 绘制缩略散点图
        this.drawParetoThumbnail(ctx, frontier, chartX + 40, chartY + 80, chartW - 80, chartH - 120);
      }

      // ===== 5. 底部码区 (左对齐: 圆角矩形码框 + 右侧文字; 无码时文字左对齐) =====
      if (qrcodeImg) {
        // 白色圆角矩形码框 (160×160, 左对齐)
        ctx.fillStyle = '#FFFFFF';
        this.roundRect(ctx, CODE_BOX_X, CODE_BOX_Y, CODE_BOX_SIZE, CODE_BOX_SIZE, 20);
        ctx.fill();
        // 绘制小程序码图片 (128×128, 在圆角矩形内居中, 占 80%)
        ctx.drawImage(
          qrcodeImg as unknown as CanvasImageSource,
          CODE_INNER_X,
          CODE_INNER_Y,
          CODE_INNER_SIZE,
          CODE_INNER_SIZE,
        );

        // 码框右侧文字 (左对齐, 三行: 主标题 / 小程序名 / 副标题)
        ctx.textAlign = 'left';
        // 主标题: 扫码查看我的方案
        ctx.fillStyle = C_FG;
        ctx.font = 'bold 32px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText('扫码查看我的方案', CODE_TEXT_X, CODE_BOX_CENTER_Y - 26);
        // 小程序名
        ctx.fillStyle = C_MUTED;
        ctx.font = '28px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText(appName, CODE_TEXT_X, CODE_BOX_CENTER_Y + 14);
        // 副标题
        ctx.fillStyle = C_MUTED;
        ctx.font = '24px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText('用数据帮你选', CODE_TEXT_X, CODE_BOX_CENTER_Y + 48);
      } else {
        // 文字模式: 无码框, 文字左对齐 (从 CODE_BOX_X 起始)
        ctx.textAlign = 'left';
        // 小程序名 (粗体大字)
        ctx.fillStyle = C_FG;
        ctx.font = 'bold 40px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText(appName, CODE_BOX_X, CODE_BOX_CENTER_Y - 14);
        // 副标题
        ctx.fillStyle = C_MUTED;
        ctx.font = '26px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText('微信搜索小程序 · 用数据帮你选', CODE_BOX_X, CODE_BOX_CENTER_Y + 28);
      }

      // ===== 6. 底部声明 =====
      ctx.fillStyle = C_MUTED;
      ctx.font = '24px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText(`数据更新于 ${this.properties.lastUpdated || '未知'}`, 60, 1400);

      ctx.font = '22px -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = '#B9B9C1';
      ctx.fillText('个人主体 · 非商业 · CC BY-NC 4.0 · github.com/Zazia/purchase_decision_making', 60, 1430);
    },

    /** 绘制帕累托缩略图 (含点位极简标注) */
    drawParetoThumbnail(
      ctx: CanvasRenderingContext2D,
      frontier: PlanPoint[],
      x: number,
      y: number,
      w: number,
      h: number,
    ) {
      const allCosts = frontier.map((p) => p.monthlyCost);
      const allPerfs = frontier.map((p) => p.avgPerformance * 100);

      const minCost = Math.min(...allCosts);
      const maxCost = Math.max(...allCosts);
      const minPerf = Math.min(...allPerfs);
      const maxPerf = Math.max(...allPerfs);

      const costRange = Math.max(maxCost - minCost, 1);
      const perfRange = Math.max(maxPerf - minPerf, 1);

      // 坐标轴
      ctx.strokeStyle = C_BORDER;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x + w, y + h);
      ctx.stroke();

      // 前沿连线
      const sorted = [...frontier].sort((a, b) => a.monthlyCost - b.monthlyCost);
      ctx.strokeStyle = C_PRIMARY;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      sorted.forEach((p, i) => {
        const px = x + ((p.monthlyCost - minCost) / costRange) * w;
        const py = y + h - ((p.avgPerformance * 100 - minPerf) / perfRange) * h;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // 前沿点 + 极简标注
      ctx.fillStyle = C_PRIMARY;
      ctx.font = '20px -apple-system, "PingFang SC", sans-serif';
      sorted.forEach((p) => {
        const px = x + ((p.monthlyCost - minCost) / costRange) * w;
        const py = y + h - ((p.avgPerformance * 100 - minPerf) / perfRange) * h;
        ctx.beginPath();
        ctx.arc(px, py, 10, 0, Math.PI * 2);
        ctx.fill();

        // 极简标注: chip + 持有年数 (如 "M2·3y", "A18·5y")
        const chipLabel = p.chip || p.model.replace(/_.*$/, '');
        const label = `${chipLabel}·${p.holdingYears}y`;
        const labelWidth = ctx.measureText(label).width;
        const labelX = px + 14;
        const labelY = py - 14;
        // 标注背景(半透明白色)
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(labelX - 2, labelY - 15, labelWidth + 4, 22);
        ctx.fillStyle = C_MUTED;
        ctx.fillText(label, labelX, labelY);
        ctx.fillStyle = C_PRIMARY;
      });

      // 坐标轴标签
      ctx.fillStyle = C_MUTED;
      ctx.font = '22px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText('月均成本 →', x + w - 140, y + h + 30);
      ctx.save();
      ctx.translate(x - 15, y + 80);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('性能 →', 0, 0);
      ctx.restore();
    },

    /** 圆角矩形 */
    roundRect(
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
      r: number,
    ) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },

    /** 导出图片, 返回 tempFilePath */
    exportImage(): Promise<string> {
      return new Promise((resolve, reject) => {
        if (!this._canvas) {
          reject(new Error('Canvas not ready'));
          return;
        }
        wx.canvasToTempFilePath({
          canvas: this._canvas as WechatMiniprogram.Canvas,
          fileType: 'png',
          quality: 1,
          success: (result) => resolve(result.tempFilePath),
          fail: (err) => reject(err),
        });
      });
    },
  },
});
