## Context

`engine-bridge/index.ts` 是小程序内 constants 数据的唯一入口（`getConstants()`，对外 `Promise<Constants>`），所有页面经 `compute()`/`getKnownChips()` 等间接消费，从未直接触碰快照文件——这是 M2 升级「调用方零改动」的既有约定。`app.ts` 已初始化云开发（env `cloud1-d7gb4dzhoaca5534d`），仓库已有两个云函数但从未做过客户端直读云数据库。源 constants.json 约 269KB（275,058 字节），顶层键含 `metadata.v4.0_变更摘要` 等带点号字段，云数据库不支持作为文档字段名展开存储。

## Goals / Non-Goals

**Goals:**

- 数据修复（补机型/改价格）不再需要发版提审：改 constants.json → 跑发布脚本 → 用户下次会话生效
- 任意失败路径（离线、云端未配置、数据损坏、云端版本回退）都回落到本地打包快照，小程序功能不中断
- 会话内数据版本固定，避免「结果页用 v1、编辑器用 v2」的会话内不一致

**Non-Goals:**

- 不做灰度/多版本分流（始终单一 `latest` 文档）
- 不迁移到云存储文件分发（当前 payload 远低于文档上限，不需要）
- 不改引擎 `apple-value-engine`（仍 `loadConstants` 注入）
- 不做云端数据的后台推送通知

## Decisions

### D1: 云数据库单文档 + payload 存 JSON 字符串（而非展开为文档字段）

- **理由**：①顶层键含 `v4.0_变更摘要` 等带点字段，MongoDB 系数据库禁止字段名含 `.`，展开存储直接报错；②单字段原子替换 = 客户端永远读到完整旧版或完整新版，无撕裂；③269KB < 512KB 文档上限，余量充足。
- **替代方案**：展开为文档字段（被点号字段否决）；云存储文件 + 数据库指针（多一次下载且需处理 COS 上传签名流程，复杂度不值）。

### D2: 发布走微信 HTTP API（stable_token + `tcb/databaseupdate`），不做云函数、不用腾讯云 CAM 密钥

- **理由**：维护者一定持有小程序 AppSecret（公众平台后台可查），无需开通腾讯云 CAM；HTTP API 以管理端身份写库，集合可锁成「所有用户可读、仅管理端可写」；stable_token 不作废其他 token，与云函数内置凭证互不干扰。
- **写入策略**：先 `databaseupdate`（响应 `updated=0` 视为文档不存在）→ `databaseadd`（显式 `_id: "latest"`，撞已存在错误则回退 update）。单次请求携带全部字段（payload+version+hash+`_ready:true`），原子生效。
- **替代方案**：新增 `constants-admin` 云函数本地调 `invokecloudfunction`（多一个部署件，发布仍需同一套 token 机制，无收益）；`@cloudbase/node-sdk` + CAM 密钥（要求维护者开通腾讯云访问密钥，门槛更高）。

### D3: 四级加载链 + 负缓存

```
内存缓存(会话固定) → 存储正缓存(立即采用+后台刷新) → [无缓存] 等待云端(10s 超时) → 本地打包快照
```

- **负缓存**：首次云端失败后写 `{payload: null, skipUntil: now+24h}`，未过期期间冷启动直接本地快照 + 后台刷新，避免弱网用户每次冷启动干等 10 秒超时。
- **后台刷新**：单飞（每会话最多一次），成功写正缓存（只写存储不碰内存），失败续期负缓存。
- **版本仲裁**：`version`（=`metadata.last_updated`，YYYY-MM-DD）可解析为日期则按日期比较，否则字典序比较；云端 ≥ 本地才采用，防止「发版带了新数据、云端未同步」时数据回退。存储缓存与本地快照之间同样取高者。
- **会话一致性**：内存缓存一旦确立，本会话不因后台刷新改变；新数据下次会话生效。
- **替代方案**：无存储缓存（离线用户每次冷启动都等超时）；每次 get 都拉云端（延迟与流量不可接受）。

### D4: 校验复用 `loadConstants()`，云端数据注入 MACRO_CONTEXT 的方式与本地快照对齐

云端 `payload` 解析后若 `macroContext` 字段非空则挂到 `raw.MACRO_CONTEXT`，与 `sync-snapshot.mjs` 生成的 constants.js 包装同构，`getMacroContext()` 改读「当前生效 raw」而非模块顶层 `snapshotRaw`。校验失败（JSON 解析异常/`loadConstants` 抛错）按该来源不可用处理，静默降级。

### D5: 时效提示文案微调

黄色提示「下次发版将刷新」→「重启小程序可刷新」，与新数据分发方式一致（spec 同步修改两个能力的 Requirement）。

## Risks / Trade-offs

- [云数据库单文档 512KB 上限] → 发布脚本硬性校验 payload ≤ 450KB，超限退出非零并提示拆分（当前 269KB，增速每年数十 KB，可长期使用）；真超限时迁移到「云存储文件 + 数据库版本指针」方案
- [api.weixin.qq.com POST 体积上限未明确文档化] → 280KB 量级低于常见网关 1MB 限制；发布脚本对网络错误有明确报错，失败可整体重跑（更新是幂等的单文档替换）
- [客户端直读集合要求「所有用户可读」] → 数据本为公开数据，无敏感信息；写权限仍仅管理端；README/design 记录一次性控制台配置步骤
- [AppSecret 本地明文] → 仅存环境变量或 gitignore 文件（`scripts/.wx-publish-credentials.json`），`.gitignore` 显式覆盖；泄露影响面为可重置的云数据写入
- [云端被误更新为坏数据] → `_ready` 标记 + 客户端 `loadConstants` 校验双重兜底，坏数据自动回退本地快照；发布脚本 dry-run 供发布前自查
- [首次启动弱网等待] → 10s 超时上限 + 失败后负缓存，仅首次承担；有正缓存后冷启动零等待

## Migration Plan

1. **一次性运维**（手动，控制台）：云开发数据库创建集合 `constants`，权限设「所有用户可读，仅管理端可写」（自定义安全规则 `{"read": true, "write": false}` 等价）。
2. **凭证配置**（手动，本地）：设 `WX_SECRET` 环境变量或创建 `scripts/.wx-publish-credentials.json`（`{"secret": "..."}`，已 gitignore）。
3. **首发数据**：`node scripts/publish-constants.mjs`（先 `--dry-run` 自查）。
4. **回滚策略**：无需代码回滚——云端异常时客户端自动回退本地快照；要主动「撤回」云端数据，重跑脚本发布旧版 constants.json 即可。
