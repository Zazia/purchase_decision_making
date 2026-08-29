/**
 * helper.js — miniprogram-automator 连接与公共断言工具
 *
 * 依据 AUTOTEST-GUIDE.md 的踩坑记录:
 *  1. 用 wsEndpoint 而非 port 参数连接
 *  2. monkey-patch Launcher.connect 跳过版本检查 (automator 落后于开发者工具时会报错)
 *  3. 连接前自动确认端口 9420 已就绪, 未就绪则调用 cli.bat auto 启动
 */
const automator = require('miniprogram-automator');
const net = require('net');
const { execFileSync } = require('child_process');

// 绕过版本检查: 直接走 connectTool, 不调用 checkVersion
const Launcher = require('miniprogram-automator/out/Launcher').default;
Launcher.prototype.connect = async function (opts) {
  return await this.connectTool(opts);
};

// 端口可用环境变量 AUTOTEST_PORT 覆盖 (默认 9420), 如: AUTOTEST_PORT=25040 node xxx.js
const PORT = Number(process.env.AUTOTEST_PORT) || 9420;
const WS_ENDPOINT = `ws://127.0.0.1:${PORT}`;
const CLI_BAT = 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat';
const PROJECT_PATH = 'd:\\_Projects\\1-small-tools\\purchase_decision_making\\miniapp\\wx';

/** 检查端口是否 LISTENING */
function checkPort(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port }, () => { sock.end(); resolve(true); });
    sock.on('error', () => resolve(false));
  });
}

/** 启动开发者工具自动化模式 (同步阻塞直到 cli.bat 返回) */
function launchDevtools() {
  try {
    execFileSync('cmd.exe', ['/c', CLI_BAT, 'auto', '--project', PROJECT_PATH, '--auto-port', String(PORT)], { stdio: 'ignore', timeout: 60000 });
  } catch {
    // cli.bat 返回非 0 也可能只是 "已启动" 的提示, 不阻塞
  }
}

/** 轮询等待端口就绪 */
async function waitForPort(maxWaitMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkPort('127.0.0.1', PORT)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** 连接到已开启自动化的小程序 (端口未就绪时自动启动) */
async function connect() {
  if (!(await checkPort('127.0.0.1', PORT))) {
    console.log(`[helper] 端口 ${PORT} 未就绪, 启动开发者工具自动化...`);
    launchDevtools();
    if (!(await waitForPort(30000))) {
      throw new Error(`开发者工具自动化端口 ${PORT} 启动失败`);
    }
    // 端口就绪后再等 2s 让 ws 服务完全 ready
    await new Promise((r) => setTimeout(r, 2000));
  }
  return await automator.connect({ wsEndpoint: WS_ENDPOINT });
}

/** 轮询等待条件成立, 超时抛错 */
async function waitFor(fn, { timeout = 10000, interval = 300, msg = 'waitFor timeout' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await fn()) return;
    } catch {
      // 忽略中间错误, 继续轮询
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(msg);
}

/** 简易断言 */
function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`断言失败: ${msg} (期望=${expected}, 实际=${actual})`);
  }
}

/** 打印分隔线 */
function section(name) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${name}`);
  console.log('='.repeat(60));
}

/** 汇总单条结果 */
function logPass(msg) {
  console.log(`  [PASS] ${msg}`);
}
function logInfo(msg) {
  console.log(`  [INFO] ${msg}`);
}
function logFail(msg) {
  console.log(`  [FAIL] ${msg}`);
}

module.exports = {
  connect,
  waitFor,
  assert,
  assertEqual,
  section,
  logPass,
  logInfo,
  logFail,
};
