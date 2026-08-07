/**
 * result-flow.js — 走通 5 步决策树 → 结果页，捕获结果页的 5 个 error
 *
 * 流程:
 *  1. reLaunch 到 decision-tree
 *  2. 依次 onSelectOption: category=iphone, budget=5000, holdingYears=3,
 *     buyTiming=used, performanceFloor=0.5
 *  3. 等待跳转到 result 页
 *  4. 读取 result 页 data (loading / error / plans / frontier ...)
 *  5. 用 wx.createSelectorQuery 抓取页面渲染结构
 *  6. 输出失败诊断
 */
const { connect, section, logPass, logInfo, logFail } = require('./helper');

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`[TIMEOUT ${ms}ms] ${label}`)), ms)),
  ]);
}

async function selectStep(mp, step, value, expectedStep) {
  // automator 0.12.1 evaluate 不一定支持传参, 用闭包字符串 hardcode
  const fn = new Function(
    `const pages = getCurrentPages();
     const p = pages[pages.length - 1];
     p.onSelectOption({ currentTarget: { dataset: { step: ${JSON.stringify(step)}, value: ${JSON.stringify(value)} } } });
     return { step: ${JSON.stringify(step)}, value: ${JSON.stringify(value)}, beforeStep: p.data.currentStep };`,
  );
  await withTimeout(mp.evaluate(fn), 8000, `select ${step}=${value}`);

  // 轮询等待 currentStep 推进 (devtools 下 setTimeout 链可能延迟)
  const start = Date.now();
  let last = null;
  while (Date.now() - start < 5000) {
    await new Promise((r) => setTimeout(r, 300));
    last = await withTimeout(mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      return {
        route: p?.route,
        currentStep: p?.data?.currentStep,
        selections: p?.data?.selections,
        progress: p?.data?.progress,
      };
    }), 8000, 'verify step');
    // 期望推进到 expectedStep, 或已经跳到 result 页
    if (last.route !== 'pages/decision-tree/decision-tree') break;
    if (typeof last.currentStep === 'number' && last.currentStep >= expectedStep) break;
  }
  logInfo(`  after ${step}=${value}: route=${last.route}, currentStep=${last.currentStep}, progress=${last.progress}%, selections=${JSON.stringify(last.selections)}`);
}

async function readResultData(mp) {
  return await withTimeout(mp.evaluate(() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    return {
      route: p?.route,
      dataKeys: Object.keys(p?.data || {}),
      loading: p?.data?.loading,
      error: p?.data?.error,
      isEmpty: p?.data?.isEmpty,
      relaxedHint: p?.data?.relaxedHint,
      plansLen: (p?.data?.plans || []).length,
      frontierLen: (p?.data?.frontier || []).length,
      dominatedLen: (p?.data?.dominated || []).length,
      hasRecRange: !!p?.data?.recommendationRange,
      performanceFloor: p?.data?.performanceFloor,
      lastUpdated: p?.data?.lastUpdated,
      freshnessLevel: p?.data?.freshnessLevel,
      days: p?.data?.days,
      params: p?.data?.params,
      // 第一个方案的结构 (验证字段完整性)
      firstPlan: p?.data?.plans?.[0] || null,
    };
  }), 8000, 'readResultData');
}

async function readRenderedStructure(mp) {
  return await withTimeout(mp.evaluate(() => {
    return new Promise((resolve) => {
      const result = { errors: [], nodes: {} };
      try {
        wx.createSelectorQuery()
          .selectAll('.state-text')
          .fields({ id: true, dataset: true, rect: true, size: true, text: true })
          .exec((res) => {
            result.nodes.stateTexts = (res[0] || []).map((r) => ({ text: r.text }));
            resolve(result);
          });
      } catch (e) {
        result.errors.push('selectorQuery error: ' + e.message);
        resolve(result);
      }
    });
  }), 8000, 'readRenderedStructure');
}

