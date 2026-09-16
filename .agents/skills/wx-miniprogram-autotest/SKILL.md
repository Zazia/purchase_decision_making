---
name: wx-miniprogram-autotest
description: 微信小程序端到端自动化调试 SOP（基于 miniprogram-automator）。当需要对微信小程序做自动化测试、UI/数据/交互调试、引擎集成验证、定位 automator 兼容卡点，或在小程序里跑 smoke/集成测试时调用。
---

# 微信小程序端到端自动化调试 SOP

> 本技能沉淀了在 `miniprogram-automator@0.12.1` + 新版微信开发者工具（Stable v2.01）下，端到端调试小程序的实战经验。源文档：`miniapp/AUTOTEST-GUIDE.md`（基础指南）、`miniapp/AUTOTEST-LESSONS.md`（踩坑经验）。
> **持续更新约定**：后续调试中遇到新的卡点与解决方案，按 `agent.md`（项目根目录）的约定回填到本技能对应章节。

## 何时调用本技能 (When to Invoke)

**出现以下任一情况时调用：**

- 需要对本项目小程序（`miniapp/wx`）做端到端自动化测试 / smoke 测试 / 引擎集成测试
- 需要在小程序运行时内读取 page data、调用页面方法、查询元素，但 `page.data()` / `page.$()` / `mp.callMethod()` 报错或超时
- 需要启动 / 排查 miniprogram-automator 与开发者工具的连接（端口、版本、沙箱）
- 改动引擎源码后需要验证小程序内集成是否生效
- 需要设计小程序测试断言（帕累托前沿 / 推荐区间 / 浮点容差等）
- 任何涉及"automator 报错、超时、连不上、找不到元素"的排查

### 不应调用的情况

- 仅做纯引擎单测（不依赖开发者工具）→ 直接 `node test/engine-integration.test.js`
- 仅查快照数据键名 → 直接 `node -e "..."` 读 `wx/snapshot/constants.json`

---

## 一、环境与前置条件

| 项目 | 值 |
|------|-----|
| 开发者工具 CLI | `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat` |
| 自动化端口 | 9420 |
| Node.js | v24+ |
| 测试库 | `miniprogram-automator@0.12.1`（**勿升级**，新版协议不兼容见 §三） |
| 测试目录 | `miniapp/test/`（`helper.js` 已封装连接与断言） |

**前置条件：**
1. 开发者工具已安装并登录
2. 设置 → 安全设置 → **服务端口** 已开启
3. 目标小程序项目已通过开发者工具**导入并打开**

### ⚠️ TRAE 沙箱限制

`cli.bat` 需要写入 `C:\Users\<user>\AppData\Local\微信开发者工具\...\Default\.cli` 标记文件，TRAE 沙箱默认禁止该目录，会报：

```
EPERM: operation not permitted, open '...Default\.cli'
TRAE Sandbox Error: hit restricted
```

**解决**：由用户在沙箱外手动放行该目录（或直接在原生 PowerShell 运行 `cli.bat`）。

### ⚠️ PATH 缺 System32 / node 导致 chcp 报错

TRAE 终端 `$env:PATH` 缺 `C:\Windows\System32` 和 `C:\Program Files\nodejs`，`cli.bat` / `wechatide.cmd` 会报 `'chcp' is not recognized` 或 `'node' is not recognized`。跑任何开发者工具命令前先补 PATH：

```powershell
$env:PATH = "C:\Windows\System32;C:\Windows;C:\Program Files\nodejs;" + $env:PATH
```

### ⚠️ 服务端口未开启：直接跑 cli.bat 看错误，别扫端口

`wechatide auth` 报 `CONNECT_ERROR` 超时、automator 连不上、`.ide` 里写的端口不监听，根因几乎都是**服务端口未开启**（`localstorage_*.json` 里 `enableServicePort:true` 只是残留值，不代表真的监听）。最快诊断：直接跑 `cli.bat auto`，它会给出明确中文提示「工具的服务端口已关闭，请手动打开工具 → 设置 → 安全设置，将服务端口开启」。让用户手动开启后立即生效，无需重启。**不要逆向源码、扫端口、查配置文件绕远路。**

---

## 二、启动自动化模式

```powershell
$cli = "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
& $cli auto --project "D:\_Projects\1-small-tools\purchase_decision_making\miniapp\wx" --auto-port 9420
```

