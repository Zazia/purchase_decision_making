/**
 * diagnose.js — 诊断连接与 reLaunch 卡顿问题
 *
 * 步骤:
 *  1. 连接自动化端口
 *  2. 获取系统信息 (不依赖页面)
 *  3. 获取当前页面 (不 reLaunch)
 *  4. 带超时地 reLaunch, 捕获是否卡住
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
  console.log('--- 步骤 1: 连接 ---');
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  console.log('[OK] 已连接');

  try {
    console.log('\n--- 步骤 2: 系统信息 ---');
    const info = await withTimeout(mp.systemInfo(), 5000, 'systemInfo');
    console.log('[OK] systemInfo:', JSON.stringify({ brand: info.brand, model: info.model, pixelRatio: info.pixelRatio, screenWidth: info.screenWidth, screenHeight: info.screenHeight }));

    console.log('\n--- 步骤 3: 当前页面 (不 reLaunch) ---');
    try {
      const page = await withTimeout(mp.currentPage(), 5000, 'currentPage');
      console.log('[OK] 当前页面 path=', page?.path);
    } catch (e) {
      console.log('[WARN] currentPage:', e.message);
    }

    console.log('\n--- 步骤 4: 带超时 reLaunch (30s) ---');
    try {
      const page = await withTimeout(mp.reLaunch('/pages/decision-tree/decision-tree'), 30000, 'reLaunch');
      console.log('[OK] reLaunch 成功, path=', page?.path);
      await page.waitFor(800);
      console.log('[OK] 页面 data keys:', Object.keys(page.data || {}).join(', '));
      console.log('[OK] currentStep=', page.data?.currentStep, 'progress=', page.data?.progress);
    } catch (e) {
      console.log('[FAIL] reLaunch:', e.message);
      console.log('  → 可能原因: 项目存在编译错误, 请在开发者工具中查看控制台');
    }
  } finally {
    await mp.close();
    console.log('\n[OK] 已关闭连接');
  }
}

run().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
