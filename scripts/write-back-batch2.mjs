#!/usr/bin/env node
/**
 * write-back-batch2.mjs — 将批次2闲鱼采集结果回写到 constants.json
 *
 * 读取 scripts/xianyu-prices-batch2.json,在对应品类下添加新机型条目。
 * 各品类 modelKey 格式参考现有条目:
 * - MacBook_Pro: {chip}_{尺寸}_{ram}_{storage}_二手
 * - iMac: {chip}_{尺寸}_{ram}_{storage}_二手 (新格式,带配置)
 * - iPhone_proMax: iPhone_{代}_ProMax_{storage}_二手
 * - iPhone_Pro: iPhone_{代}_Pro_{storage}_二手
 * - iPhone_标准: iPhone_{代}_{storage}_二手
 * - Mac_mini: {chip}_{ram}_{storage}_二手
 * - MacBook_Air: {chip}_{ram}_{storage}_二手
 * - iPad_Pro: {chip}_{尺寸}_{storage}_二手
 * - iPad_Air: {chip}_{尺寸}_{storage}_二手
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CONSTANTS_PATH = '.agents/skills/apple-value-analysis/constants.json';
const PRICES_PATH = 'scripts/xianyu-prices-batch2.json';

// 手动指定每个机型的 modelKey + 残值分母(新品价参考)
const MODEL_MAPPING = {
  'MacBook Pro M2Pro 32G 512G 二手': {
    modelKey: 'M2Pro_14寸_32G_512G_二手',
    category: 'MacBook_Pro',
    residueBase: { price: 14999, desc: 'MacBook Pro M5Pro 14寸16G+512G官方价14999元' },
  },
  'MacBook Pro M3Pro 36G 512G 二手': {
    modelKey: 'M3Pro_14寸_36G_512G_二手',
    category: 'MacBook_Pro',
    residueBase: { price: 14999, desc: 'MacBook Pro M5Pro 14寸16G+512G官方价14999元' },
  },
  'iMac M3 24寸 16G 512G 二手': {
    modelKey: 'M3_24寸_16G_512G_二手',
    category: 'iMac',
    residueBase: { price: 12999, desc: 'iMac M4 24寸官方价12999元' },
  },
  'iMac M1 24寸 16G 512G 二手': {
    modelKey: 'M1_24寸_16G_512G_二手',
    category: 'iMac',
    residueBase: { price: 12999, desc: 'iMac M4 24寸官方价12999元' },
  },
  'iPhone 16 Pro 128G 二手': {
    modelKey: 'iPhone_16_Pro_128G_二手',
    category: 'iPhone_Pro',
    residueBase: { price: 7999, desc: 'iPhone 17 Pro 256G官方价7999元' },
  },
  'iPhone 16 Pro 512G 二手': {
    modelKey: 'iPhone_16_Pro_512G_二手',
    category: 'iPhone_Pro',
    residueBase: { price: 7999, desc: 'iPhone 17 Pro 256G官方价7999元' },
  },
  'iPhone 16 128G 二手': {
    modelKey: 'iPhone_16_128G_二手',
    category: 'iPhone_标准',
    residueBase: { price: 5999, desc: 'iPhone 17 256G官方价5999元' },
  },
  'Mac mini M2 16G 512G 二手': {
    modelKey: 'M2_16G_512G_二手',
    category: 'Mac_mini',
    residueBase: { price: 5999, desc: 'Mac mini M4官方价5999元' },
  },
  'MacBook Air M2 16G 512G 二手': {
    modelKey: 'M2_16G_512G_二手',
    category: 'MacBook_Air',
    residueBase: { price: 9999, desc: 'MacBook Air M5 13寸16G+512G官方价9999元' },
  },
  'iPad Pro M2 11寸 512G 二手': {
    modelKey: 'M2_11寸_512G_二手',
    category: 'iPad_Pro',
    residueBase: { price: 8999, desc: 'iPad Pro M5 11寸256G官方价8999元' },
  },
  'iPad Pro M2 13寸 512G 二手': {
    modelKey: 'M2_13寸_512G_二手',
    category: 'iPad_Pro',
    residueBase: { price: 10999, desc: 'iPad Pro M5 13寸256G官方价10999元' },
  },
  'iPad Air M2 13寸 256G 二手': {
    modelKey: 'M2_13寸_256G_二手',
    category: 'iPad_Air',
    residueBase: { price: 5199, desc: 'iPad Air M4 13寸128G官方价5199元' },
  },
};

async function main() {
  console.log('=== 回写批次2闲鱼采集结果到 constants.json ===\n');

  const constants = JSON.parse(readFileSync(CONSTANTS_PATH, 'utf-8'));
  const prices = JSON.parse(readFileSync(PRICES_PATH, 'utf-8'));
  const snapshot = constants['实时市场价快照'];

  let added = 0;
  let skipped = 0;

  for (const item of prices) {
    const { model, xianyu_median_price, xianyu_price_range, xianyu_sample_count, xianyu_prices, search_date } = item;

    if (!xianyu_median_price) {
      console.log(`✗ 跳过(无价格): ${model}`);
      skipped++;
      continue;
    }

    const mapping = MODEL_MAPPING[model];
    if (!mapping) {
      console.error(`✗ 无映射配置: ${model}`);
      skipped++;
      continue;
    }

    const { modelKey, category, residueBase } = mapping;
    const cat = snapshot[category];
    if (!cat) {
      console.error(`✗ 品类不存在: ${category}`);
      skipped++;
      continue;
    }

    if (cat[modelKey]) {
      console.log(`⚠ 已存在,将更新: ${category}/${modelKey}`);
    } else {
      console.log(`✓ 新增: ${category}/${modelKey} → 中位价 ${xianyu_median_price} 元 (${xianyu_sample_count} 样本)`);
    }

    const confidenceLabel =
      xianyu_sample_count >= 3
        ? `中(闲鱼挂单价,样本量${xianyu_sample_count}个)`
        : `低(闲鱼挂单价,样本量${xianyu_sample_count}个,样本不足)`;

    const entry = {
      官方价: null,
      官方价_说明: `已停产。残值分母使用当前同品类新品价=${residueBase.desc}`,
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

    cat[modelKey] = entry;
    added++;
  }

  // 更新 snapshot_date
  const oldDate = snapshot.snapshot_date;
  snapshot.snapshot_date = new Date().toISOString().split('T')[0];
  console.log(`\n快照日期: ${oldDate} → ${snapshot.snapshot_date}`);

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
