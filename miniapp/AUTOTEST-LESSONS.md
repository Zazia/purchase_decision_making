# 微信小程序自动化测试经验文档

> 本文档记录在接入 `miniprogram-automator` 自动化测试过程中遇到的实际卡点与解决方案，作为后续开发的经验沉淀。配套基础指南见 [AUTOTEST-GUIDE.md](./AUTOTEST-GUIDE.md)。

## 一、环境启动卡点

### 1.1 TRAE 沙箱限制 cli.bat 写入

**现象**：在 TRAE 环境中执行 `cli.bat auto` 启动自动化模式时，报错：

```
✖ #initialize-error: Error: EPERM: operation not permitted, open
  'C:\Users\Administrator\AppData\Local\微信开发者工具\User Data\...\Default\.cli'
TRAE Sandbox Error: hit restricted
```

**原因**：TRAE 沙箱默认禁止访问 `AppData\Local\微信开发者工具\` 目录，而 cli.bat 需要写入 `.cli` 标记文件。

**解决**：目前已由用户手动修改设置，允许在沙箱外运行。

### 1.2 端口 9420 就绪检测必须轮询

**现象**：`cli.bat auto` 命令返回成功后，端口 9420 可能还没真正 LISTENING，立即连接会失败。

**解决**：用轮询而非固定 sleep：

```powershell
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 1000
    if (netstat -ano | Select-String ":9420" | Where-Object { $_ -match "LISTENING" }) {
        Write-Host "Port ready after $i seconds"
        break
    }
}
```

### 1.3 端口会在测试结束后释放

**现象**：调用 `mp.close()` 关闭连接后，9420 端口有时会被开发者工具释放，下一次测试再连会报 `Failed connecting to ws://127.0.0.1:9420`。

**解决**：每次跑测试前先确认端口就绪，未就绪则重新执行 `cli.bat auto`。可在 helper.js 中加端口预检：

```javascript
const net = require('net');
async function checkPort(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port }, () => { sock.end(); resolve(true); });
    sock.on('error', () => resolve(false));
  });
}
```

### 1.4 PATH 缺 System32 导致 cli.bat / wechatide 报 chcp 错误

**现象**：在 TRAE 的 PowerShell 终端里执行 `cli.bat` 或 `wechatide.cmd`，报：
```
wechatide.cmd : 'chcp' is not recognized as an internal or external command
node : The term 'node' is not recognized
```

**原因**：TRAE 终端的 `$env:PATH` 只含少数目录（如 agent 的 bin），缺少 `C:\Windows\System32` 和 `C:\Program Files\nodejs`。batch 脚本里的 `chcp`、`node` 都找不到。

**解决**：跑任何微信开发者工具相关命令前，先补齐 PATH：

```powershell
$env:PATH = "C:\Windows\System32;C:\Windows;C:\Program Files\nodejs;" + $env:PATH
```

（Node.js 实际路径用 `Get-ChildItem 'C:\Program Files\nodejs' -Filter 'node.exe'` 确认）

### 1.5 服务端口未开启的最快诊断方法

**现象**：`wechatide auth` 一直报 `CONNECT_ERROR / wait WechatIDE authorization timeout`，automator 连接失败，`netstat` 看不到 IDE 服务端口（`.ide` 文件里写的端口不监听）。

**原因**：微信开发者工具的「服务端口」未开启。注意：`AppData\Local\...\WeappLocalData\localstorage_*.json` 里的 `security.enableServicePort: true` 只是残留配置，不代表端口真的在监听。

**解决（最快）**：不要逆向源码、不要扫端口、不要查配置文件。直接跑：

```powershell
$cli = "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
& $cli auto --project "D:\...\miniapp\wx" --auto-port 9420
```

它会直接给出明确中文提示：
```
[error] 工具的服务端口已关闭。要使用命令行调用工具，请手动打开工具 -> 设置 -> 安全设置，将服务端口开启。
```

