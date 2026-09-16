## Why

分享二维码及卡片只恢复参数后重算，丢失分享者修改后的价格和结果。必须展示保存时快照。

## What Changes

- v2公开get返回白名单结果快照，不返回私有分析数据。
- 二维码scene与分享链接shareId统一加载快照，禁止重算替换。
- 保存修改版标记，兼容旧v2从价格子集识别修改版；旧参数记录保持重算。

## Capabilities

### Modified Capabilities

- `crowdsourced-price-intake`: 分享读取返回公开结果快照，跨入口保持修改版一致。

## Impact

share-result云函数、结果页、分享页、保存标记、测试与维护说明。需部署云函数及后续发布客户端。
