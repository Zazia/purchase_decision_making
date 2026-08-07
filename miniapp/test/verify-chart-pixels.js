/**
 * verify-chart-pixels.js — 读取 canvas 像素验证图表实际有内容（非空白）
 */
const { connect, section, logPass, logInfo, logFail } = require('./helper');

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`[TIMEOUT ${ms}ms] ${label}`)), ms)),
  ]);
}

async function run() {
  section('Canvas 像素验证');
  const mp = await connect();
  logPass('已连接');

  try {
    const query = 'category=iphone&budget=5000&buyTiming=used&performanceFloor=0.5&holdingYears=3';
    logInfo(`reLaunch 到 /pages/result/result?${query}`);
    await withTimeout(mp.reLaunch(`/pages/result/result?${query}`), 45000, 'reLaunch');
    await new Promise((r) => setTimeout(r, 4000));

    // 通过 ec-canvas 内的 canvas node 读取像素
    const pixelInfo = await withTimeout(mp.evaluate(() => {
      return new Promise((resolve) => {
        const pages = getCurrentPages();
        const p = pages[pages.length - 1];
        const chart = p.selectComponent('#chart');
        const ec = chart ? chart.selectComponent('#ec-canvas') : null;
        if (!ec || !ec.canvasNode) {
          resolve({ error: 'no canvasNode', hasEc: !!ec });
          return;
        }
        try {
          const canvas = ec.canvasNode;
          const w = canvas.width;
          const h = canvas.height;
          const ctx = canvas.getContext('2d');
          // 取 1/8 采样: 每 8 像素取一个
          const samples = [];
          let nonEmpty = 0;
          let total = 0;
          let colorCounts = {};
          for (let y = 0; y < h; y += 8) {
            for (let x = 0; x < w; x += 8) {
              const pixel = ctx.getImageData(x, y, 1, 1).data;
              total++;
              const r = pixel[0], g = pixel[1], b = pixel[2], a = pixel[3];
              // 非透明且非纯白
              if (a > 0 && !(r === 255 && g === 255 && b === 255)) {
                nonEmpty++;
                const key = `${Math.round(r/32)*32}-${Math.round(g/32)*32}-${Math.round(b/32)*32}`;
                colorCounts[key] = (colorCounts[key] || 0) + 1;
              }
            }
          }
          resolve({
            canvasWidth: w,
            canvasHeight: h,
            totalSamples: total,
            nonEmptySamples: nonEmpty,
            nonEmptyRatio: total > 0 ? nonEmpty / total : 0,
            topColors: Object.entries(colorCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([k, v]) => ({ rgb: k, count: v })),
          });
        } catch (e) {
          resolve({ error: e.message, stack: e.stack });
        }
      });
    }), 15000, 'pixelInfo');

    console.log('\n--- Canvas 像素信息 ---');
    console.log(JSON.stringify(pixelInfo, null, 2));

    if (pixelInfo.nonEmptyRatio > 0.01) {
      logPass(`图表有内容: 非空像素占比 ${(pixelInfo.nonEmptyRatio * 100).toFixed(1)}%`);
      logInfo(`顶部颜色: ${pixelInfo.topColors.map(c => `rgb(${c.rgb})×${c.count}`).join(', ')}`);
    } else {
      logFail(`图表可能为空白: 非空像素占比 ${(pixelInfo.nonEmptyRatio * 100).toFixed(1)}%`);
    }
  } catch (err) {
    logFail(err.message);
    console.error(err);
  } finally {
    await mp.close();
  }
  section('完成');
  process.exit(0);
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