然后让用户在开发者工具里手动开启：**设置 → 安全设置 → 服务端口（Service Port）**。开启后服务端口立即监听，无需重启。

## 二、连接与版本兼容

### 2.1 必须用 wsEndpoint 而非 port

**现象**：用 `automator.connect({ port: 9420 })` 会报端口被占用或连接失败。

**解决**：

```javascript
const mp = await automator.connect({
  wsEndpoint: 'ws://127.0.0.1:9420'
});
```

### 2.2 automator 版本落后于开发者工具

**现象**：连接后调用 `checkVersion()` 抛错，导致整个连接流程中断。

**原因**：`miniprogram-automator@0.12.1` 是 2022 年发布，新版开发者工具（Stable v2.01）的协议版本号更高，automator 误判为不兼容。

**解决**：monkey-patch `Launcher.connect`，跳过 `checkVersion` 直接走 `connectTool`：

```javascript
const automator = require('miniprogram-automator');
const Launcher = require('miniprogram-automator/out/Launcher').default;
Launcher.prototype.connect = async function (opts) {
  return await this.connectTool(opts);  // 跳过 checkVersion
};
```

## 三、页面级 API 兼容性（最严重的卡点）

### 3.1 page.data() / page.$() 全部超时

**现象**：通过 `mp.reLaunch()` 返回的 page 对象，调用 `page.data()`、`page.$('.xxx')`、`page.$$('.xxx')` 全部卡住 8 秒后超时，但 `mp.currentPage()`、`mp.evaluate()`、`mp.systemInfo()` 正常工作。

**原因**：automator 0.12.1 的页面实例方法依赖旧版 wx 协议消息，新版开发者工具的 webview 桥接协议变了，这些方法收不到响应。

**解决**：**完全放弃 page 实例方法**，全部改用 `mp.evaluate()` 在小程序运行时内直接执行：

```javascript
// ❌ 旧写法：会超时
const page = await mp.reLaunch('/pages/xxx/xxx');
const data = await page.data();                    // 超时
const el = await page.$('.title');                 // 超时
const text = await el.text();                      // 超时

// ✅ 新写法：用 evaluate 绕过
await mp.reLaunch('/pages/xxx/xxx');
await new Promise(r => setTimeout(r, 1500));       // 等渲染完成
const data = await mp.evaluate(() => {
  const pages = getCurrentPages();
  const p = pages[pages.length - 1];
  return {
    route: p?.route,
    currentStep: p?.data?.currentStep,
    steps: p?.data?.steps?.length,
    // 直接读 data 字段
  };
});
```

### 3.2 mp.callMethod 不存在

**现象**：想触发页面的 `onSelectOption` 方法测试交互，但 `mp.callMethod is not a function`。

**原因**：automator 0.12.1 的 `MiniProgram` 实例**没有** `callMethod` API（这是更高版本才加的）。

**解决**：在 `evaluate` 内直接调用页面方法：

```javascript
await mp.evaluate(() => {
  const pages = getCurrentPages();
  const p = pages[pages.length - 1];
  // 模拟 wxml 事件的 dataset 结构
  p.onSelectOption({
    currentTarget: { dataset: { step: 'category', value: 'iphone' } }
  });
  return true;
});

// 等待 setData + setTimeout 生效
await new Promise(r => setTimeout(r, 800));

// 再用 evaluate 读取结果验证
const after = await mp.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  return { currentStep: p.data.currentStep };
});
```

### 3.3 page.path 偶发为空

**现象**：`mp.reLaunch()` 返回的 page 对象，`.path` 偶发为 undefined。

**解决**：改用 `mp.currentPage()` 获取路径：

```javascript
await mp.reLaunch('/pages/xxx/xxx');
const cur = await mp.currentPage();
console.log(cur.path);  // 'pages/xxx/xxx'
```

### 3.4 screenshot 也超时

**现象**：`mp.screenshot()` 在新版开发者工具下同样卡住超时。

**解决**：暂无绕过方案，需要更高版本的 automator。UI 视觉验证改为人工查看开发者工具窗口，或验证 data 结构间接证明渲染正确。