async function run() {
  section('决策树 → 结果页 端到端');
  const mp = await connect();
  logPass('已连接 ws://127.0.0.1:9420');

  try {
    // 0. 先 reLaunch 到 decision-tree (已知能正常工作), 然后注入错误捕获
    logInfo('reLaunch 到 decision-tree 以注入错误捕获...');
    await withTimeout(mp.reLaunch('/pages/decision-tree/decision-tree'), 45000, 'reLaunch dt');
    await new Promise((r) => setTimeout(r, 1500));

    // 0.5 注入全局错误捕获
    logInfo('注入全局错误捕获...');
    await withTimeout(mp.evaluate(() => {
      const errors = [];
      try { (wx).__testErrors = errors; } catch (e) {}
      try {
        const origConsoleError = console.error;
        console.error = function () {
          try {
            const args = Array.prototype.slice.call(arguments);
            errors.push('[err] ' + args.map(a => { try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch { return String(a); } }).join(' '));
          } catch (e) {}
          return origConsoleError.apply(this, arguments);
        };
      } catch (e) {}
      try {
        const origConsoleWarn = console.warn;
        console.warn = function () {
          try {
            const args = Array.prototype.slice.call(arguments);
            errors.push('[warn] ' + args.map(a => { try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch { return String(a); } }).join(' '));
          } catch (e) {}
          return origConsoleWarn.apply(this, arguments);
        };
      } catch (e) {}
      return true;
    }), 8000, 'inject error capture');

    // 直接 reLaunch 到结果页 (带上完整 query), 隔离 decision-tree 干扰
    const query = 'category=iphone&budget=5000&buyTiming=used&performanceFloor=0.5&holdingYears=3';
    logInfo(`reLaunch 到 /pages/result/result?${query}`);
    await withTimeout(mp.reLaunch(`/pages/result/result?${query}`), 45000, 'reLaunch result');
    await new Promise((r) => setTimeout(r, 3000));

    // 0.5 读取捕获的错误
    const captured = await withTimeout(mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      return {
        errors: (wx).__testErrors || [],
        pagesLen: pages.length,
        pageRoute: p?.route,
        pageDataKeys: Object.keys(p?.data || {}),
        pageHasOnLoad: typeof p?.onLoad,
        pageMethods: p ? Object.keys(p).filter(k => typeof p[k] === 'function').slice(0, 30) : [],
      };
    }), 8000, 'read captured');
    console.log('\n--- 捕获的错误 ---');
    console.log(JSON.stringify(captured, null, 2));

    // 确认页面路径
    const cur = await withTimeout(mp.currentPage(), 8000, 'currentPage');
    logInfo(`当前页: ${cur?.path}`);

    // 4. 读取 result 页 data
    const data = await readResultData(mp);
    console.log('\n--- 结果页 data ---');
    console.log(JSON.stringify(data, null, 2));

    // 5. 多轮等待 loading 完成 (compute 可能慢)
    let tries = 0;
    let lastData = data;
    while (lastData.loading && tries < 5) {
      tries++;
      await new Promise((r) => setTimeout(r, 1000));
      lastData = await readResultData(mp);
      logInfo(`轮询 ${tries}: loading=${lastData.loading}, error=${lastData.error || '无'}`);
    }
    if (tries > 0) {
      console.log('\n--- 最终 data ---');
      console.log(JSON.stringify(lastData, null, 2));
    }

    // 6. 检查 ec-canvas / pareto-chart 组件状态 (轮询等待 chart init)
    logInfo('检查 pareto-chart 组件状态 (轮询等待 chart init)...');
    let chartStatus = null;
    for (let i = 0; i < 10; i++) {
      chartStatus = await withTimeout(mp.evaluate(() => {
        const pages = getCurrentPages();
        const p = pages[pages.length - 1];
        const chart = p && p.selectComponent ? p.selectComponent('#chart') : null;
        const ecCanvas = chart ? chart.selectComponent('#ec-canvas') : null;
        return {
          hasChart: !!chart,
          chartInitialized: chart?.data?.initialized,
          hasChartInstance: !!chart?.data?.chartInstance,
          frontierLen: chart?.properties?.frontier?.length,
          dominatedLen: chart?.properties?.dominated?.length,
          hasRecRange: !!chart?.properties?.recommendationRange,
          hasEcCanvas: !!ecCanvas,
          newErrors: ((wx).__testErrors || []).slice(-10),
        };
      }), 8000, 'chartStatus');
      console.log(`  尝试 ${i + 1}: hasChart=${chartStatus.hasChart}, initialized=${chartStatus.chartInitialized}, hasEcCanvas=${chartStatus.hasEcCanvas}, newErrors=${chartStatus.newErrors.length}`);
      if (chartStatus.chartInitialized || chartStatus.newErrors.length > 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log('\n--- 图表组件状态 ---');
    console.log(JSON.stringify(chartStatus, null, 2));
    // 输出最新捕获的错误
    if (chartStatus.newErrors.length > 0) {
      console.log('\n--- 新捕获错误 ---');
      chartStatus.newErrors.forEach((e, i) => console.log(`  [${i + 1}] ${e}`));
    }

    // 7. 抓取渲染结构 (state-text 等)
    const rendered = await readRenderedStructure(mp);
    console.log('\n--- 渲染结构 ---');
    console.log(JSON.stringify(rendered, null, 2));

    // 8. 列出 result 页 wxml 中所有可见区块 (按 class 分类)
    const blocks = await withTimeout(mp.evaluate(() => {
      return new Promise((resolve) => {
        const query = wx.createSelectorQuery();
        query
          .selectAll('.state-wrap, .empty-card, .conclusion-card, .chart-card, .share-btn-wrap, .footer, .plan-card, .plan-model, .metric-value, .badge')
          .fields({ id: true, dataset: true, rect: true, size: true })
          .exec((res) => {
            const items = (res[0] || []).map((r) => ({
              top: Math.round(r.top || 0),
              left: Math.round(r.left || 0),
              width: Math.round(r.width || 0),
              height: Math.round(r.height || 0),
            }));
            resolve({ count: items.length, items: items.slice(0, 30) });
          });
      });
    }), 8000, 'blocks');
    console.log('\n--- 可见区块 ---');
    console.log(JSON.stringify(blocks, null, 2));

    // 9. 详细检查 chart 组件的 ec-canvas 状态
    logInfo('详细检查 ec-canvas 状态...');
    const ecStatus = await withTimeout(mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      const chart = p.selectComponent('#chart');
      const ec = chart ? chart.selectComponent('#ec-canvas') : null;
      const ci = chart ? chart.data.chartInstance : undefined;
      return {
        chartInitialized: chart ? chart.data.initialized : null,
        chartInstanceType: typeof ci,
        chartInstanceIsNull: ci === null,
        chartInstanceIsUndef: ci === undefined,
        chartInstanceTruthy: !!ci,
        chartInstanceKeys: ci && typeof ci === 'object' ? Object.keys(ci).slice(0, 10) : null,
        chartInstanceHasSetOption: ci ? typeof ci.setOption : null,
        chartInstanceHasInit: ci ? typeof ci.init : null,
        ecData: ec ? JSON.stringify(ec.data) : null,
        ecHasChart: ec ? !!ec.chart : false,
        ecChartType: ec ? typeof ec.chart : null,
        ecHasCanvasNode: ec ? !!ec.canvasNode : false,
      };
    }), 8000, 'ecStatus');
    console.log('\n--- ec-canvas 状态 ---');
    console.log(JSON.stringify(ecStatus, null, 2));

    // 9.6 尝试手动触发 chart init + 直接调用 updateChart
    logInfo('尝试手动调用 updateChart...');
    const manualInit = await withTimeout(mp.evaluate(() => {
      const errors = (wx).__testErrors || [];
      try {
        const pages = getCurrentPages();
        const p = pages[pages.length - 1];
        const chart = p.selectComponent('#chart');
        if (!chart) return { error: 'no chart component' };
        // 直接调用 updateChart (chartInstance 已存在)
        if (chart.data.chartInstance && typeof chart.updateChart === 'function') {
          chart.updateChart();
          // 同时手动设置 initialized
          chart.setData({ initialized: true });
          return { ok: true, message: 'updateChart + setData called' };
        }
        return { error: 'no chartInstance or updateChart', hasInstance: !!chart.data.chartInstance, hasUpdate: typeof chart.updateChart };
      } catch (e) {
        errors.push('[manualUpdate] ' + e.message + ' | ' + e.stack);
        return { error: e.message, stack: e.stack };
      }
    }), 8000, 'manualInit');
    console.log('\n--- 手动触发 ---');
    console.log(JSON.stringify(manualInit, null, 2));
    await new Promise((r) => setTimeout(r, 1500));

    // 9.7 再次检查 chart 状态
    const chartStatus2 = await withTimeout(mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      const chart = p.selectComponent('#chart');
      const ec = chart ? chart.selectComponent('#ec-canvas') : null;
      const ci = chart ? chart.data.chartInstance : undefined;
      return {
        chartInitialized: chart ? chart.data.initialized : null,
        chartInstanceTruthy: !!ci,
        ecHasChart: ec ? !!ec.chart : null,
        newErrors: ((wx).__testErrors || []).slice(-5),
      };
    }), 8000, 'chartStatus2');
    console.log('\n--- 手动触发后状态 ---');
    console.log(JSON.stringify(chartStatus2, null, 2));

    // 9.5 查询 chart-card / canvas 的实际尺寸
    logInfo('查询 chart-card 与 canvas 实际尺寸...');
    const chartLayout = await withTimeout(mp.evaluate(() => {
      return new Promise((resolve) => {
        wx.createSelectorQuery()
          .selectAll('.chart-card, .conclusion-card, .share-btn-wrap, .footer, .ec-canvas, canvas')
          .fields({ id: true, dataset: true, rect: true, size: true, node: true })
          .exec((res) => {
            const items = (res[0] || []).map((r) => ({
              id: r.id || '',
              top: Math.round(r.top || 0),
              left: Math.round(r.left || 0),
              width: Math.round(r.width || 0),
              height: Math.round(r.height || 0),
              hasNode: !!r.node,
            }));
            resolve(items);
          });
      });
    }), 8000, 'chartLayout');
    console.log('\n--- 图表与按钮布局 ---');
    console.log(JSON.stringify(chartLayout, null, 2));

    // 10. 读取所有捕获的错误
    const allErrors = await withTimeout(mp.evaluate(() => {
      return (wx).__testErrors || [];
    }), 8000, 'allErrors');
    console.log('\n--- 全部捕获错误 (' + allErrors.length + ' 条) ---');
    allErrors.forEach((e, i) => console.log(`  [${i + 1}] ${e}`));
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