### 端口就绪必须轮询，不要固定 sleep

`cli.bat auto` 返回成功 ≠ 端口已 LISTENING。立即连接会 `Failed connecting`。

```powershell
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 1000
    if (netstat -ano | Select-String ":9420" | Where-Object { $_ -match "LISTENING" }) {
        Write-Host "Port ready after $i seconds"
        break
    }
}
```

Node 侧预检（推荐放进 helper）：

```javascript
const net = require('net');
async function checkPort(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port }, () => { sock.end(); resolve(true); });
    sock.on('error', () => resolve(false));
  });
}
```

### 端口会在测试结束后释放

`mp.close()` 后 9420 有时被开发者工具释放。**每次跑测试前都重新确认端口就绪**，未就绪则重跑 `cli.bat auto`。

---

## 三、连接：两个必做的兼容处理

automator 0.12.1（2022 年发布）与新版开发者工具协议不匹配，**连接前必须做两件事**：

1. **用 `wsEndpoint` 而非 `port`**：`port` 参数会报端口被占用。
2. **monkey-patch 跳过版本检查**：`checkVersion()` 会误判不兼容并中断流程。

`miniapp/test/helper.js` 已封装好可直接用：

```javascript
const automator = require('miniprogram-automator');
const Launcher = require('miniprogram-automator/out/Launcher').default;
Launcher.prototype.connect = async function (opts) {
  return await this.connectTool(opts);  // 跳过 checkVersion
};
const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
```

---

## 四、核心教训：page 实例方法全部超时，只用 `mp.evaluate()`

> 这是最重要的一条。automator 0.12.1 + 新版开发者工具下，`page.data()`、`page.$()`、`page.$$()`、`page.path`、`mp.screenshot()` **全部卡 8 秒后超时**。但 `mp.reLaunch()`、`mp.currentPage()`、`mp.systemInfo()`、`mp.evaluate()`、`mp.pageStack()`、`mp.close()` 正常。

**结论：`mp.evaluate()` 是唯一可靠的交互通道。** 所有数据读取、方法调用、元素查询都通过它在小程序运行时内完成。

```javascript
// ❌ 旧写法：会超时
const page = await mp.reLaunch('/pages/xxx/xxx');
const data = await page.data();        // 超时
const el = await page.$('.title');     // 超时
const text = await el.text();          // 超时

// ✅ 新写法：用 evaluate 绕过
await mp.reLaunch('/pages/xxx/xxx');
await new Promise(r => setTimeout(r, 1500));   // 等渲染完成
const data = await mp.evaluate(() => {
  const pages = getCurrentPages();
  const p = pages[pages.length - 1];
  return {
    route: p?.route,
    currentStep: p?.data?.currentStep,
    steps: p?.data?.steps?.length,
  };
});
```

### evaluate 的三条铁律

1. **不能闭包外部变量**：传入的函数会被序列化后在运行时执行，只能用小程序运行时全局（`getCurrentPages`、`wx`、`App`、`Page`）。
2. **调用页面方法模拟 wxml 事件**：构造 `currentTarget.dataset` 结构即可。
3. **等 setData/setTimeout 生效**：调用方法后 `await new Promise(r => setTimeout(r, 800))` 再读结果。

```javascript
// 调用页面方法
await mp.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  p.onSelectOption({ currentTarget: { dataset: { step: 'category', value: 'iphone' } } });
  return true;
});
await new Promise(r => setTimeout(r, 800));
const after = await mp.evaluate(() => {
  const p = getCurrentPages().slice(-1)[0];
  return { currentStep: p.data.currentStep };
});
```

### page.path 偶发为空

改用 `mp.currentPage()` 取路径：

```javascript
await mp.reLaunch('/pages/xxx/xxx');
const cur = await mp.currentPage();
console.log(cur.path);  // 'pages/xxx/xxx'
```

### screenshot 超时

无绕过方案。UI 视觉验证改为：人工查看开发者工具窗口，或用 data 结构完整性间接证明渲染正确。

---

## 五、元素选择器策略

- **不要依赖 class 选择器**：class 在 wxml 结构变化或样式调整后失效，automator 对 class 匹配也不稳定。
- **给关键元素加 `data-testid`**：`<view data-testid="option-{{opt.value}}" bindtap="onSelectOption">`
- 但 `page.$()` 会超时（§四），实际用 `evaluate` + `wx.createSelectorQuery()`：

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