## 四、元素选择器策略

### 4.1 不要依赖 class 选择器

**现象**：用 `.option-card` 这类 class 选择器，在 wxml 结构变化或样式调整后会失效，且 automator 对 class 匹配不稳定。

**解决**：给关键元素加 `data-testid` 属性：

```xml
<view class="option-card" data-testid="option-{{opt.value}}" bindtap="onSelectOption">
```

测试中用 `[data-testid="option-iphone"]` 定位。但注意 §3.1 已说明 `page.$()` 会超时，所以实际只能用 `evaluate` 配合 `wx.createSelectorQuery()` 查询：

```javascript
const result = await mp.evaluate(() => {
  return new Promise((resolve) => {
    wx.createSelectorQuery()
      .selectAll('[data-testid^="option-"]')
      .boundingClientRect((rects) => {
        resolve({ count: rects.length, ids: rects.map(r => r.dataset?.testid) });
      })
      .exec();
  });
});
```

### 4.2 用 data 结构间接验证渲染

由于元素查询不稳定，更可靠的做法是验证 page data 的结构完整性：

```javascript
const rendered = await mp.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  const step = p.data.steps[p.data.currentStep];
  return {
    hasStep: !!step,
    hasOptions: Array.isArray(step?.options) && step.options.length > 0,
    hasSelectHandler: typeof p.onSelectOption === 'function',
  };
});
```

如果 data 完整 + 方法已注册，wxml 渲染基本可信赖（除非 wxml 本身有语法错误，那种情况开发者工具会报编译错误）。

## 五、测试断言设计经验

### 5.1 理解"前沿不过滤、推荐区间过滤"

**踩坑**：写了 `assert(result.frontier.every(p => p.avgPerformance >= 0.8))`，结果失败。

**澄清**：在帕累托引擎设计中：
- **前沿** = 所有候选方案的非劣解，**不受** 性能地板 / 预算过滤
- **推荐区间** = 在前沿上按 `buyPrice ≤ budget && avgPerformance ≥ performanceFloor` 截取

**正确断言**：

```javascript
// 前沿只验证非空和字段完整性
assert(result.frontier.length > 0, '前沿非空');

// 推荐区间才验证性能地板
const plans = result.recommendationRange.plans;
if (plans.length > 0) {
  assert(plans.every(p => p.avgPerformance >= floor - 0.001), '推荐区间满足性能地板');
}
```

### 5.2 推荐区间可能为空是合法状态

**现象**：macbook-pro / imac 的推荐区间方案数=0，原断言 `assert(rr.plans.length > 0)` 失败。

**原因**：这两个品类的旧机型 avgPerformance≈0.18，低于测试用的性能地板 0.4，过滤后自然为空。

**解决**：把"推荐区间非空"降级为 INFO，不作为硬断言：

```javascript
if (result.recommendationRange) {
  const rr = result.recommendationRange;
  assert(rr.lowerCost <= rr.upperCost, '推荐区间 lower<=upper');
  console.log(`  [INFO] 推荐区间方案数=${rr.plans.length} (可能因性能地板过滤为0)`);
}
```

### 5.3 浮点比较要留容差

```javascript
assert(p.avgPerformance >= 0.8 - 0.001, '...');  // 留 0.001 容差
```

## 六、引擎与小程序集成同步

### 6.1 改了源码必须 build + sync

**踩坑**：在 `packages/apple-value-engine/src/retention.ts` 加了大小写兜底，但测试仍然报 `Retention curve not found for category: iPhone_proMax`。

**原因**：小程序运行时加载的是 `miniapp/wx/vendor/apple-value-engine/*.js`，这是从 `packages/apple-value-engine/dist/` 拷贝过来的产物。源码改了不重新构建，vendor 目录还是旧的。

**标准流程**：

```bash
# 1. 构建引擎
npm run build --workspace apple-value-engine

# 2. 同步到小程序 vendor 目录
node scripts/sync-engine.mjs

# 3. 跑测试验证
node test/engine-integration.test.js
```

