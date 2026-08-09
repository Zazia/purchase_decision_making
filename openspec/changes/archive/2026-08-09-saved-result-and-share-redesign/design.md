# 保存结果与分享卡小程序码 — 设计文档

> Change: `saved-result-and-share-redesign`
> 范围: `miniapp/wx/`（主小程序）+ `cloudfunctions/share-result/`（云函数）；`engine_ref/` 为参考副本，不在本次改动范围
> 状态: 设计中（v3，按用户反馈改为云端 ID 模式）

## 1. 背景与目标

### 1.1 用户诉求

1. **「保存结果」名副其实**：当前只生成一张图片。用户希望保存完整结果到本机，下次打开小程序可回看。
2. **HTML 导出删掉**：不保留 HTML 文件导出/转发功能，让用户多打开小程序。
3. **交互基本不变**：保留现有 `result → share-card` 流程；点击「生成分享卡」后提示「转发分享卡即可保存」；下方保留「保存图片到本地」。
4. **分享卡加小程序码**：图片上加小程序码，文字「扫码查看我的方案」，扫码也能直接进入对应结果页（与分享卡转发等价）。
5. **统一分享入口**：一个分享卡，发给谁都能看——不分「给自己」和「给朋友」两个按钮。
6. **「展示我的方案」可选**：用户可不展示个人方案，此时图片只显示小程序名称文字，不绘制小程序码。
7. **UI 不大改**：通过分享卡进入或有缓存的用户，UI 基本不变；只在 `decision-tree` 第一页（品类选择）加一个「查看已保存的结果」选项。

### 1.2 目标

- 「保存结果」= 生成分享卡 + 本地缓存完整结果快照。
- 分享卡统一带决策参数，任何人点开都用参数重算进入 `result` 页。
- 分享卡图片加小程序码（云端 ID 模式）：扫码 scene = 云端 `_id`，落地 `result` 页，云函数拉 params 重算。
- 「展示我的方案」复选框：勾选绘制小程序码，不勾选只显示小程序名称文字。
- 新增「查看已保存的结果」入口（`decision-tree` 第一页），点开看本地缓存列表。
- 删除 HTML 导出，`report` 页末尾改为「保存结果」按钮。

## 2. 现状分析

### 2.1 现有流程

```
decision-tree → result → (保存结果) → share-card(生成图片/保存相册/转发朋友)
                          ↘ (查看完整报告) → report(导出HTML/转发文件)
```

