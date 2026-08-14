/**
 * diagnose-filter-multi.js — 端到端验证多维度筛选交叉修复
 * 场景: 取消128G → 取消"16 pro"型号 → 恢复"16 pro"
 * 预期: 恢复"16 pro"后, 16 pro 256G/512G 恢复, 但 16 pro 128G 保持暂不考虑(因128G仍取消)
 */
const { connect, section, logInfo, logPass, logFail } = require('./helper');

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`[TIMEOUT ${ms}ms] ${label}`)), ms)),
  ]);
}

async function waitFor(fn, { timeout = 10000, interval = 500, msg = 'timeout' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const r = await fn(); if (r) return r; } catch {}
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(msg);
}

// 通过 evaluate 读当前 deferred/active 状态
async function readState(mp) {
  return await withTimeout(mp.evaluate(() => {
    const p = getCurrentPages().slice(-1)[0];
    const pts = p.data.editorSnapshot?.points || [];
    return {
      deferredModels: pts.filter(x => x.deferred).map(x => x.model).sort(),
      activeModels: pts.filter(x => !x.deferred).map(x => x.model).sort(),
      filterStorage: p.data.filterStorage || [],
      filterChips: p.data.filterChips || [],
    };
  }), 8000, 'readState');
}

async function toggle(mp, dim, value) {
  const fn = new Function(
    `const p = getCurrentPages().slice(-1)[0];
     p.onFilterToggle({ currentTarget: { dataset: { dim: ${JSON.stringify(dim)}, value: ${JSON.stringify(value)} } } });
     return true;`,
  );
  await withTimeout(mp.evaluate(fn), 8000, `toggle ${dim}=${value}`);
  await new Promise((r) => setTimeout(r, 800));
}

async function run() {
  section('多维度筛选交叉验证');
  const mp = await connect();
  logPass('已连接');

  try {
    await withTimeout(mp.reLaunch('/pages/decision-tree/decision-tree'), 45000, 'reLaunch');
    await new Promise((r) => setTimeout(r, 2000));

    const selections = [
      { step: 'category', value: 'iphone' },
      { step: 'budget', value: 20000 },
      { step: 'holdingYears', value: 3 },
      { step: 'buyTiming', value: 'used' },
      { step: 'performanceFloor', value: 0.3 },
    ];
    for (let i = 0; i < selections.length; i++) {
      const s = selections[i];
      const fn = new Function(
        `const pages = getCurrentPages();
         const p = pages[pages.length - 1];
         p.onSelectOption({ currentTarget: { dataset: { step: ${JSON.stringify(s.step)}, value: ${JSON.stringify(s.value)} } } });
         return { ok: true };`,
      );
      await withTimeout(mp.evaluate(fn), 8000, `select ${s.step}`);
      await new Promise((r) => setTimeout(r, 800));
      const cur = await withTimeout(mp.evaluate(() => getCurrentPages().slice(-1)[0]?.route), 5000, 'route');
      if (cur === 'pages/result/result') break;
    }

    await waitFor(async () => {
      const r = await withTimeout(mp.evaluate(() => {
        const p = getCurrentPages().slice(-1)[0];
        return { route: p?.route, loading: p?.data?.loading };
      }), 5000, 'wait');
      return r.route === 'pages/result/result' && !r.loading;
    }, { timeout: 15000, msg: 'loading' });

    await withTimeout(mp.evaluate(() => { getCurrentPages().slice(-1)[0].onEnterEditor(); return true; }), 8000, 'enterEditor');
    await new Promise((r) => setTimeout(r, 1500));

    // === 场景 1: 取消 128G ===
    logInfo('步骤1: 取消 128G 存储筛选');
    await toggle(mp, 'storage', '128');
    let st = await readState(mp);
    logInfo(`  128G 取消后 deferred=${st.deferredModels.length} 个`);
    st.deferredModels.forEach(m => logInfo('    [deferred] ' + m));
    const expect1 = ['iPhone_16_128G_二手 × 3年', 'iPhone_16_Pro_128G_二手 × 3年'];
    expect1.forEach(m => {
      if (st.deferredModels.includes(m)) logPass(`  步骤1正确: ${m} 已移入暂不考虑`);
      else logFail(`  步骤1错误: ${m} 未移入暂不考虑`);
    });

    // === 场景 2: 取消 "16 pro" 型号 ===
    logInfo('步骤2: 取消 "16 pro" 型号筛选');
    await toggle(mp, 'chip', '16 pro');
    st = await readState(mp);
    logInfo(`  取消16pro后 deferred=${st.deferredModels.length} 个`);
    st.deferredModels.forEach(m => logInfo('    [deferred] ' + m));
    const expect2 = ['iPhone_16_Pro_128G_二手 × 3年', 'iPhone_16_Pro_256G_二手 × 3年', 'iPhone_16_Pro_512G_二手 × 3年'];
    expect2.forEach(m => {
      if (st.deferredModels.includes(m)) logPass(`  步骤2正确: ${m} 已移入暂不考虑`);
      else logFail(`  步骤2错误: ${m} 未移入暂不考虑`);
    });

    // === 场景 3: 恢复 "16 pro" (核心验证点) ===
    logInfo('步骤3: 恢复 "16 pro" 型号筛选 (核心验证)');
    await toggle(mp, 'chip', '16 pro');
    st = await readState(mp);
    logInfo(`  恢复16pro后 deferred=${st.deferredModels.length} 个`);
    st.deferredModels.forEach(m => logInfo('    [deferred] ' + m));
    logInfo(`  active=${st.activeModels.length} 个`);

    // 核心断言
    let fail = 0;
    // 16 pro 256G / 512G 应恢复 (不被128G挡住)
    if (st.activeModels.includes('iPhone_16_Pro_256G_二手 × 3年')) logPass('  ✓ 16 pro 256G 已恢复');
    else { fail++; logFail('  ✗ 16 pro 256G 未恢复'); }
    if (st.activeModels.includes('iPhone_16_Pro_512G_二手 × 3年')) logPass('  ✓ 16 pro 512G 已恢复');
    else { fail++; logFail('  ✗ 16 pro 512G 未恢复'); }
    // 16 pro 128G 应保持 deferred (因128G仍取消)
    if (st.deferredModels.includes('iPhone_16_Pro_128G_二手 × 3年')) logPass('  ✓ 16 pro 128G 保持暂不考虑(128G仍取消)');
    else { fail++; logFail('  ✗ 16 pro 128G 错误恢复(128G仍取消,应保持暂不考虑)'); }
    // 16 128G 应保持 deferred
    if (st.deferredModels.includes('iPhone_16_128G_二手 × 3年')) logPass('  ✓ 16 128G 保持暂不考虑');
    else { fail++; logFail('  ✗ 16 128G 错误恢复'); }

    // 最终 deferred 应正好是 2 个 128G
    const expectedDeferred = ['iPhone_16_128G_二手 × 3年', 'iPhone_16_Pro_128G_二手 × 3年'];
    const actualDeferred = st.deferredModels.slice().sort();
    const expSorted = expectedDeferred.slice().sort();
    if (JSON.stringify(actualDeferred) === JSON.stringify(expSorted)) {
      logPass('  ✓ 最终暂不考虑集合正确 (恰为2个128G方案)');
    } else {
      fail++;
      logFail('  ✗ 最终暂不考虑集合错误: ' + JSON.stringify(actualDeferred));
    }

    logInfo(fail === 0 ? '✓✓ 多维度交叉修复验证通过' : `✗✗ ${fail} 处断言失败`);

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
