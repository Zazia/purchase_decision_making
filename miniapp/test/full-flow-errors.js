/**
 * full-flow-errors.js — 完整走 5 步决策树, 捕获整个流程所有错误
 *
 * 与 result-flow.js 区别: 不直接 reLaunch 到 result, 而是从 decision-tree
 * 一步步点击, 捕获交互过程中所有 console.error / warn / 异常
 */
const { connect, section, logPass, logInfo, logFail } = require('./helper');

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`[TIMEOUT ${ms}ms] ${label}`)), ms)),
  ]);
}

async function run() {
  section('完整流程错误捕获');
  const mp = await connect();
  logPass('已连接');

  try {
    // 1. reLaunch 到 decision-tree
    logInfo('reLaunch 到 decision-tree...');
    await withTimeout(mp.reLaunch('/pages/decision-tree/decision-tree'), 45000, 'reLaunch dt');
    await new Promise((r) => setTimeout(r, 2000));

    // 2. 注入全局错误捕获 (含 onError / onUnhandledRejection / console.error)
    logInfo('注入全局错误捕获...');
    await withTimeout(mp.evaluate(() => {
      const errors = [];
      try { (wx).__testErrors = errors; } catch (e) {}

      // console.error
      const origErr = console.error;
      console.error = function () {
        try {
          const args = Array.prototype.slice.call(arguments);
          errors.push('[error] ' + args.map(a => {
            try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch { return String(a); }
          }).join(' '));
        } catch {}
        return origErr.apply(this, arguments);
      };
      // console.warn
      const origWarn = console.warn;
      console.warn = function () {
        try {
          const args = Array.prototype.slice.call(arguments);
          errors.push('[warn] ' + args.map(a => {
            try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch { return String(a); }
          }).join(' '));
        } catch {}
        return origWarn.apply(this, arguments);
      };
      // wx.onError
      try {
        wx.onError((errMsg) => { errors.push('[onError] ' + errMsg); });
      } catch {}
      // wx.onUnhandledRejection
      try {
        wx.onUnhandledRejection((res) => {
          errors.push('[unhandledRejection] ' + (res && res.reason ? (res.reason.message || String(res.reason)) : 'unknown'));
        });
      } catch {}
      return true;
    }), 8000, 'inject');

    // 3. 走 5 步选择
    const steps = [
      { step: 'category', value: 'iphone', expectedStep: 1 },
      { step: 'budget', value: 5000, expectedStep: 2 },
      { step: 'holdingYears', value: 3, expectedStep: 3 },
      { step: 'buyTiming', value: 'used', expectedStep: 4 },
      { step: 'performanceFloor', value: 0.5, expectedStep: 5 },
    ];

    for (const s of steps) {
      logInfo(`选择 ${s.step}=${s.value}...`);
      const fn = new Function(
        `const pages = getCurrentPages();
         const p = pages[pages.length - 1];
         p.onSelectOption({ currentTarget: { dataset: { step: ${JSON.stringify(s.step)}, value: ${JSON.stringify(s.value)} } } });
         return { ok: true };`,
      );
      await withTimeout(mp.evaluate(fn), 8000, `select ${s.step}`);
      await new Promise((r) => setTimeout(r, 800));

      // 检查是否已跳到 result 页
      const cur = await withTimeout(mp.evaluate(() => {
        const pages = getCurrentPages();
        const p = pages[pages.length - 1];
        return { route: p?.route, currentStep: p?.data?.currentStep };
      }), 5000, 'check route');
      logInfo(`  当前: route=${cur.route}, currentStep=${cur.currentStep}`);

      if (cur.route === 'pages/result/result') {
        logPass('已跳转到结果页');
        break;
      }
    }

    // 4. 等待结果加载与图表渲染
    logInfo('等待结果加载...');
    await new Promise((r) => setTimeout(r, 5000));

    // 5. 检查图表初始化
    const chartStatus = await withTimeout(mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      const chart = p.selectComponent('#chart');
      const ec = chart ? chart.selectComponent('#ec-canvas') : null;
      return {
        route: p?.route,
        loading: p?.data?.loading,
        error: p?.data?.error,
        plansLen: p?.data?.plans?.length,
        frontierLen: p?.data?.frontier?.length,
        chartInited: chart?.data?.initialized,
        chartInstanceOk: !!chart?.chartInstance,
        ecHasChart: !!ec?.chart,
        ecHasCanvasNode: !!ec?.canvasNode,
      };
    }), 8000, 'chartStatus');
    console.log('\n--- 状态 ---');
    console.log(JSON.stringify(chartStatus, null, 2));

    // 6. 读取所有捕获的错误
    const allErrors = await withTimeout(mp.evaluate(() => (wx).__testErrors || []), 8000, 'allErrors');
    console.log('\n--- 全部捕获错误 (' + allErrors.length + ' 条) ---');
    allErrors.forEach((e, i) => console.log(`  [${i + 1}] ${e}`));

    if (allErrors.length === 0) {
      logPass('流程无任何 console.error/warn/异常');
    } else {
      logFail(`流程捕获到 ${allErrors.length} 个错误`);
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