- `result` 页 `onGenerateShareCard` 把 `topPlan + frontier` 存入 `app.globalData.shareCardData`，跳转 `share-card` 页。见 [result.ts#L298](file:///d:/_Projects/1-small-tools/purchase_decision_making/miniapp/wx/pages/result/result.ts)。
- `share-card` 页 `onGenerate` 调用 `share-card-canvas` 组件导出图片。见 [share-card.ts#onGenerate](file:///d:/_Projects/1-small-tools/purchase_decision_making/miniapp/wx/pages/share-card/share-card.ts)。
- `share-card-canvas` 组件在 canvas 上绘制标题/推荐方案/帕累托缩略图/小程序码占位/底部声明。小程序码目前是占位框（无边框圆角白底 + "小程序码"文字），不是真实码。见 [share-card-canvas.ts#L211-L229](file:///d:/_Projects/1-small-tools/purchase_decision_making/miniapp/wx/components/share-card-canvas/share-card-canvas.ts)。
- `report` 页 `onExportHtml` / `onShareFile` 用 `wx.getFileSystemManager().writeFile` 生成单文件 HTML。见 [report.ts#L598-L650](file:///d:/_Projects/1-small-tools/purchase_decision_making/miniapp/wx/pages/report/report.ts)。
- `share-card.onShareAppMessage` 的 path 只带 `category + budget`，朋友打开无法重生成完整分析。见 [share-card.ts#L152](file:///d:/_Projects/1-small-tools/purchase_decision_making/miniapp/wx/pages/share-card/share-card.ts)。

### 2.2 关键问题

1. **「保存结果」名不副实**：只生成图片，无完整结果留存。
2. **分享卡不带完整参数**：朋友打开无法重算。
3. **无本地缓存**：用户回看只能重走决策树。
4. **HTML 导出多余**：微信内无法原生打开 HTML，且与「让用户多打开小程序」目标矛盾。
5. **小程序码是占位**：未渲染真实码，扫码入口缺失。

### 2.3 技术约束

- 微信本地存储 `wx.setStorageSync` 单 key 上限 1MB，总上限 10MB。单条结果快照预估 < 50KB。
- 微信小程序码通过 `cloud.openapi.wxacode.getUnlimited` 接口生成（云函数调用），**不受个人主体限制**，scene 参数最大 32 字符，落地页必须是已发布的小程序页面。
- `onShareAppMessage` 的 path 可携带 query 参数，`result` 页 `parseQuery` 已支持解析 `category/budget/buyTiming/performanceFloor/holdingYears`。见 [result.ts#parseQuery](file:///d:/_Projects/1-small-tools/purchase_decision_making/miniapp/wx/pages/result/result.ts)。
- 云函数以小程序身份调用云数据库，写入 `shared_results` 集合不需要用户登录授权。
- 云开发环境需在小程序后台开通，`app.ts` 中 `wx.cloud.init({ env })` 初始化。

## 3. 设计原则

1. **统一分享**：一个分享卡、一个分享按钮，path 统一带完整决策参数。不分「给自己」「给朋友」。
2. **缓存仅用于回看**：本地缓存不参与分享 path；分享走 params 重算，缓存仅服务于「查看已保存的结果」。
3. **云函数代写免登录**：云端存储仅用于扫码分享，云函数以小程序身份代写，用户无需登录授权。
4. **扫码与转发等价**：扫码 scene = 云端 `_id`，落地 result 页拉 params 重算，行为与分享卡转发一致。
5. **「展示我的方案」中性可选**：复选框默认勾选绘制小程序码；不勾选只显示小程序名称文字，不调云函数。
6. **最小侵入**：保留现有 `share-card` 交互结构，只加缓存 + 小程序码 + 复选框 + 提示文案。`report` 页删除 HTML 导出、末尾改保存结果入口。UI 不大改。
7. **删除 HTML**：移除 `report` 页 HTML 导出/转发功能及相关代码。

## 4. 总体方案与交互流程

### 4.1 新流程

```
decision-tree(第一页加"查看已保存的结果")
    ↓
result ──(保存结果)──► share-card
    │                       ├─(展示我的方案 ✓) → 生成图片 + 本地缓存 + 云函数存 params 换 _id + 生成小程序码 → 提示"转发即可保存"
    │                       ├─(展示我的方案 ✗) → 生成图片(只显小程序名文字) + 本地缓存 → 提示"转发即可保存"
    │                       ├─(保存图片到本地) → 保存到相册
    │                       └─(转发分享卡) → path 带完整 params, 任何人点开进 result 重算
    │
    └─(查看完整报告)──► report(末尾: 保存结果) → share-card
```

### 4.2 分享卡统一路径（转发场景）

```
分享卡 path = /pages/result/result?category=mac-mini&budget=5000&buyTiming=both&performanceFloor=0.4&holdingYears=2,3,4
```

任何人点开都进 `result` 页，用 params 重新计算。`result.parseQuery` 已支持解析这些参数。

### 4.3 扫码场景（云端 ID 模式）

```
扫小程序码 → 微信解析 scene=<_id> + page=pages/result/result
         → result 页 onLoad({ scene: _id })
         → wx.cloud.callFunction({ name: 'share-result', data: { action: 'get', id: _id } })
         → 云函数读 shared_results 集合 → 返回 params
         → result 页用 params 重算 → 渲染
```

scene = 云端 `_id`（24 字符 hex 字符串，< 32 字符限制）。落地页 `pages/result/result` 必须已发布。

### 4.4 查看已保存的结果

```
decision-tree 第一页 → "查看已保存的结果" → saved-list → 点开某项 → report(回看, 从本地缓存读)
```

- `saved-list` 页读本地索引，展示已保存结果列表。
- 点击某项 → `report?savedId=${id}`，`report` 页从缓存读 `reportData`，跳过重新计算。

## 5. 详细设计

### 5.1 数据模型与本地缓存

#### 5.1.1 结果快照结构

```ts
// miniapp/wx/services/saved-results.ts
interface DecisionParams {
  category: string;
  budget: number;
  buyTiming: 'new' | 'used' | 'both';
  performanceFloor: number;
  holdingYears: number[];
}

interface PlanPoint { /* 与 result.ts PlanPoint 对齐 */ }

interface SavedResult {
  /** 唯一ID = 保存时间戳 (Date.now()) */
  id: string;
  /** 保存时间 (ms) */
  createdAt: number;
  /** 决策参数 (列表展示 + 分享 path 生成) */
  params: DecisionParams;
  /** report 页渲染所需完整数据 (回看时直接用, 不重算) */
  reportData: {
    params: DecisionParams;
    frontier: PlanPoint[];
    dominated: PlanPoint[];
    recommendationRange: { lowerCost: number; upperCost: number; plans: PlanPoint[] } | null;
    performanceFloor: number;
    budget: number;
  };
  /** 报告标题 (列表展示 + 回看标题) */
  headerTitle: string;
  /** 保存时所用的数据快照日期 */
  lastUpdated: string;
  /** 云端记录 _id (展示我的方案勾选时才有; 不勾选为 null) */
  cloudId?: string | null;
}
```

#### 5.1.2 存储策略

- 单条快照存 `wx.setStorageSync('saved_result_${id}', savedResult)`。预估 < 50KB。
- 索引存 `wx.setStorageSync('saved_result_index', SavedResultIndexItem[])`：
  ```ts
  interface SavedResultIndexItem {
    id: string;
    createdAt: number;
    category: string;
    budget: number;
    headerTitle: string;
    topPlanLabel: string; // 如 "M2 16G 256G · 二手 · 3年"
  }
  ```
- **容量管理**：保留最近 20 条；超出时删除最旧条目的快照 key。

### 5.2 缓存服务模块

新建 `miniapp/wx/services/saved-results.ts`：

```ts
// 核心接口
export function saveResult(snapshot: Omit<SavedResult, 'id' | 'createdAt'>): string;
// 生成 id=Date.now(), 写快照 + 更新索引 + 容量清理, 返回 id

export function getSavedResult(id: string): SavedResult | null;

export function listSavedResults(): SavedResultIndexItem[];
// 按 createdAt 降序

export function deleteSavedResult(id: string): void;

export function buildSharePath(params: DecisionParams): string;
// 生成 /pages/result/result?category=...&budget=...&buyTiming=...&performanceFloor=...&holdingYears=2,3,4

export function getSavedCount(): number;
// 读索引长度, 供 decision-tree 显示数量

export function updateCloudId(id: string, cloudId: string): void;
// 云函数写入成功后回填本地快照的 cloudId (供后续刷新小程序码用)
```

> 注：原 `buildQrUrl` 函数删除（云端 ID 模式不再用中转页 URL）。

### 5.3 云函数 share-result

新建 `cloudfunctions/share-result/`（index.js + package.json + config.json）。

#### 5.3.1 三个 action

```js
// cloudfunctions/share-result/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action } = event;
  if (action === 'save')   return await saveRecord(event.params);
  if (action === 'get')    return await getRecord(event.id);
  if (action === 'qrcode') return await getQrcode(event.id);
  return { ok: false, error: 'unknown action' };
};

// 写入 params, 返回 _id (免登录, 云函数以小程序身份代写)
async function saveRecord(params) {
  const now = Date.now();
  const expireAt = now + 30 * 24 * 60 * 60 * 1000; // 30 天
  const res = await db.collection('shared_results').add({
    data: { params, createdAt: now, expireAt }
  });
  return { ok: true, id: res._id };
}

// 读 params (扫码进 result 时调用)
async function getRecord(id) {
  const res = await db.collection('shared_results').doc(id).get();
  return { ok: true, params: res.data.params, createdAt: res.data.createdAt };
}

// 生成小程序码, 返回 base64
async function getQrcode(id) {
  const res = await cloud.openapi.wxacode.getUnlimited({
    scene: id,                          // 24 字符 hex < 32 限制
    page: 'pages/result/result',        // 落地页
    checkPath: false,                   // 开发期跳过已发布校验
    width: 280,
    autoColor: false,
    lineColor: { r: 0, g: 0, b: 0 },
  });
  return { ok: true, contentType: res.contentType, buffer: res.buffer.toString('base64') };
}
```

#### 5.3.2 云数据库结构

集合 `shared_results`（云函数代写，权限规则设为「仅创建者可读写」由云函数绕过）：

```js
{
  _id: "<24 hex>",          // 自动生成, 用作 scene
  params: {                  // DecisionParams
    category: "mac-mini",
    budget: 5000,
    buyTiming: "both",
    performanceFloor: 0.4,
    holdingYears: [2, 3, 4]
  },
  createdAt: 1690000000000,
  expireAt: 1692592000000    // 30 天后
}
```

#### 5.3.3 过期清理

读取时懒清理：`getRecord` 时若 `expireAt < now`，删除该记录并返回 `{ ok: false, error: 'expired' }`。可选：定期云函数扫描删除（属 M2，本次不做）。

#### 5.3.4 部署与权限

- `project.config.json` 加 `cloudfunctionRoot: "cloudfunctions/"`。
- 云函数目录 `cloudfunctions/share-result/` 上传部署。
- 云数据库 `shared_results` 集合手动创建，权限规则设为「仅创建者可读写」（云函数用管理端身份绕过）。
- `app.ts` 加 `wx.cloud.init({ env: '<云环境ID>' })`。

### 5.4 share-card 页改造

#### 5.4.1 交互保留 + 新增缓存 + 云函数调用

- **「生成分享卡」按钮**（保留现有 `onGenerate`）：生成图片后，调用 `saveResult(...)` 缓存完整结果；若「展示我的方案」勾选，调云函数 `share-result` 的 `save` + `qrcode` 拿到 `cloudId` + 小程序码 base64，回填 `cloudId` 到本地快照，把小程序码 base64 传给 canvas 绘制。提示「转发分享卡即可保存」。
- **「展示我的方案」复选框**（新增）：默认勾选。不勾选时不调云函数，canvas 只绘制小程序名称文字。
- **「保存图片到本地」按钮**（保留现有 `onSaveToAlbum`）。
- **分享 path 补全参数**：`onShareAppMessage` 的 path 由 `buildSharePath(params)` 生成，携带完整决策参数。

#### 5.4.2 生成后提示

```ts
async onGenerate() {
  // 1. 本地缓存 (无论勾选与否)
  const localId = saveResult({ params, reportData, headerTitle, lastUpdated, cloudId: null });
  this.setData({ savedId: localId });

  // 2. 展示我的方案勾选 → 调云函数
  let qrcodeBase64: string | null = null;
  let cloudId: string | null = null;
  if (this.data.showMyPlan) {
    try {
      const saveRes = await wx.cloud.callFunction({
        name: 'share-result',
        data: { action: 'save', params }
      });
      cloudId = saveRes.result.id;
      updateCloudId(localId, cloudId);

      const qrRes = await wx.cloud.callFunction({
        name: 'share-result',
        data: { action: 'qrcode', id: cloudId }
      });
      qrcodeBase64 = qrRes.result.buffer;
    } catch (e) {
      // 云端失败不阻断, 降级为文字模式
      qrcodeBase64 = null;
      wx.showToast({ title: '小程序码生成失败, 仅显示小程序名', icon: 'none' });
    }
  }

  // 3. canvas 绘制 (组件根据 qrcodeBase64 是否为 null 切换底部布局)
  // ... 现有生成图片逻辑, 传入 qrcodeBase64 ...

  // 4. 提示
  wx.showModal({
    title: '分享卡已生成',
    content: '转发分享卡即可保存结果，对方也能用同样的参数查看方案。',
    showCancel: false,
    confirmText: '好的',
  });
}
```

#### 5.4.3 分享 path

```ts
onShareAppMessage() {
  return {
    title: '苹果购买决策分析 — 用数据帮你选',
    path: buildSharePath(this.data.params),
    imageUrl: this.data.tempFilePath || undefined,
  };
}
```

#### 5.4.4 数据来源

- `share-card` 页需要 `params`（完整决策参数）来生成分享 path + 缓存 + 云函数入参。
- `share-card` 页需要 `reportData`（frontier/dominated/recommendationRange/performanceFloor/budget）来缓存完整结果。
- 当前 `result.onGenerateShareCard` 只存了 `topPlan + frontier` 到 `globalData.shareCardData`。需补充 `dominated + recommendationRange + performanceFloor + budget + params`。

### 5.5 share-card-canvas 组件改造（加小程序码）

#### 5.5.1 现状

底部区域（y=1150 起）：小程序码占位框（180×180，x=60）+ 右侧引导文字"扫码进入小程序"。

#### 5.5.2 改造

底部区域单码布局：

```
       [小程序码 200×200]
       扫码查看我的方案
```

- **小程序码**：云函数返回的 base64 → `wx.base64ToArrayBuffer` → 写临时文件 → `drawImage` 绘制到 canvas 指定位置。无需内联 QR 算法。
- **不勾选「展示我的方案」**：不绘制小程序码，只绘制居中文字「帕累托买苹果」（小程序名称）。
- **文字**：小程序码下方"扫码查看我的方案"；文字模式下只显示小程序名。
- 删除原 `utils/qrcode.ts` 内联 QR 算法（不再使用）。

#### 5.5.3 属性扩展

`share-card-canvas` 组件新增 property：

```ts
properties: {
  // ... 现有 ...
  /** 小程序码 base64 (展示我的方案勾选且云函数成功时传入; null 则只显示小程序名文字) */
  qrcodeBase64: { type: String, value: '' },
  /** 小程序名称 (文字模式显示) */
  appName: { type: String, value: '帕累托买苹果' },
}
```

`share-card` 页根据 `showMyPlan` + 云函数结果传入 `qrcodeBase64`，组件据此切换底部布局。

### 5.6 report 页改造

#### 5.6.1 删除 HTML 导出

- 移除 `onExportHtml` / `onShareFile` / `buildExportHtml` 方法。
- 移除 `exportedFilePath` / `hasExportedFile` data。
- 移除 wxml 中 `export-wrap` 区块。

#### 5.6.2 末尾改为「保存结果」

- wxml 末尾 `export-wrap` 替换为「保存结果」按钮。
- `onSaveResult()`：组装快照（reportData + headerTitle + lastUpdated）→ `saveResult` → `wx.navigateTo` 到 `share-card` 页（带 `savedId` 或通过 globalData 传递数据）。
  - 实现选择：直接 `saveResult` 后跳 `share-card`，通过 `globalData.shareCardData` 传数据（与 result 页一致），让 share-card 页正常生成。

#### 5.6.3 支持回看模式

```ts
onLoad(query) {
  if (query.savedId) {
    this.enterReplayMode(query.savedId);
    return;
  }
  this.loadReport();
}

enterReplayMode(id: string) {
  const saved = getSavedResult(id);
  if (!saved) {
    wx.showModal({ title: '结果已不在本机', content: '该保存结果可能已被清理', showCancel: false });
    wx.navigateBack();
    return;
  }
  // 用 saved.reportData 渲染, 跳过重新计算
  this.setData({ ...从 saved.reportData 组装, loading: false });
}
```

- 回看模式下 UI 不变，数据来源从缓存读取。
- 标题可加"已保存"标注（可选，最小化改动则不加）。

### 5.7 result 页改造（支持扫码 scene）

#### 5.7.1 支持 scene 参数

```ts
onLoad(query) {
  // 扫码场景: query.scene 是云端 _id (URL encoded)
  if (query.scene) {
    const cloudId = decodeURIComponent(query.scene);
    this.loadFromCloud(cloudId);
    return;
  }
  // 转发场景: query 直接带 params
  this.loadFromParams(query);
}

async loadFromCloud(cloudId: string) {
  this.setData({ loading: true, loadingHint: '正在加载方案...' });
  try {
    const res = await wx.cloud.callFunction({
      name: 'share-result',
      data: { action: 'get', id: cloudId }
    });
    if (!res.result.ok) {
      // 过期或不存在
      wx.showModal({ title: '方案已过期', content: '该分享已超过 30 天, 无法查看', showCancel: false });
      wx.navigateBack();
      return;
    }
    const params = res.result.params;
    this.loadFromParams(params);  // 复用现有 parseQuery 之后的重算流程
  } catch (e) {
    wx.showModal({ title: '加载失败', content: '请检查网络后重试', showCancel: false });
    wx.navigateBack();
  }
}

loadFromParams(queryOrParams) {
  // 现有 parseQuery + compute 流程
}
```

#### 5.7.2 onGenerateShareCard 补全数据

```ts
onGenerateShareCard() {
  // ... 现有 ...
  app.globalData.shareCardData = {
    params,                          // 新增
    topPlan: topPlan.raw,
    frontier: this.data.frontier,
    dominated: this.data.dominated,  // 新增
    recommendationRange: this.data.recommendationRange, // 新增
    performanceFloor: params.performanceFloor,          // 新增
    budget: params.budget,           // 新增
  };
}
```

### 5.8 decision-tree 第一页加「查看已保存的结果」

#### 5.8.1 选项位置

在品类选择步骤（第一步）的选项列表末尾，或进度条下方，加一个「查看已保存的结果」入口。

- 选项形式：与品类选项一致的卡片样式，但用次级视觉（虚线边框/灰色）区分。
- 显示已保存数量（如"查看已保存的结果 (3)"），无保存时灰显或隐藏。

#### 5.8.2 实现

```ts
// decision-tree.ts onLoad
const count = getSavedCount();
this.setData({ savedCount: count });

onViewSavedResults() {
  wx.navigateTo({ url: '/pages/saved-list/saved-list' });
}
```

```html
<!-- decision-tree.wxml, 第一步品类选择下方 -->
<view class="saved-entry {{savedCount > 0 ? '' : 'disabled'}}" bindtap="onViewSavedResults">
  查看已保存的结果 {{savedCount > 0 ? '(' + savedCount + ')' : ''}}
</view>
```

- 仅在第一步（`currentStep === 0`）显示。

### 5.9 新增 saved-list 页（我的结果）

- 路径 `pages/saved-list/saved-list`，注册到 `app.json`。
- `onLoad` 调 `listSavedResults()`，渲染列表。
- 每项：标题、保存时间、品类/预算、首选方案摘要。
- 点击 → `wx.navigateTo('/pages/report/report?savedId=${id}')` 回看。
- 长按删除（`deleteSavedResult` + 重新渲染）。
- 空态：提示「暂无保存结果，去生成一份吧」。

### 5.10 app.ts 云开发初始化

```ts
// app.ts
App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: '<云环境ID>',  // 从 project.config.json 或环境变量读
        traceUser: true,
      });
    }
  },
  globalData: { /* 现有 */ },
});
```

## 6. 边界与降级

### 6.1 缓存失败

- `saveResult` 写 storage 失败（超容）：先清理最旧条目重试一次；仍失败 → toast「保存失败，请清理微信存储后重试」。不影响分享卡生成。

### 6.2 云函数失败

- 云函数 `save` 失败：不阻断分享卡生成，降级为文字模式（canvas 只显示小程序名称文字），toast 提示。
- 云函数 `qrcode` 失败：同上降级。
- 云函数 `get`（扫码读取）失败：modal 提示 + 返回上一页。
- 云开发未开通 / 环境未配置：云函数调用必然失败，自动降级为文字模式。

### 6.3 分享卡跨设备

- 朋友端无本地缓存，走 `result` 页 params 重算（转发场景）或云函数拉 params 重算（扫码场景），结果可能因 constants 版本更新略有差异（正常展示当前数据日期即可）。

### 6.4 扫码场景

- 微信扫一扫识别小程序码 → 直接打开小程序 result 页（scene 解析）。
- 过期记录（> 30 天）：modal 提示 + 返回。
- 落地页 `pages/result/result` 必须已发布，开发期用 `checkPath: false` 跳过校验。

### 6.5 「展示我的方案」不勾选

- 不调云函数，仅本地缓存。
- canvas 底部只显示小程序名称文字，不绘制小程序码。
- 分享卡转发 path 仍带完整 params（转发场景不受影响，只是图片上没有码）。

## 7. 不在本次范围

- 云端结果列表 / 跨设备结果同步（属 M2，需用户登录）。
- 云端记录定期清理定时任务（本次用读取时懒清理）。
- HTML 文件导出/转发（删除）。
- `engine_ref/` 副本同步。

## 8. 影响清单

### 新增
- `miniapp/wx/services/saved-results.ts` — 缓存服务（已有，补 `updateCloudId`）
- `miniapp/wx/pages/saved-list/` — 我的结果列表页（wxml/wxss/ts/json）
- `cloudfunctions/share-result/` — 云函数（index.js + package.json + config.json）
- 云数据库 `shared_results` 集合（手动创建）

### 修改
- `miniapp/wx/components/share-card-canvas/share-card-canvas.ts` — 删内联 QR 算法，改 `drawImage` 绘制小程序码 + 文字模式降级 + 新增 qrcodeBase64/appName property
- `miniapp/wx/components/share-card-canvas/share-card-canvas.wxml` — canvas 尺寸不变（如有）
- `miniapp/wx/pages/share-card/share-card.ts` — 生成后缓存 + 云函数调用 + 「展示我的方案」复选框 + 提示 + 分享 path 带完整参数 + 传 qrcodeBase64 给组件
- `miniapp/wx/pages/share-card/share-card.wxml` — 加复选框 + 提示文案（保留上轮分享呼吁）
- `miniapp/wx/pages/report/report.ts` — 删 HTML 导出 + 末尾改保存结果 + 支持 savedId 回看
- `miniapp/wx/pages/report/report.wxml` — 末尾按钮替换
- `miniapp/wx/pages/result/result.ts` — onGenerateShareCard 补全 globalData + onLoad 支持 scene → 云函数拉 params 重算
- `miniapp/wx/pages/decision-tree/decision-tree.ts` — 加 savedCount + onViewSavedResults
- `miniapp/wx/pages/decision-tree/decision-tree.wxml` — 第一步加「查看已保存的结果」入口
- `miniapp/wx/pages/decision-tree/decision-tree.wxss` — 入口样式
- `miniapp/wx/app.ts` — 加 `wx.cloud.init`
- `miniapp/wx/app.json` — 注册 saved-list 页
- `miniapp/wx/project.config.json` — 加 `cloudfunctionRoot`

### 删除
- `report.ts` 中 `onExportHtml` / `onShareFile` / `buildExportHtml` / `exportedFilePath` / `hasExportedFile`
- `report.wxml` 中 `export-wrap` 区块
- `miniapp/wx/utils/qrcode.ts` — 内联 QR 算法（不再使用）
- `docs/r.html` 中转页依赖（不再需要）

### 复用
- `share-card-canvas` 组件、`repo-footer` 组件、引擎 `compute`、`result.parseQuery`、`report` 页样式。
