# Agent 协作约定

> 本文件是给 AI Agent（及人类协作者）的项目级工作约定。每次开始项目任务（小程序、引擎、数据维护、视频）前，先读这里。

## 1. 小程序调试经验沉淀机制

### 目标

把"端到端调试微信小程序"过程中遇到的**每一个新卡点与解决方案**，持续沉淀到技能库，避免重复踩坑、避免经验散落在对话里丢失。

### 单一事实来源（Single Source of Truth）

| 用途 | 位置 |
|------|------|
| **技能（SOP 主体，可被 Agent 自动调用）** | `.agents/skills/wx-miniprogram-autotest/SKILL.md` |
| 基础指南（原始记录） | `miniapp/AUTOTEST-GUIDE.md` |
| 踩坑经验（原始记录） | `miniapp/AUTOTEST-LESSONS.md` |

`SKILL.md` 是 Agent 调试时的**首选参考**；两份 AUTOTEST-*.md 是原始素材。三者内容应保持一致，有冲突以 `SKILL.md` 为准并回写修正另两份。

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
3. **同步原始记录**：若经验较重要，同步更新 `miniapp/AUTOTEST-LESSONS.md`（按"现象 / 原因 / 解决"三段式记录），保持与技能一致。
4. **提交时在 commit message 说明**：如 `docs(autotest): 记录 mp.xxx 超时绕过方案`。

### 记录格式约定

每条新经验至少包含三要素（参考 AUTOTEST-LESSONS.md 既有风格）：

- **现象**：报什么错 / 卡在哪 / 表现是什么
- **原因**：为什么会这样（版本、协议、沙箱、数据不一致…）
- **解决**：可直接复制的代码 / 命令 / 配置，附简短说明

能跑通的代码片段优先于文字描述。

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
- 历史参考克隆（如曾经的 `engine_ref/`，本仓库旧 commit 的本地副本）在内容合并进主目录后即删除，不留本地副本。
- TRAE 的 `.uploads/`、`.playwright-browsers/`、`.trae-html-share-packages/` 为临时缓存，可随时清空。
- 提交前 pre-commit 钩子（`core.hooksPath=scripts/hooks`）会在 `constants.json` 变更时自动同步小程序快照，勿用 `--no-verify` 跳过。