### 用 data 结构间接验证渲染（更可靠）

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

data 完整 + 方法已注册 → wxml 渲染基本可信赖（除非 wxml 有语法错误，开发者工具会报编译错误）。

---

## 六、引擎与小程序集成同步

### 改了源码必须 build + sync

小程序运行时加载的是 `miniapp/wx/vendor/apple-value-engine/*.js`（从 `packages/apple-value-engine/dist/` 拷贝）。**源码改了不重新构建，vendor 还是旧的，测试会报旧错误。**

```bash
# 1. 构建引擎
npm run build --workspace apple-value-engine
# 2. 同步到小程序 vendor 目录
node scripts/sync-engine.mjs
# 3. 跑测试验证
node test/engine-integration.test.js
```

### 数据快照键名大小写不一致

- 实时市场价快照用 `iPhone_proMax`（小写 m）
- 保值率曲线用 `iPhone_ProMax`（大写 P 和 M）

直接 `curves[category]` 查不到。**解决**：在 `retention.ts` 加大小写兜底：

```typescript
let curve = curves[category];
if (!curve) {
  const lower = category.toLowerCase();
  for (const [k, v] of Object.entries(curves)) {
    if (k.toLowerCase() === lower) { curve = v; break; }
  }
}
```

### 父品类聚合查询

用户传 `iphone`，但快照里只有 `iPhone_Pro`、`iPhone_proMax`、`iPhone_标准`。**解决**：在 `pareto.ts` 的 `extractCandidates` 中，当父品类键不存在时，搜索所有以 `category_` 开头的子品类。

---

## 七、测试断言设计经验

### 7.1 前沿不过滤、推荐区间过滤

- **前沿** = 所有候选方案的非劣解，**不受** 性能地板 / 预算过滤
- **推荐区间** = 在前沿上按 `buyPrice ≤ budget && avgPerformance ≥ performanceFloor` 截取

```javascript
// 前沿只验证非空和字段完整性
assert(result.frontier.length > 0, '前沿非空');
// 推荐区间才验证性能地板
const plans = result.recommendationRange.plans;
if (plans.length > 0) {
  assert(plans.every(p => p.avgPerformance >= floor - 0.001), '推荐区间满足性能地板');
}
```

### 7.2 推荐区间为空是合法状态

macbook-pro / imac 旧机型 avgPerformance≈0.18，低于测试性能地板 0.4 时过滤后为空。"推荐区间非空"降级为 INFO，不作为硬断言：

```javascript
if (result.recommendationRange) {
  const rr = result.recommendationRange;
  assert(rr.lowerCost <= rr.upperCost, '推荐区间 lower<=upper');
  console.log(`  [INFO] 推荐区间方案数=${rr.plans.length} (可能因性能地板过滤为0)`);
}
```

### 7.3 浮点比较留容差

```javascript
assert(p.avgPerformance >= 0.8 - 0.001, '...');
```

---

## 八、调试方法论：分层隔离

### 8.1 wechatide 0.3.10 / Windows 参数与只读验收（2026-09-14）

- `wechatide.cmd` 经 PowerShell 传递 `--fn-source` 时，JavaScript 双引号可能被外层移除，出现 `ReferenceError: shared_results is not defined`。这是参数传递错误，不是数据库权限拒绝。简单表达式可在 PowerShell 单引号内使用 JavaScript 模板字符串；复杂参数优先用工具支持的 `--args-file`。含 `&` 的导航 URL 也可能被 cmd 拆为命令，应在运行时构造 URL 再导航。
- 代码热重载可能把模拟器重置到初始页；每次调用页面方法前核对 route 和方法存在性，不沿用热重载前的页面假设。
- `cloud_db_read_struct --action describeCollection` 仅返回索引/集合结构，不能据此认定安全规则已设置。客户端集合读取返回空数组也不能证明禁止直读，可能只是身份过滤后的空集，须另查权限规则或已知记录访问结果。
- 分享页失败恢复测试可临时替换 `wx.cloud.callFunction` 为本地失败桩，核验确认次数、保存次数和本地图片；必须在 finally 恢复。该测试不能代替真实云端写入验收。2700→2500 重算后再编辑2300但不重算，保存提交价仍应为2500、原始对照2700。
- 新版 `simulator_screenshot` 已可截图（指定 scripts/debug/ 内绝对路径），可用于分享卡视觉核验；旧 automator 的 mp.screenshot 超时限制仍存在。


