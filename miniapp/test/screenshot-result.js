/**
 * screenshot-result.js — 截图验证结果页实际渲染效果
 */
const { connect, section, logPass, logInfo, logFail } = require('./helper');

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`[TIMEOUT ${ms}ms] ${label}`)), ms)),
  ]);
}

async function run() {
  section('结果页截图验证');
  const mp = await connect();
  logPass('已连接');

  try {
    const query = 'category=iphone&budget=5000&buyTiming=used&performanceFloor=0.5&holdingYears=3';
    logInfo(`reLaunch 到 /pages/result/result?${query}`);
    await withTimeout(mp.reLaunch(`/pages/result/result?${query}`), 45000, 'reLaunch result');
    await new Promise((r) => setTimeout(r, 4000));

    // 多截图: 整页 + 滚动到图表区域
    const shotPath = 'd:/_Projects/1-small-tools/purchase_decision_making/miniapp/test/result-page.png';
    logInfo('截图中...');
    try {
      const r = await withTimeout(mp.screenshot({ path: shotPath }), 10000, 'screenshot');
      logPass(`截图保存: ${shotPath} (${r})`);
    } catch (e) {
      logFail('screenshot: ' + e.message);
    }

    // 滚动到图表区域再截图
    await withTimeout(mp.evaluate(() => {
      wx.pageScrollTo({ scrollTop: 700, duration: 300 });
    }), 5000, 'scrollTo');
    await new Promise((r) => setTimeout(r, 1500));
    const shotPath2 = 'd:/_Projects/1-small-tools/purchase_decision_making/miniapp/test/result-chart.png';
    try {
      const r = await withTimeout(mp.screenshot({ path: shotPath2 }), 10000, 'screenshot2');
      logPass(`图表区截图: ${shotPath2} (${r})`);
    } catch (e) {
      logFail('screenshot2: ' + e.message);
    }

    // 详细状态
    const status = await withTimeout(mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      const chart = p.selectComponent('#chart');
      const ec = chart ? chart.selectComponent('#ec-canvas') : null;
      return {
        plansLen: p?.data?.plans?.length,
        frontierLen: p?.data?.frontier?.length,
        dominatedLen: p?.data?.dominated?.length,
        chartInited: chart?.data?.initialized,
        ecHasChart: !!ec?.chart,
        ecChartType: ec ? typeof ec.chart : null,
        ecHasCanvasNode: !!ec?.canvasNode,
        chartInstanceInPage: !!chart?.chartInstance,
        chartInstanceKeys: chart?.chartInstance ? Object.keys(chart.chartInstance).slice(0, 5) : null,
      };
    }), 8000, 'status');
    console.log('\n--- 详细状态 ---');
    console.log(JSON.stringify(status, null, 2));
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
