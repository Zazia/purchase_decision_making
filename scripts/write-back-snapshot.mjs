#!/usr/bin/env node
/**
 * write-back-snapshot.mjs — 将闲鱼采集结果回写到 constants.json
 *
 * 读取 scripts/xianyu-prices.json,在对应品类下添加新机型条目,
 * 更新 snapshot_date,写回 .agents/skills/apple-value-analysis/constants.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CONSTANTS_PATH = '.agents/skills/apple-value-analysis/constants.json';
const PRICES_PATH = 'scripts/xianyu-prices.json';

// 残值分母参考(当前同品类新品价)
const RESIDUE_BASE = {
  Mac_mini: { price: 5999, desc: 'Mac mini M4官方价5999元' },
  MacBook_Air: { price: 9999, desc: 'MacBook Air M5 13寸16G+512G官方价9999元' },
};

async function main() {
  console.log('=== 回写闲鱼采集结果到 constants.json ===\n');

  const constants = JSON.parse(readFileSync(CONSTANTS_PATH, 'utf-8'));
  const prices = JSON.parse(readFileSync(PRICES_PATH, 'utf-8'));
  const snapshot = constants['实时市场价快照'];

  let added = 0;
  let skipped = 0;

  for (const item of prices) {
    const { model, category, xianyu_median_price, xianyu_price_range, xianyu_sample_count, xianyu_prices, search_date, confidence, note } = item;

    if (!xianyu_median_price) {
      console.log(`✗ 跳过(无价格): ${model}`);
      skipped++;
      continue;
    }

    // 解析机型键名: "Mac mini M2 8G 256G 二手" → "M2_8G_256G_二手"
    // 从 model 中提取芯片+内存+存储+状态
    const parts = model.split(' ');
    // 找到芯片(M1/M2/M3/M4/M5 开头)、内存(8G/16G/32G)、存储(256G/512G)、状态(二手/新品)
    const chip = parts.find((p) => /^M\d/.test(p));
    const ram = parts.find((p) => /^\d+G$/.test(p));
    const storage = parts.find((p) => /^\d+G$/.test(p) && p !== ram);
    const status = parts.find((p) => p === '二手' || p === '新品');

    if (!chip || !ram || !storage || !status) {
      console.error(`✗ 无法解析机型: ${model}`);
      skipped++;
      continue;
    }

    // 特殊处理: MacBook Air 需要尺寸前缀
    let modelKey;
    if (category === 'MacBook_Air') {
      // MacBook Air 默认 13 寸
      modelKey = `${chip}_13寸_${ram}_${storage}_${status}`;
    } else if (category === 'Mac_mini') {
      modelKey = `${chip}_${ram}_${storage}_${status}`;
    } else {
      modelKey = `${chip}_${ram}_${storage}_${status}`;
    }

    // 检查是否已存在
    if (snapshot[category] && snapshot[category][modelKey]) {
      console.log(`⚠ 已存在,将更新: ${category}/${modelKey}`);
    } else {
      console.log(`✓ 新增: ${category}/${modelKey} → 中位价 ${xianyu_median_price} 元 (${xianyu_sample_count} 样本)`);
    }

    const base = RESIDUE_BASE[category];
    const confidenceLabel =
      xianyu_sample_count >= 3
        ? `中(闲鱼挂单价,样本量${xianyu_sample_count}个)`
        : `低(闲鱼挂单价,样本量${xianyu_sample_count}个,样本不足)`;

    // 构建条目(参考现有 M2_16G_256G_二手 结构)
    const entry = {
      官方价: null,
      官方价_说明: `已停产。残值分母使用当前同品类新品价=${base.desc}`,
      闲鱼中位价_二手同款: xianyu_median_price,
      闲鱼中位价_二手同款_参考: null,
      闲鱼中位价_二手同款_参考区间: xianyu_price_range,
      闲鱼中位价_二手同款_参考来源: `Playwright connectOverCDP 闲鱼搜索'${item.query}'列表页快照提取,${xianyu_sample_count}个有效样本。注:闲鱼为挂单价非实付,实际成交价通常低5-10%`,
      京东拍拍价_二手: '无法搜索',
      爱回收售价_二手: '无法搜索',
      爱回收回收报价_下限: '无法搜索',
      样本量: `闲鱼挂单价${xianyu_sample_count}条(Playwright CDP采集,非实付)`,
      搜索来源URL: [`https://www.goofish.com/search?q=${encodeURIComponent(item.query)}`],
      搜索日期: search_date,
      置信度: confidenceLabel,
      备注: `闲鱼挂单价中位${xianyu_median_price}元(${search_date}采集),${xianyu_sample_count}个有效样本,价格区间${xianyu_price_range[0]}-${xianyu_price_range[1]}元。⚠️闲鱼挂单价(非实付交易),实际成交价通常比挂单价低5-10%。数据从搜索结果列表页快照提取,未逐一验证商品详情。${xianyu_sample_count >= 3 ? '样本量充足,可作为参考' : '样本量不足,仅供参考'}`,
      闲鱼价格区间: xianyu_price_range,
      闲鱼样本量: xianyu_sample_count,
      闲鱼中位价_来源: `闲鱼搜索'${item.query}'列表页快照提取,${xianyu_sample_count}个有效样本,价格${xianyu_price_range[0]}-${xianyu_price_range[1]}元,中位价${xianyu_median_price}元(${search_date}采集)。Playwright connectOverCDP 连接真实 Chrome 采集,绕过 Baxia 反爬`,
      闲鱼价格明细: xianyu_prices,
    };

    // 确保 category 存在
    if (!snapshot[category]) snapshot[category] = {};
    snapshot[category][modelKey] = entry;
    added++;
  }

  // 更新 snapshot_date
  const oldDate = snapshot.snapshot_date;
  snapshot.snapshot_date = new Date().toISOString().split('T')[0];
  console.log(`\n快照日期: ${oldDate} → ${snapshot.snapshot_date}`);

  // 写回
  writeFileSync(CONSTANTS_PATH, JSON.stringify(constants, null, 2) + '\n', 'utf-8');
  console.log(`\n=== 回写完成 ===`);
  console.log(`新增/更新: ${added} 个机型`);
  console.log(`跳过: ${skipped} 个`);
  console.log(`文件: ${CONSTANTS_PATH}`);
  console.log(`\n下一步: 运行 npm run sync:snapshot 同步到小程序`);
}

main().catch((err) => {
  console.error('回写失败:', err);
  process.exit(1);
});
