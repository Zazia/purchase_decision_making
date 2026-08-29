/**
 * verify-bugfix-smoke.js — fix-budget-relax-and-manual-scheme-bugs 变更的 5.2 自动化冒烟
 *
 * 覆盖三个 bug 的端到端验证 (全部通过 mp.evaluate, 规避 page.data()/$() 超时问题):
 *
 *  用例 1 (Bug 1): 低预算自动放宽后操作按钮可见
 *    - reLaunch result?category=iphone&budget=500 → 触发放宽兜底
 *    - 断言 relaxedHint 非空 + plans.length > 0 (放宽后有方案)
 *    - 断言「查看完整报告」「手动修改方案」两个入口均渲染 (宽高 > 0)
 *
 *  用例 2 (Bug 2): 用户自添加方案性能计算正确
 *    - reLaunch result?category=macbook-pro → 进编辑器 → 新增 M3_Pro 16G/512G 二手方案
 *    - 重算后断言自添加方案 avgPerformance > 0 (此前品类误判导致为 0/错值)
 *    - 若同配置快照方案 (M3Pro_14寸_16G_512G_二手) 也在重算结果中, 断言两者 avgPerformance 一致
 *
 *  用例 3 (Bug 3): 重算后自添加方案出现在完整报告
 *    - onOpenReport → report 页
 *    - 断言 reportData.isUserModified=true 且 report 页 data.frontier/dominated 含自添加方案
 *
 * 运行: AUTOTEST_PORT=25040 node verify-bugfix-smoke.js  (端口默认 9420)
 */
const { connect, section, logPass, logInfo, logFail, assert } = require('./helper');

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`[TIMEOUT ${ms}ms] ${label}`)), ms)),
  ]);
}

/** 轮询 evaluate 直到 fn 返回真值 (fn 在小程序运行时内执行) */
async function pollEvaluate(mp, fnSource, { timeout = 15000, interval = 400, label = 'poll' } = {}) {
  const fn = new Function(`return (${fnSource})();`);
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await withTimeout(mp.evaluate(fn), 8000, label);
    if (last && last.__done) return last.value;
    await new Promise((r) => setTimeout(r, interval));
  }
  return last; // 超时返回最后一次结果
}

/** 读取 result 页关键字段 */
async function readResultState(mp) {
  return await withTimeout(mp.evaluate(() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    return {
      route: p?.route,
      loading: p?.data?.loading,
      error: p?.data?.error,
      isEmpty: p?.data?.isEmpty,
      relaxedHint: p?.data?.relaxedHint,
      plansLen: (p?.data?.plans || []).length,
      editorMode: p?.data?.editorMode,
      editorShowAddForm: p?.data?.editorShowAddForm,
      hasEdits: p?.data?.hasEdits,
      viewMode: p?.data?.viewMode,
    };
  }), 8000, 'readResultState');
}

/** 查询一组选择器的可见性 (宽高 > 0 即渲染) */
async function queryVisible(mp, selector) {
  return await withTimeout(mp.evaluate((sel) => {
    return new Promise((resolve) => {
      wx.createSelectorQuery()
        .selectAll(sel)
        .fields({ rect: true, size: true })
        .exec((res) => {
          const items = (res[0] || []).map((r) => ({
            width: Math.round(r.width || 0),
            height: Math.round(r.height || 0),
          }));
          resolve({ total: items.length, visible: items.filter((i) => i.width > 0 && i.height > 0).length });
        });
    });
  }, selector), 8000, `queryVisible ${selector}`);
}

// ============================================================================
// 用例 1: 低预算自动放宽后按钮可见 (Bug 1)
// ============================================================================
async function testCase1(mp) {
  section('用例 1: 低预算放宽 — 提示 + 放宽方案 + 操作按钮可见 (Bug 1)');
  logInfo('reLaunch: iphone / budget=500 / used / floor=0.5 / 3年');
  await withTimeout(mp.reLaunch('/pages/result/result?category=iphone&budget=500&buyTiming=used&performanceFloor=0.5&holdingYears=3'), 45000, 'reLaunch case1');

  // 轮询等待 loading 结束
  const state = await pollEvaluate(mp, `() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    if (p && p.route === 'pages/result/result' && p.data && p.data.loading === false) {
      return { __done: true, value: {
        relaxedHint: p.data.relaxedHint || '',
        plansLen: (p.data.plans || []).length,
        isEmpty: !!p.data.isEmpty,
        error: p.data.error || '',
      } };
    }
    return { __done: false };
  }`, { timeout: 20000, label: 'case1 loading' });

  assert(state && state.__done !== false && state.relaxedHint !== undefined, '用例1: 未等到 loading 完成');
  logInfo(`relaxedHint="${state.relaxedHint}" plans=${state.plansLen} isEmpty=${state.isEmpty} error="${state.error || '无'}"`);
  assert(state.relaxedHint.length > 0, `用例1: 放宽提示应非空 (实际: "${state.relaxedHint}")`);
  assert(state.plansLen > 0, `用例1: 放宽后应有可行方案 (实际: ${state.plansLen})`);

  // 断言操作按钮可见 (此前 bug: 空结果时按钮被 wx:if 隐藏)
  const entries = await queryVisible(mp, '.report-entry');
  logInfo(`.report-entry 渲染数: ${entries.total}, 可见数: ${entries.visible}`);
  assert(entries.total >= 2, `用例1: 「查看完整报告」+「手动修改方案」两个入口都应渲染 (实际: ${entries.total})`);
  assert(entries.visible >= 2, `用例1: 两个入口都应可见 (实际可见: ${entries.visible})`);
  logPass('Bug 1 验证通过: 放宽提示 + 放宽方案 + 报告/编辑入口均正常');
}

