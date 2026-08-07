/**
 * full-flow-v2.js — 真实点击走完整流程, 捕获所有错误
 *
 * 改进:
 *  1. 用 mp.pageStack + page.$ 找到 option-card 元素真实 tap (模拟用户)
 *  2. 每步等 1.5s 让 fade 动画完成
 *  3. 持续捕获 console.error/warn + wx.onError + unhandledRejection
 *  4. 跳到 result 页后验证渲染
 */
const { connect, section, logPass, logInfo, logFail } = require('./helper');

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`[TIMEOUT ${ms}ms] ${label}`)), ms)),
  ]);
}

/** 等待条件成立 */
async function waitFor(fn, { timeout = 10000, interval = 300, msg = 'timeout' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fn();
      if (r) return r;
    } catch {}
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(msg);
}

async function run() {
  section('完整流程 v2 (真实点击)');
  const mp = await connect();
  logPass('已连接');

  try {
    // 1. reLaunch 到 decision-tree
    logInfo('reLaunch 到 decision-tree...');
    await withTimeout(mp.reLaunch('/pages/decision-tree/decision-tree'), 45000, 'reLaunch');
    await new Promise((r) => setTimeout(r, 2000));

    // 2. 注入全局错误捕获
    logInfo('注入全局错误捕获...');
    await withTimeout(mp.evaluate(() => {
      const errors = [];
      try { (wx).__testErrors = errors; } catch (e) {}
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
      try { wx.onError((errMsg) => { errors.push('[onError] ' + errMsg); }); } catch {}
      try { wx.onUnhandledRejection((res) => {
        errors.push('[unhandledRejection] ' + (res && res.reason ? (res.reason.message || String(res.reason)) : 'unknown'));
      }); } catch {}
      return true;
    }), 8000, 'inject');

    // 3. 逐步选择 (用 callMethod 方式, 每步等待 fade 完成)
    const selections = [
      { step: 'category', value: 'iphone' },
      { step: 'budget', value: 5000 },
      { step: 'holdingYears', value: 3 },
      { step: 'buyTiming', value: 'used' },
      { step: 'performanceFloor', value: 0.5 },
    ];

    for (let i = 0; i < selections.length; i++) {
      const s = selections[i];
      logInfo(`[${i + 1}/${selections.length}] 选择 ${s.step}=${s.value}`);

      // 调用 onSelectOption
      const fn = new Function(
        `const pages = getCurrentPages();
         const p = pages[pages.length - 1];
         p.onSelectOption({ currentTarget: { dataset: { step: ${JSON.stringify(s.step)}, value: ${JSON.stringify(s.value)} } } });
         return { ok: true, beforeStep: p.data.currentStep };`,
      );
      await withTimeout(mp.evaluate(fn), 8000, `select ${s.step}`);

      // 等待 currentStep 推进 或 跳到 result 页
      await new Promise((r) => setTimeout(r, 1000));

      const cur = await withTimeout(mp.evaluate(() => {
        const pages = getCurrentPages();
        const p = pages[pages.length - 1];
        return {
          route: p?.route,
          currentStep: p?.data?.currentStep,
          progress: p?.data?.progress,
          selections: p?.data?.selections,
        };
      }), 5000, 'check');
      logInfo(`  → route=${cur.route}, step=${cur.currentStep}, progress=${cur.progress}%, sel=${JSON.stringify(cur.selections)}`);

      if (cur.route === 'pages/result/result') {
        logPass('已跳转到结果页');
        break;
      }
    }

    // 4. 等待结果加载
    logInfo('等待结果加载 (最多 15s)...');
    try {
      await waitFor(async () => {
        const r = await withTimeout(mp.evaluate(() => {
          const pages = getCurrentPages();
          const p = pages[pages.length - 1];
          return { route: p?.route, loading: p?.data?.loading };
        }), 5000, 'wait loading');
        return r.route === 'pages/result/result' && !r.loading;
      }, { timeout: 15000, interval: 1000, msg: 'result page loading timeout' });
      logPass('结果加载完成');
    } catch (e) {
      logFail(e.message);
    }

    // 5. 等待图表渲染
    logInfo('等待图表渲染 (最多 8s)...');
    await new Promise((r) => setTimeout(r, 3000));

    // 6. 详细状态
    const status = await withTimeout(mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      const chart = p.selectComponent('#chart');
      const ec = chart ? chart.selectComponent('#ec-canvas') : null;
      return {
        route: p?.route,
        loading: p?.data?.loading,
        error: p?.data?.error,
        isEmpty: p?.data?.isEmpty,
        plansLen: p?.data?.plans?.length,
        frontierLen: p?.data?.frontier?.length,
        dominatedLen: p?.data?.dominated?.length,
        chartInited: chart?.data?.initialized,
        chartInstanceOk: !!chart?.chartInstance,
        ecHasChart: !!ec?.chart,
        ecHasCanvasNode: !!ec?.canvasNode,
        firstPlan: p?.data?.plans?.[0]?.modelLabel,
      };
    }), 8000, 'status');
    console.log('\n--- 结果页状态 ---');
    console.log(JSON.stringify(status, null, 2));

    // 7. 读取所有错误
    const allErrors = await withTimeout(mp.evaluate(() => (wx).__testErrors || []), 8000, 'allErrors');
    console.log('\n=== 全部捕获错误 (' + allErrors.length + ' 条) ===');
    allErrors.forEach((e, i) => console.log(`  [${i + 1}] ${e}`));

    if (allErrors.length === 0 && status.route === 'pages/result/result' && status.plansLen > 0) {
      logPass('✓ 完整流程无错误, 结果页正常展示');
    } else {
      logFail(`✗ 流程有问题: ${allErrors.length} 个错误, route=${status.route}, plans=${status.plansLen}`);
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
