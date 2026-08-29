## 1. engine-bridge 云端优先加载链

- [x] 1.1 `miniapp/wx/engine-bridge/index.ts`：重写 `getConstants()` 内部实现为四级加载链（内存 → 存储正缓存 → [无缓存] 等待云端 10s → 本地快照兜底），对外 API 签名与调用方零改动；模块级维护「当前生效 raw」，`getMacroContext()` 改从当前生效 raw 读取
- [x] 1.2 实现版本仲裁：`versionGE()` 日期可解析按日期比较否则字典序；云端/存储缓存仅当版本 ≥ 本地快照 `metadata.last_updated` 时采用；存储缓存与本地快照取高者
- [x] 1.3 实现负缓存（`{payload:null, skipUntil: now+24h}`）与后台单飞刷新（成功写存储不碰内存，失败续期负缓存）；云端数据经 `JSON.parse` + `loadConstants()` 双校验，任一失败按来源不可用降级
- [x] 1.4 `miniapp/wx/pages/result/result.wxml`：黄色时效提示文案「下次发版将刷新」→「重启小程序可刷新」

## 2. 云端发布脚本

- [x] 2.1 新增 `scripts/publish-constants.mjs`：读取源 constants.json + macro-context.json，校验 `last_updated` 非空、payload ≤ 450KB，计算 sha256；appid 取自 `miniapp/wx/project.config.json`，secret 取 `WX_SECRET` 环境变量或 `scripts/.wx-publish-credentials.json`，缺失时退出非零且不发起网络请求
- [x] 2.2 实现 stable_token 获取 + `tcb/databaseupdate`（`updated=0` 时 `databaseadd` 显式 `_id:'latest'`，撞已存在回退 update）原子写入全部字段（`_ready/version/payload/macroContext/hash/publishedAt`）；支持 `--dry-run` 与 `--env` 参数
- [x] 2.3 根 `package.json` 增加 `publish:constants` 脚本；`.gitignore` 增加 `scripts/.wx-publish-credentials.json`

## 3. 验证

- [x] 3.1 `node scripts/publish-constants.mjs --dry-run` 通过（打印版本/hash/大小摘要，退出码 0，无网络请求）
- [x] 3.2 TypeScript 检查通过（`miniapp/wx` 现有 check 流程，`wx.cloud` 相关类型防御式声明）
- [x] 3.3 逻辑级自测（Node 环境模拟）：云端失败回退本地快照、版本回退仲裁、负缓存跳过等待路径
- [ ] 3.4 微信开发者工具手动冒烟（需用户配合）：不配置云端时结果页正常计算（兜底路径）；真实执行一次发布脚本后新会话生效云端数据

## 4. 收尾

- [x] 4.1 `openspec validate cloud-constants-distribution` 通过
- [x] 4.2 归档变更到 `openspec/changes/archive/2026-08-29-cloud-constants-distribution/` 并把 delta 同步进 `openspec/specs/data-snapshot-bundling/spec.md` 与 `openspec/specs/wx-miniapp-mvp/spec.md`
- [ ] 4.3 Git 提交（含 commit message 说明数据分发方式变更）