// ============================================================================
// 用例 2 + 3: 手动添加方案 → 重算 → 报告 (Bug 2 + Bug 3)
// ============================================================================
async function testCase23(mp) {
  section('用例 2/3: 手动添加 M3_Pro 方案 → 重算 → 完整报告 (Bug 2 + Bug 3)');
  logInfo('reLaunch: macbook-pro / budget=20000 / used / floor=0.5 / 3年');
  await withTimeout(mp.reLaunch('/pages/result/result?category=macbook-pro&budget=20000&buyTiming=used&performanceFloor=0.5&holdingYears=3'), 45000, 'reLaunch case2');
  await new Promise((r) => setTimeout(r, 2000));

  // 等待计算完成且有方案
  const init = await pollEvaluate(mp, `() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    if (p && p.route === 'pages/result/result' && p.data && p.data.loading === false && (p.data.plans || []).length > 0) {
      return { __done: true, value: { plansLen: p.data.plans.length, error: p.data.error || '' } };
    }
    return { __done: false };
  }`, { timeout: 25000, label: 'case2 loading' });
  assert(init && init.__done !== false, '用例2: 结果页计算未完成');
  logInfo(`初始方案数: ${init.plansLen}`);

  // 清空编辑器草稿, 避免历史测试残留污染
  const cleared = await withTimeout(mp.evaluate(() => {
    const info = wx.getStorageInfoSync();
    const keys = (info.keys || []).filter((k) => k.indexOf('scheme_editor_draft_') === 0);
    keys.forEach((k) => wx.removeStorageSync(k));
    return { removed: keys.length };
  }), 8000, 'clear drafts');
  logInfo(`已清理编辑器草稿: ${cleared.removed} 个`);

  // 进入编辑器
  await withTimeout(mp.evaluate(async () => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    await p.onEnterEditor();
  }), 15000, 'onEnterEditor');
  const editorState = await pollEvaluate(mp, `() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    if (p && p.data && p.data.editorMode === 'edit') return { __done: true, value: { groups: (p.data.editorDisplayGroups || []).length } };
    return { __done: false };
  }`, { timeout: 10000, label: 'editorMode' });
  assert(editorState && editorState.__done !== false, '用例2: 未进入编辑模式');
  logPass(`已进入编辑器 (分组数: ${editorState.groups})`);

  // 打开新增表单
  await withTimeout(mp.evaluate(() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    p.onEditorShowAddForm();
  }), 8000, 'onEditorShowAddForm');

  // 直接注入表单数据并提交 (M3_Pro 16G/512G 二手 15000元 持有3年)
  await withTimeout(mp.evaluate(() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    p.setData({
      editorAddForm: {
        model: 'MacBook Pro',
        chip: 'M3_Pro',
        memoryGb: 16,
        storageGb: 512,
        buyTiming: 'used',
        buyPrice: 15000,
        holdingYears: 3,
      },
    });
    p.onEditorAddPlan();
  }), 8000, 'onEditorAddPlan');

  const afterAdd = await pollEvaluate(mp, `() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    if (p && p.data && p.data.editorShowAddForm === false && p.data.hasEdits === true) {
      return { __done: true, value: { hasEdits: p.data.hasEdits } };
    }
    return { __done: false };
  }`, { timeout: 10000, label: 'after add' });
  assert(afterAdd && afterAdd.__done !== false, '用例2: 自添加方案未提交成功');
  logPass('自添加方案已提交 (表单关闭, hasEdits=true)');

  // 重算
  await withTimeout(mp.evaluate(async () => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    await p.onEditorRecompute();
  }), 30000, 'onEditorRecompute');

  const afterRecompute = await pollEvaluate(mp, `() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    if (p && p.data && p.data.viewMode === 'userModified' && p.data.editorMode === 'view') {
      return { __done: true, value: true };
    }
    return { __done: false };
  }`, { timeout: 15000, label: 'viewMode userModified' });
  assert(afterRecompute && afterRecompute.__done !== false, '用例2: 重算后未切换到用户修改版');
  logPass('重算完成, viewMode=userModified');

  // 读取重算结果, 校验自添加方案性能 (Bug 2 核心)
  const recomputed = await withTimeout(mp.evaluate(() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    const all = [...(p.data.userModified?.frontier || []), ...(p.data.userModified?.dominated || [])];
    const custom = all.filter((x) => x.model && x.model.indexOf('MacBook Pro_二手') === 0);
    const snapshot = all.filter((x) => x.model && x.model.indexOf('M3Pro') === 0 && x.buyTiming === 'used'
      && x.holdingYears === 3 && x.memoryGb === 16 && x.storageGb === 512);
    const brief = (x) => x && ({
      model: x.model, chip: x.chip, buyPrice: Math.round(x.buyPrice),
      avgPerformance: x.avgPerformance, monthlyCost: Math.round(x.monthlyCost * 100) / 100,
      performanceS0: x.performanceS0,
    });
    return {
      custom: custom.map(brief),
      snapshotSameConfig: snapshot.map(brief),
      frontierLen: (p.data.userModified?.frontier || []).length,
      dominatedLen: (p.data.userModified?.dominated || []).length,
    };
  }), 8000, 'read recomputed');

  console.log(JSON.stringify(recomputed, null, 2));
  assert(recomputed.custom.length > 0, '用例2: 重算结果中找不到自添加方案 (MacBook Pro_二手 × 3年)');

  const custom = recomputed.custom[0];
  assert(custom.avgPerformance > 0, `用例2: 自添加方案性能应 > 0 (实际: ${custom.avgPerformance}, 此前品类误判时为 0/错值)`);
  assert(custom.monthlyCost > 0, `用例2: 自添加方案月均成本应 > 0 (实际: ${custom.monthlyCost})`);
  logPass(`Bug 2 验证通过: 自添加方案 avgPerformance=${custom.avgPerformance} (>0), monthlyCost=${custom.monthlyCost}`);

  if (recomputed.snapshotSameConfig.length > 0) {
    const snap = recomputed.snapshotSameConfig[0];
    const diff = Math.abs(snap.avgPerformance - custom.avgPerformance);
    logInfo(`同配置快照方案: ${snap.model} avgPerformance=${snap.avgPerformance} (差值: ${diff.toFixed(6)})`);
    assert(diff < 0.005, `用例2: 自添加方案与同配置快照方案性能应一致 (差值: ${diff})`);
    logPass('自添加方案与同配置快照方案性能一致 (品类判定正确)');
  } else {
    logInfo('(重算结果中无同配置快照方案, 跳过一致性对比, 仅验证性能 > 0)');
  }

  // 打开完整报告 (Bug 3: 此前读缓存快照导致自添加方案不出现)
  await withTimeout(mp.evaluate(() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    p.onOpenReport();
  }), 8000, 'onOpenReport');

  const reportState = await pollEvaluate(mp, `() => {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    if (p && p.route === 'pages/report/report' && p.data && p.data.loading === false) {
      const all = [...(p.data.frontier || []), ...(p.data.dominated || [])];
      const custom = all.filter((x) => x.model && x.model.indexOf('MacBook Pro_二手') === 0);
      const app = getApp();
      const rd = app.globalData && app.globalData.reportData;
      return { __done: true, value: {
        error: p.data.error || '',
        frontierLen: (p.data.frontier || []).length,
        dominatedLen: (p.data.dominated || []).length,
        allCandidateTotal: p.data.allCandidateTotal,
        customInReport: custom.map((x) => ({ model: x.model, avgPerformance: x.avgPerformance })),
        reportDataIsUserModified: !!(rd && rd.isUserModified),
      } };
    }
    return { __done: false };
  }`, { timeout: 20000, label: 'report page' });

  assert(reportState && reportState.__done !== false, '用例3: 报告页未加载完成');
  console.log(JSON.stringify(reportState, null, 2));
  assert(reportState.error === '', `用例3: 报告页不应有错误 (实际: "${reportState.error}")`);
  assert(reportState.reportDataIsUserModified === true, '用例3: reportData.isUserModified 应为 true (使用重算数据而非缓存快照)');
  assert(reportState.customInReport.length > 0, '用例3: 报告中应包含自添加方案 (MacBook Pro_二手 × 3年)');
  logPass(`Bug 3 验证通过: 报告包含自添加方案 (性能=${reportState.customInReport[0].avgPerformance}), allCandidateTotal=${reportState.allCandidateTotal}`);

  // 收尾: 返回决策树首页, 清理本次 draft
  await withTimeout(mp.evaluate(() => {
    const info = wx.getStorageInfoSync();
    (info.keys || []).filter((k) => k.indexOf('scheme_editor_draft_') === 0).forEach((k) => wx.removeStorageSync(k));
  }), 8000, 'cleanup drafts');
}

async function run() {
  section('fix-budget-relax-and-manual-scheme-bugs — 5.2 自动化冒烟');
  const mp = await connect();
  const port = process.env.AUTOTEST_PORT || 9420;
  logPass(`已连接 ws://127.0.0.1:${port}`);

  let failed = 0;
  try {
    await testCase1(mp);
  } catch (err) {
    failed++;
    logFail(`用例 1 失败: ${err.message}`);
  }
  try {
    await testCase23(mp);
  } catch (err) {
    failed++;
    logFail(`用例 2/3 失败: ${err.message}`);
  }

  try {
    await mp.reLaunch('/pages/decision-tree/decision-tree');
  } catch { /* 忽略收尾错误 */ }
  await mp.close();

  section(failed === 0 ? '全部通过 ✅' : `有 ${failed} 组用例失败 ❌`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
