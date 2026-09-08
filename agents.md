# Agent 协作约定

> 本文件是给 AI Agent（及人类协作者）的项目级工作约定。每次开始项目任务（小程序、引擎、数据维护、视频）前，先读这里。

## 1. 小程序调试经验沉淀机制

### 目标

把"端到端调试微信小程序"过程中遇到的**每一个新卡点与解决方案**，持续沉淀到技能库，避免重复踩坑、避免经验散落在对话里丢失。

 **技能（SOP 主体，可被 Agent 自动调用）** ： `.agents/skills/wx-miniprogram-autotest/SKILL.md` |

### 何时触发更新

调试小程序过程中，**只要解决了一个新问题**，就必须回填技能。典型触发场景：

- automator 报新错（超时 / 连接失败 / API 不存在 / 协议不兼容）
- 发现某个 API 在当前开发者工具版本下的可用性变化
- 找到某类问题的新绕过方案
- 引擎与小程序集成出现新的同步 / 数据 / 渲染问题
- 测试断言设计有新的经验（边界、容差、合法空态等）
- 调试方法论有新沉淀（新诊断脚本、新分层定位手段）

### 更新流程（强制）

1. **先修代码 / 测试**，让问题真正解决、测试通过。
2. **回填技能**：打开 `.agents/skills/wx-miniprogram-autotest/SKILL.md`，把新经验追加到对应章节：
   - 新 API 兼容情况 → §九「可用 API 清单」表格
   - 新的连接 / 启动卡点 → §一～§三
   - 新的运行时交互教训 → §四～§五
   - 新的引擎 / 数据集成问题 → §六
   - 新的断言经验 → §七
   - 新的调试方法论 → §八
   - 无法归入现有章节时，新增章节并在 §十速查流程里补充

## 2. 视觉规范

制作任何视觉产物（小程序界面、HTML 报告、Canvas 分享卡、ECharts 图表）前，先读 `design.md`——它是项目视觉规范的分层入口，按需深入 `.design_library/` 中的令牌定义与平台适配指南。

## 3. 文档驱动与 OpenSpec 变更流程

遵循「文档驱动的开发」：改代码先改文档，计划有变时同步文档。

- 功能/规格变更走 OpenSpec：先在 `openspec/changes/<change>/` 写 proposal / design / specs / tasks，实施完成后归档到 `openspec/changes/archive/YYYY-MM-DD-<change>/`，并把 delta 同步回 `openspec/specs/<capability>/spec.md` 主规格。
- `.agent/`、`.trae/` 目录由 OpenSpec CLI（opsx 技能与命令）生成，**不要手工修改**；升级走 CLI。
- apply 阶段产生的进度文件（如根目录 `apply_instructions.json`）在变更归档后**必须删除**，不留残留（2026-08-17 清理时即因此删除过一份过期残留）。

## 4. 视频工程（product-tour/）

- HyperFrames 工程，工程内细则见 `product-tour/AGENTS.md`；渲染用完整版 ffmpeg（精简版会缺滤镜报错）。
- `renders/`、`.thumbnails/`、`.hyperframes/` 为本地渲染产物，不入库（.gitignore 已覆盖）。
- 场景 HTML 引用 `assets/` 资源时，扩展名**大小写必须与 git 索引一致**：Windows 渲染无感，Linux/CI 环境大小写敏感会 404。更新截图时用 `git mv` 两步改名对齐（例：`step-08-sharecard.png → .PNG`）。

## 5. 仓库整洁与包管理约定

**包管理器分工**：

| 范围 | 工具 | 锁文件 |
|------|------|--------|
| 根 workspace（`packages/*`、`miniapp/wx`、维护脚本） | **pnpm**（`packageManager` 已声明） | `pnpm-lock.yaml` |
| `miniapp/wx`（开发者工具构建 npm） | npm（例外） | 工程内自管 |
| `miniapp/test`（automator E2E） | npm（例外） | 工程内 `package-lock.json` |

禁止在根目录执行 `npm install`（会生成并提交过期的 `package-lock.json`，2026-08-17 已清理过一次）。

**本地产物目录（gitignore 覆盖，按需本地保留，不入库）**：`node_modules/`、`test-results/`、`apple-decision-video/`（旧视频工程留底）、`scripts/debug/`（一次性调试产物）、`product-tour/{renders,.thumbnails,.hyperframes}/`。

**其他整洁规则**：

- 一次性调试脚本放 `scripts/`、运行产物放 `scripts/debug/`（产物不入库，脚本本身保留）。
- TRAE 的 `.uploads/`、`.playwright-browsers/`、`.trae-html-share-packages/` 为临时缓存，可随时清空。
- 提交前 pre-commit 钩子（`core.hooksPath=scripts/hooks`）会在 `constants.json` 变更时自动同步小程序快照，勿用 `--no-verify` 跳过。

## 6. constants 数据维护与云端发布

常量库唯一数据源：`.agents/skills/apple-value-analysis/constants.json`。数据更新后的分发有两条通道：

| 通道 | 命令 | 生效方式 |
|------|------|----------|
| 云端发布（**主通道，即时生效**） | `node scripts/publish-constants.mjs`（即 `pnpm publish:constants`） | 写入云数据库 `constants` 集合 `latest` 文档，小程序端**下次会话自动采用，免提审发版** |
| 本地快照（随版本打包） | `node scripts/sync-snapshot.mjs`（即 `pnpm sync:snapshot`，pre-commit 自动执行） | 拷贝到 `miniapp/wx/snapshot/`，随小程序提审发版，作为云端不可用时的兜底 |

**标准维护流程**：改 `constants.json`（递增 `metadata.version` 与 `last_updated`，并在 `metadata` 里追加对应版本号的「变更摘要」数组）→ 按需更新 `miniapp/wx/snapshot/macro-context.json`（`analysisMonth` 与宏观阶段）→ `node scripts/sync-snapshot.mjs` → `node scripts/publish-constants.mjs`。发布脚本支持 `--dry-run` 先校验不上传。

**注意事项**：

- 云端发布凭证：`WX_SECRET` 环境变量，或 `scripts/.wx-publish-credentials.json`（内容 `{"secret": "..."}`，已 gitignore 不入库）；appid 自动取自 `project.config.json`。
- **I: 盘为 exFAT，`pnpm run <script>` 会触发依赖状态检查（内部执行 `pnpm install`）并因符号链接不支持而失败**——直接用 `node scripts/<脚本>.mjs` 跑即可，效果等价。
- 云数据库单文档上限 512KB（脚本按 450KB 安全上限校验），当前 payload 约 275KB，若持续膨胀需考虑拆分到云存储。
- **发布后必须验证**：发布成功输出看写入路径——`via update` 为常规更新、`via set (upsert)` / `via add` 为首次创建，均为真成功。**发布后跑 `node scripts/check-cloud-constants.mjs` 复核云端文档实际内容**（version/payload/hash 与本地比对）。