测试失败时按以下顺序定位（从快到慢、从纯 Node 到依赖工具）：

1. **引擎层**：`node test/engine-integration.test.js` — 不依赖开发者工具，纯 Node
2. **数据层**：`node -e "console.log(Object.keys(require('./wx/snapshot/constants.json')['保值率曲线']))"` — 快速查键名
3. **同步层**：对比 `packages/.../dist/retention.js` 与 `miniapp/wx/vendor/.../retention.js` 是否一致
4. **UI 层**：`node test/smoke.js` — 依赖开发者工具自动化

### 用 diagnose 脚本定位 automator 兼容边界

逐个 API 加 `withTimeout` 测试，快速找出哪些方法能用、哪些超时：

```javascript
async function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`[TIMEOUT] ${label}`)), ms)),
  ]);
}
await withTimeout(mp.systemInfo(), 5000, 'systemInfo');    // ✅
await withTimeout(mp.currentPage(), 8000, 'currentPage'); // ✅
await withTimeout(mp.evaluate(() => 1), 8000, 'evaluate'); // ✅
await withTimeout(page.data(), 8000, 'page.data()');        // ❌ 超时
```

参考实现：`miniapp/test/diagnose.js` / `diagnose2.js` / `diagnose3.js`。

---

### 原生确认弹窗不能仅以mock验收（2026-09-14）

2026-09-15产品决定更新：本项目分享上传前二次确认已按用户要求移除，数据使用由协议与开关说明告知。当前验收应验证开启加生成直接上传、关闭零上传；以下按钮限制是历史问题与通用API经验，不能据此重新添加确认流程。

wx.showModal 的 confirmText/cancelText 最多4个字符。「仅本地保存」5字会直接返回 showModal:fail cancelText length should not larger than 4 Chinese characters。此前mock直接返回confirm导致遗漏，且页面总catch误报“渲染失败”，实际上未上传。改用“本地保存”，按prepare/consent/render区分反馈；回归mock也必须校验参数长度，真实验收必须展示原生弹窗并人工确认。生成前等待setData回调，再等待组件二维码加载Promise；不能用export返回成功代替检查图片实际含二维码。首次无授权状态、取消、失败、已有授权重试分别记录，不能借用mock留下的授权状态证明首次确认成功。

### 云函数平台信封与严格白名单（2026-09-14）

真实 wx.cloud.callFunction 会附带平台 userInfo 和 tcbContext（后者由线上 invalidFields 诊断确认），纯本地 mock 若只传业务 DTO 会漏掉这一差异，导致本地校验通过、云端 invalid_payload。云函数入口先剥离 userInfo/tcbContext，再校验业务字段；身份仍只读 getWXContext().OPENID，绝不把整个 event 落库。回归必须模拟附加 userInfo/tcbContext，并验证伪造值不影响身份/幂等键且不会被持久化。

## 九、automator 0.12.1 可用 API 清单

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

---

## 十、标准运行流程（速查）

```powershell
# 0. 确认开发者工具已导入并打开 miniapp/wx 项目，服务端口已开启

# 1. 启动自动化（沙箱放行后；或在原生 PowerShell 跑）
$cli = "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
& $cli auto --project "D:\_Projects\1-small-tools\purchase_decision_making\miniapp\wx" --auto-port 9420

# 2. 轮询端口就绪（见 §二）

# 3. 改了引擎源码则先 build + sync
npm run build --workspace apple-value-engine
node scripts/sync-engine.mjs

# 4. 跑测试
cd miniapp
node test/engine-integration.test.js   # 引擎层（纯 Node）
node test/smoke.js                       # UI 层（依赖工具）
```


### 分享落地必须核验快照而非仅生成图片（2026-09-16）

云写成功、图片有码并不证明分享正确。若get只返params、接收页重算，会丢用户修改价。必须分别以scene和shareId进入，核对保存价格、月成本、推荐列表及修改标记，断言compute未调用；转发链接也须保留同一云ID。公开快照双层白名单保留展示字段，排除身份及原始分析对照。新增修改保存必须显式isUserModified，避免仅凭标题判断。旧纯参数链接没有ID，不能猜测关联历史记录。
