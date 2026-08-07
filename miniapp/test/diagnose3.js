/**
 * diagnose3.js — 深度诊断: 用 mp 级 API 绕过 page 方法超时
 */
const automator = require('miniprogram-automator');
const Launcher = require('miniprogram-automator/out/Launcher').default;
Launcher.prototype.connect = async function (opts) {
  return await this.connectTool(opts);
};

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`[TIMEOUT ${ms}ms] ${label}`)), ms)),
  ]);
}

async function run() {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  console.log('[OK] 已连接');

  try {
    console.log('\n--- mp.systemInfo() ---');
    const info = await withTimeout(mp.systemInfo(), 5000, 'systemInfo');
    console.log('[OK]', JSON.stringify({ brand: info.brand, model: info.model }));

    console.log('\n--- mp.reLaunch() ---');
    await withTimeout(mp.reLaunch('/pages/decision-tree/decision-tree'), 20000, 'reLaunch');
    console.log('[OK] reLaunch 完成');
    await new Promise((r) => setTimeout(r, 2000));

    console.log('\n--- mp.pageStack() ---');
    try {
      const stack = await withTimeout(mp.pageStack(), 8000, 'pageStack');
      console.log('[OK] pageStack 长度=', stack?.length);
      if (stack && stack.length > 0) {
        const p = stack[stack.length - 1];
        console.log('  顶部页 path=', p.path);
        console.log('\n--- 用 stack 顶部的 page 测试 .data() ---');
        try {
          const data = await withTimeout(p.data(), 8000, 'stackPage.data()');
          console.log('[OK] data keys:', Object.keys(data || {}).join(', '));
          console.log('  currentStep=', data?.currentStep, 'progress=', data?.progress);
        } catch (e) {
          console.log('[FAIL] stackPage.data():', e.message);
        }
        console.log('\n--- 用 stack 顶部的 page 测试 $(".progress-text") ---');
        try {
          const el = await withTimeout(p.$('.progress-text'), 8000, 'stackPage.$');
          console.log('[OK] .progress-text:', !!el);
          if (el) console.log('  text=', JSON.stringify(await el.text()));
        } catch (e) {
          console.log('[FAIL] stackPage.$:', e.message);
        }
      }
    } catch (e) {
      console.log('[FAIL] pageStack:', e.message);
    }

    console.log('\n--- mp.currentPage() ---');
    try {
      const cur = await withTimeout(mp.currentPage(), 8000, 'currentPage');
      console.log('[OK] currentPage path=', cur?.path);
    } catch (e) {
      console.log('[FAIL] currentPage:', e.message);
    }

    console.log('\n--- mp.evaluate() 直接读取页面数据 ---');
    try {
      const result = await withTimeout(mp.evaluate(() => {
        const pages = getCurrentPages();
        const cur = pages[pages.length - 1];
        return {
          pagesLen: pages.length,
          route: cur?.route,
          dataKeys: Object.keys(cur?.data || {}),
          currentStep: cur?.data?.currentStep,
          progress: cur?.data?.progress,
          stepsLen: cur?.data?.steps?.length,
        };
      }), 8000, 'evaluate');
      console.log('[OK] evaluate:', JSON.stringify(result, null, 2));
    } catch (e) {
      console.log('[FAIL] evaluate:', e.message);
    }

    console.log('\n--- mp.screenshot() ---');
    try {
      const shot = await withTimeout(mp.screenshot({ path: 'd:/_Projects/1-small-tools/purchase_decision_making/miniapp/test/screen.png' }), 10000, 'screenshot');
      console.log('[OK] screenshot:', shot);
    } catch (e) {
      console.log('[FAIL] screenshot:', e.message);
    }
  } finally {
    await mp.close();
    console.log('\n[OK] 已关闭');
  }
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
