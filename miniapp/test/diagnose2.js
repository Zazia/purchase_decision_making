/**
 * diagnose2.js — 诊断 page.$() 挂起问题
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
  console.log('--- 连接 ---');
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  console.log('[OK] 已连接');

  try {
    console.log('\n--- reLaunch ---');
    const page = await withTimeout(mp.reLaunch('/pages/decision-tree/decision-tree'), 20000, 'reLaunch');
    console.log('[OK] reLaunch, path=', page.path);
    await page.waitFor(1500);

    console.log('\n--- 测试 page.data() (异步) ---');
    try {
      const data = await withTimeout(page.data(), 8000, 'page.data()');
      console.log('[OK] data keys:', Object.keys(data || {}).join(', '));
      console.log('  currentStep=', data?.currentStep, 'progress=', data?.progress, 'steps.len=', data?.steps?.length);
    } catch (e) {
      console.log('[FAIL] page.data():', e.message);
    }

    console.log('\n--- 测试 page.$(".container") ---');
    try {
      const el = await withTimeout(page.$('.container'), 8000, 'page.$(.container)');
      console.log('[OK] .container found:', !!el, el?.tagName);
    } catch (e) {
      console.log('[FAIL] page.$(.container):', e.message);
    }

    console.log('\n--- 测试 page.$(".progress-text") ---');
    try {
      const el = await withTimeout(page.$('.progress-text'), 8000, 'page.$(.progress-text)');
      console.log('[OK] .progress-text found:', !!el, el?.tagName);
      if (el) {
        const t = await withTimeout(el.text(), 5000, 'el.text()');
        console.log('  text=', JSON.stringify(t));
      }
    } catch (e) {
      console.log('[FAIL] page.$(.progress-text):', e.message);
    }

    console.log('\n--- 测试 page.$$(".option-card") ---');
    try {
      const els = await withTimeout(page.$$('.option-card'), 8000, 'page.$$(.option-card)');
      console.log('[OK] .option-card count=', els?.length);
    } catch (e) {
      console.log('[FAIL] page.$$(.option-card):', e.message);
    }

    console.log('\n--- 测试 page.wxml() ---');
    try {
      // 尝试通过 evaluate 获取页面数据
      const html = await withTimeout(page.evaluate(() => {
        return { path: getCurrentPages().length, keys: Object.keys(getCurrentPages()[0]?.data || {}) };
      }), 8000, 'evaluate');
      console.log('[OK] evaluate:', JSON.stringify(html));
    } catch (e) {
      console.log('[FAIL] evaluate:', e.message);
    }
  } finally {
    await mp.close();
    console.log('\n[OK] 已关闭');
  }
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
