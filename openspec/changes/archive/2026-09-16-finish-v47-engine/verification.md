# 验证记录

日期：2026-09-16

- 引擎测试：16 个测试文件、138 个用例通过。
- TypeScript：`tsc -p tsconfig.json` 通过。
- 引擎冒烟：真实 ESM import、`loadConstants`、`computeParetoFrontier` 及微计算通过。
- vendor：8 个 JavaScript 与 8 个声明文件同步完成。
- 快照：SHA-256 `ecb1e498ff18a55274dba4d1f4f1c6359e806debc10296f8ab6aa719dfd2c159`，`last_updated=2026-09-14`。
- constants lint：metadata v4.7、304408 bytes、479 个快照价格字段通过。
- 云端发布：`constants/latest` 经 `update` 成功，`publishedAt=2026-09-16T12:37:23.083Z`。
- 回读：本地与云端 version、payload 字节数、doc.hash、payload 自洽 SHA-256 全部一致。

线上数据下次会话生效。ProMax 芯片映射属于 vendor 代码，仍需随小程序客户端正式发布。
