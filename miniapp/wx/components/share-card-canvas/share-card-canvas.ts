// components/share-card-canvas/share-card-canvas.ts
// 分享卡 canvas 2d 离屏渲染组件: 1080×1440 竖图
// 绘制内容: 标题 + 用户预算 + 推荐方案摘要 + 帕累托缩略图 + 小程序码占位 + 数据声明

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

// 设计 token
const C_PRIMARY = '#007AFF';
const C_BG = '#F5F5F7';
const C_SURFACE = '#FFFFFF';
const C_FG = '#1D1D1F';
const C_MUTED = '#86868F';
const C_BORDER = '#D2D2D8';
const C_GRAY = '#C7C7CC';
const C_SUCCESS = '#2A8A61';

Component({
  properties: {
    budget: { type: Number, value: 0 },
    category: { type: String, value: '' },
    categoryLabel: { type: String, value: '' },
    topPlan: { type: Object, value: null },
    frontier: { type: Array, value: [] },
    lastUpdated: { type: String, value: '' },
  },

  data: {
    canvasReady: false,
    renderFailed: false,
  },

  lifetimes: {
    attached() {
      // 延迟初始化, 确保组件已挂载
      setTimeout(() => this.initCanvas(), 200);
    },
  },

  observers: {
    'topPlan, frontier': function () {
      if (this.data.canvasReady) {
        this.redraw();
      }
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
          const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

          // 设置像素缓冲区为 1080×1440
          canvas.width = 1080;
          canvas.height = 1440;

          try {
            this.drawCard(ctx);
            this.setData({ canvasReady: true, renderFailed: false });
          } catch (err) {
            console.error('[share-card-canvas] Draw failed:', err);
            this.setData({ renderFailed: true });
          }
        });
    },

    /** 重绘 */
    redraw() {
      const query = this.createSelectorQuery();
      query
        .select('#share-canvas')
        .fields({ node: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) return;
          const canvas = res[0].node as WechatMiniprogram.Canvas;
          const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
          canvas.width = 1080;
          canvas.height = 1440;
          this.drawCard(ctx);
        });
    },

    /** 绘制分享卡 */
    drawCard(ctx: CanvasRenderingContext2D) {
      const topPlan = this.properties.topPlan as unknown as PlanPoint | null;
      const frontier = this.properties.frontier as unknown as PlanPoint[] | null;

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
        ctx.fillText('月均成本最低方案', 80, cardY + 50);

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
        ctx.fillText('帕累托前沿图', chartX + 40, chartY + 50);

        // 绘制缩略散点图
        this.drawParetoThumbnail(ctx, frontier, chartX + 40, chartY + 80, chartW - 80, chartH - 120);
      }

      // ===== 5. 小程序码占位 =====
      const qrY = 1150;
      const qrSize = 180;

      // 占位框
      ctx.fillStyle = C_SURFACE;
      this.roundRect(ctx, 60, qrY, qrSize, qrSize, 16);
      ctx.fill();
      ctx.strokeStyle = C_BORDER;
      ctx.lineWidth = 2;
      this.roundRect(ctx, 60, qrY, qrSize, qrSize, 16);
      ctx.stroke();

      // 占位文字
      ctx.fillStyle = C_MUTED;
      ctx.font = '24px -apple-system, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('小程序码', 60 + qrSize / 2, qrY + qrSize / 2 + 8);
      ctx.textAlign = 'left';

      // 右侧引导文字
      ctx.fillStyle = C_FG;
      ctx.font = 'bold 36px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText('扫码进入小程序', 60 + qrSize + 40, qrY + 70);

      ctx.fillStyle = C_MUTED;
      ctx.font = '28px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText('输入预算, 获取你的购买方案', 60 + qrSize + 40, qrY + 120);

      // ===== 6. 底部声明 =====
      ctx.fillStyle = C_MUTED;
      ctx.font = '24px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText(`数据更新于 ${this.properties.lastUpdated || '未知'}`, 60, 1400);

      ctx.font = '22px -apple-system, "PingFang SC", sans-serif';
      ctx.fillStyle = '#C7C7CC';
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
        const query = this.createSelectorQuery();
        query
          .select('#share-canvas')
          .fields({ node: true })
          .exec((res) => {
            if (!res || !res[0] || !res[0].node) {
              reject(new Error('Canvas not found'));
              return;
            }
            const canvas = res[0].node as WechatMiniprogram.Canvas;
            wx.canvasToTempFilePath({
              canvas: canvas,
              fileType: 'png',
              quality: 1,
              success: (result) => resolve(result.tempFilePath),
              fail: (err) => reject(err),
            });
          });
      });
    },
  },
});
