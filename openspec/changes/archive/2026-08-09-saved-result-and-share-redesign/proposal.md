# 保存结果与分享卡小程序码

## Why

当前「保存结果」按钮只生成一张图片，名不副实；分享卡不带完整参数，朋友打开无法重算；用户回看结果只能重走决策树；HTML 导出在微信内无法原生打开，且与「让用户多打开小程序」目标矛盾。用户希望「保存结果」真正保存完整可回看的结果到本机，分享卡统一带参数让任何人都能打开，图片上加小程序码让扫码也能直进对应结果，并删除 HTML 导出。

## What Changes

### 保存结果 = 生成分享卡 + 本地缓存

- 新建缓存服务 `services/saved-results.ts`：用时间戳生成唯一 ID，把决策参数 + 引擎产出（frontier/dominated/recommendationRange）存入 `wx.setStorageSync`，保留最近 20 条。
- `share-card` 页「生成分享卡」后调 `saveResult` 缓存完整结果，提示「转发分享卡即可保存」。

### 统一分享入口

- 一个分享卡、一个分享按钮，`onShareAppMessage` 的 path 统一带完整决策参数（category/budget/buyTiming/performanceFloor/holdingYears）。
- 任何人点开都进 `result` 页用参数重算，不分「给自己」「给朋友」。

### 分享卡图片加小程序码（云端 ID 模式）

- 用户在 share-card 页生成分享卡时，调云函数 `share-result` 把决策参数写入云数据库 `shared_results` 集合，换取云端记录 `_id`。
- 云函数 `share-result` 另提供 `qrcode` action，调用 `cloud.openapi.wxacode.getUnlimited` 生成小程序码，scene = 云端 `_id`，落地页 = `pages/result/result`。
- `share-card-canvas` 组件底部绘制该小程序码图片，文字「扫码查看我的方案」。扫码行为与分享卡转发完全等价：扫哪个码进哪一次结果。
- 单纯进入小程序的小程序码占位删掉。

### 「展示我的方案」复选框

- share-card 页加复选框「展示我的方案」（默认勾选）。
- 勾选：图片底部绘制小程序码，扫码可进对应结果。
- 不勾选：图片底部不绘制小程序码，只显示小程序名称文字（如「帕累托买苹果」）。不勾选时不调用云函数，仅本地缓存。

### 云函数代写免登录

- 云函数以小程序身份调用云数据库，**不需要用户登录授权**。用户点「生成分享卡」即可触发云函数写入 + 生成小程序码。
- 云端记录字段：`_id`、`params`、`createdAt`、`expireAt`（保留 30 天，云函数定期清理或读取时懒清理）。

### 删除 HTML 导出

- `report` 页移除 `onExportHtml` / `onShareFile` / `buildExportHtml` 及相关 data/wxml。
- `report` 页末尾「导出HTML / 转发文件」替换为「保存结果」按钮，跳转 `share-card` 页。

### 查看已保存的结果

- `decision-tree` 第一页（品类选择）加「查看已保存的结果 (N)」入口。
- 新增 `pages/saved-list` 列表页，点击某项跳 `report?savedId=${id}` 从本地缓存回看（UI 不变，数据来源从缓存读）。

## Capabilities

### Modified Capabilities

- `wx-miniapp-mvp`: 保存结果由「生成图片」升级为「完整快照 + 本地回看」；分享卡统一带参数；图片加小程序码（云端 ID 模式，扫码直进 result）；新增「展示我的方案」复选框；删除 HTML 导出；新增 saved-list 页与回看入口；新增云函数 `share-result` + 云数据库 `shared_results`。

## Impact

- 新增: `services/saved-results.ts`、`pages/saved-list/`、`cloudfunctions/share-result/`（云函数）、云数据库 `shared_results` 集合
- 修改: `share-card-canvas.ts`、`share-card.{ts,wxml}`、`report.{ts,wxml,wxss}`、`result.ts`、`decision-tree.{ts,wxml,wxss}`、`app.ts`（`wx.cloud.init`）、`app.json`、`project.config.json`（`cloudfunctionRoot`）
- 删除: `report` 页 HTML 导出相关代码、原 `utils/qrcode.ts` 内联 QR 算法、`docs/r.html` 中转页依赖
- 不改引擎、不改 skill 路径、不改 `engine_ref/`、不引新 npm 依赖