### 6.2 数据快照的键名大小写不一致

**现象**：
- `实时市场价快照` 用 `iPhone_proMax`（小写 m）
- `保值率曲线` 用 `iPhone_ProMax`（大写 P 和 M）

直接 `curves[category]` 查不到。

**解决**：在 `retention.ts` 加大小写兜底：

```typescript
let curve = curves[category];
if (!curve) {
  const lower = category.toLowerCase();
  for (const [k, v] of Object.entries(curves)) {
    if (k.toLowerCase() === lower) { curve = v; break; }
  }
}
```

### 6.3 父品类聚合查询

**现象**：用户传 `iphone`，但快照里只有 `iPhone_Pro`、`iPhone_proMax`、`iPhone_标准`。

**解决**：在 `pareto.ts` 的 `extractCandidates` 中，当父品类键不存在时，搜索所有以 `category_` 开头的子品类。

## 七、调试方法论

### 7.1 分层隔离问题

遇到测试失败时，按以下顺序定位：

1. **引擎层**：`node test/engine-integration.test.js` — 不依赖开发者工具，纯 Node 运行
2. **数据层**：`node -e "console.log(Object.keys(require('./wx/snapshot/constants.json')['保值率曲线']))"` — 快速查键名
3. **同步层**：对比 `packages/.../dist/retention.js` 和 `miniapp/wx/vendor/.../retention.js` 是否一致
4. **UI 层**：`node test/smoke.js` — 依赖开发者工具自动化

### 7.2 用 diagnose 脚本定位 automator 兼容边界

写一个 `diagnose.js`，逐个 API 加 `withTimeout` 测试，快速找出哪些方法能用、哪些超时：

```javascript
async function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`[TIMEOUT] ${label}`)), ms)),
  ]);
}

// 逐个测试
await withTimeout(mp.systemInfo(), 5000, 'systemInfo');      // ✅
await withTimeout(mp.currentPage(), 8000, 'currentPage');    // ✅
await withTimeout(mp.evaluate(() => 1), 8000, 'evaluate');   // ✅
await withTimeout(page.data(), 8000, 'page.data()');         // ❌ 超时
await withTimeout(page.$('.x'), 8000, 'page.$()');           // ❌ 超时
```

### 7.3 evaluate 中不能直接 return 函数

`mp.evaluate(fn)` 的 `fn` 会被序列化后在小程序运行时执行，**不能闭包外部变量**，只能用小程序运行时全局（如 `getCurrentPages`、`wx`、`App`、`Page`）。

## 八、总结：automator 0.12.1 可用 API 清单

| API | 状态 | 备注 |
|-----|------|------|
| `automator.connect({ wsEndpoint })` | ✅ | 必须用 wsEndpoint |
| `mp.reLaunch(path)` | ✅ | 返回的 page 对象方法不可用 |
| `mp.currentPage()` | ✅ | 获取当前页路径 |
| `mp.systemInfo()` | ✅ | |
| `mp.evaluate(fn)` | ✅ | **核心 API**，替代所有 page 方法 |
| `mp.pageStack()` | ✅ | |
| `mp.close()` | ✅ | |
| `mp.callMethod()` | ❌ | 不存在，用 evaluate 替代 |
| `mp.screenshot()` | ❌ | 超时 |
| `page.data()` | ❌ | 超时，用 evaluate 替代 |
| `page.$()` / `page.$$()` | ❌ | 超时，用 evaluate + createSelectorQuery 替代 |
| `page.path` | ⚠️ | 偶发为空，用 currentPage 替代 |
| `element.text()` / `element.tap()` | ❌ | 依赖 page.$()，连带不可用 |

**核心结论**：automator 0.12.1 + 新版开发者工具下，**只能用 `mp.evaluate()` 作为唯一交互通道**，所有页面数据读取、方法调用、元素查询都通过它在小程序运行时内完成。
