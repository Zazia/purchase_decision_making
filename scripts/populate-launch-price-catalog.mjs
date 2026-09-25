#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameConfiguration } from './lib/residual-observations.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const constants = JSON.parse(readFileSync(SOURCE, 'utf8'));

const records = [
  // Mac mini：仅录入 Apple Newsroom 明确给出起售价的首发基础配置；CTO/升级配置不猜价。
  ['cn-mac-mini-m1-8-256', 'Mac_mini', 'M1', 'M1_8G_256G', null, 'base', 8, 256, '2020-11-10', 5299, 'https://www.apple.com.cn/cn/newsroom/2020/11/introducing-the-next-generation-of-mac/'],
  ['cn-mac-mini-m2-8-256', 'Mac_mini', 'M2', 'M2_8G_256G', null, 'base', 8, 256, '2023-01-17', 4499, 'https://www.apple.com.cn/cn/newsroom/2023/01/apple-introduces-new-mac-mini-with-m2-and-m2-pro-more-powerful-capable-and-versatile-than-ever/'],
  ['cn-mac-mini-m4-16-256', 'Mac_mini', 'M4', 'M4_16G_256G', null, 'base', 16, 256, '2024-10-29', 4499, 'https://www.apple.com.cn/cn/newsroom/2024/10/apples-all-new-mac-mini-is-even-more-mighty-and-more-mini/'],

  // iPhone：只录入新闻稿“起售价”所对应的首发起步容量；高容量档没有官方价格矩阵证据时不猜价。
  ['cn-iphone-13-128', 'iPhone_标准', 'iPhone_13', 'iPhone_13_128G', null, 'base', null, 128, '2021-09-15', 5999, 'https://www.apple.com.cn/cn/newsroom/2021/09/apple-introduces-iphone-13-and-iphone-13-mini/'],
  ['cn-iphone-14-128', 'iPhone_标准', 'iPhone_14', 'iPhone_14_128G', null, 'base', null, 128, '2022-09-08', 5999, 'https://www.apple.com.cn/cn/newsroom/2022/09/apple-introduces-iphone-14-and-iphone-14-plus/'],
  ['cn-iphone-15-128', 'iPhone_标准', 'iPhone_15', 'iPhone_15_128G', null, 'base', null, 128, '2023-09-13', 5999, 'https://www.apple.com.cn/cn/newsroom/2023/09/apple-debuts-iphone-15-and-iphone-15-plus/'],
  ['cn-iphone-16-128', 'iPhone_标准', 'iPhone_16', 'iPhone_16_128G', null, 'base', null, 128, '2024-09-10', 5999, 'https://www.apple.com.cn/cn/newsroom/2024/09/apple-introduces-iphone-16-iphone-16-plus/'],
  ['cn-iphone-14-pro-128', 'iPhone_Pro', 'iPhone_14', 'iPhone_14_Pro_128G', null, 'pro', null, 128, '2022-09-08', 7999, 'https://www.apple.com.cn/cn/newsroom/2022/09/apple-debuts-iphone-14-pro-and-iphone-14-pro-max/'],
  ['cn-iphone-15-pro-128', 'iPhone_Pro', 'iPhone_15', 'iPhone_15_Pro_128G', null, 'pro', null, 128, '2023-09-13', 7999, 'https://www.apple.com.cn/cn/newsroom/2023/09/apple-unveils-iphone-15-pro-and-iphone-15-pro-max/'],
  ['cn-iphone-16-pro-128', 'iPhone_Pro', 'iPhone_16', 'iPhone_16_Pro_128G', null, 'pro', null, 128, '2024-09-10', 7999, 'https://www.apple.com.cn/cn/newsroom/2024/09/apple-debuts-iphone-16-pro-iphone-16-pro-max/'],
  ['cn-iphone-14-promax-128', 'iPhone_proMax', 'iPhone_14', 'iPhone_14_ProMax_128G', null, 'max', null, 128, '2022-09-08', 8999, 'https://www.apple.com.cn/cn/newsroom/2022/09/apple-debuts-iphone-14-pro-and-iphone-14-pro-max/'],
  ['cn-iphone-15-promax-256', 'iPhone_proMax', 'iPhone_15', 'iPhone_15_ProMax_256G', null, 'max', null, 256, '2023-09-13', 9999, 'https://www.apple.com.cn/cn/newsroom/2023/09/apple-unveils-iphone-15-pro-and-iphone-15-pro-max/'],
  ['cn-iphone-16-promax-256', 'iPhone_proMax', 'iPhone_16', 'iPhone_16_ProMax_256G', null, 'max', null, 256, '2024-09-10', 9999, 'https://www.apple.com.cn/cn/newsroom/2024/09/apple-debuts-iphone-16-pro-iphone-16-pro-max/'],

  // MacBook Air 基础配置。
  ['cn-mba-m1-8-256', 'MacBook_Air', 'M1', 'M1_8G_256G', '13', 'base', 8, 256, '2020-11-10', 7999, 'https://www.apple.com.cn/cn/newsroom/2020/11/introducing-the-next-generation-of-mac/'],
  ['cn-mba-m2-8-256', 'MacBook_Air', 'M2', 'M2_8G_256G', '13', 'base', 8, 256, '2022-06-06', 9499, 'https://www.apple.com.cn/cn/newsroom/2022/06/apple-unveils-all-new-macbook-air-supercharged-by-the-new-m2-chip/'],
  ['cn-mba-m3-8-256', 'MacBook_Air', 'M3', 'M3_8G_256G', '13', 'base', 8, 256, '2024-03-04', 8999, 'https://www.apple.com.cn/cn/newsroom/2024/03/apple-unveils-the-new-13-and-15-inch-macbook-air-with-the-powerful-m3-chip/'],
  ['cn-mba-m4-16-256', 'MacBook_Air', 'M4', 'M4_16G_256G', '13', 'base', 16, 256, '2025-03-05', 7999, 'https://www.apple.com.cn/cn/newsroom/2025/03/apple-introduces-the-new-macbook-air-with-the-m4-chip-and-a-sky-blue-color/'],

  // MacBook Pro 基础配置；M3 Pro 观测写作 16GB，而官方基础配置为 18GB，故不建立错误匹配。
  ['cn-mbp-m1pro-14-16-512', 'MacBook_Pro', 'M1Pro', 'M1Pro_14寸_16G_512G', '14', 'pro', 16, 512, '2021-10-19', 14999, 'https://www.apple.com.cn/cn/newsroom/2021/10/apple-unveils-game-changing-macbook-pro/'],
  ['cn-mbp-m2pro-14-16-512', 'MacBook_Pro', 'M2Pro', 'M2Pro_14寸_16G_512G', '14', 'pro', 16, 512, '2023-01-17', 15999, 'https://www.apple.com.cn/cn/newsroom/2023/01/apple-unveils-macbook-pro-featuring-m2-pro-and-m2-max/'],
  ['cn-mbp-m4pro-14-24-512', 'MacBook_Pro', 'M4Pro', 'M4Pro_14寸_24G_512G', '14', 'pro', 24, 512, '2024-10-30', 16999, 'https://www.apple.com.cn/cn/newsroom/2024/10/apples-new-macbook-pro-features-the-incredibly-powerful-m4-family-of-chips/'],

  // iPad：仅新闻稿明确给出的 Wi-Fi 起步容量配置。
  ['cn-ipad-pro-m4-11-256', 'iPad_Pro', 'M4', 'M4_11寸_256G', '11', 'pro', null, 256, '2024-05-07', 8999, 'https://www.apple.com.cn/cn/newsroom/2024/05/apple-unveils-stunning-new-ipad-pro-with-m4-chip-and-apple-pencil-pro/'],
  ['cn-ipad-air-m2-11-128', 'iPad_Air', 'M2', 'M2_11寸_128G', '11', 'base', null, 128, '2024-05-07', 4799, 'https://www.apple.com.cn/cn/newsroom/2024/05/apple-unveils-the-redesigned-11-inch-and-all-new-13-inch-ipad-air-with-m2/'],
  ['cn-ipad-air-m2-13-128', 'iPad_Air', 'M2', 'M2_13寸_128G', '13', 'base', null, 128, '2024-05-07', 6499, 'https://www.apple.com.cn/cn/newsroom/2024/05/apple-unveils-the-redesigned-11-inch-and-all-new-13-inch-ipad-air-with-m2/'],
  ['cn-ipad-air-m3-11-128', 'iPad_Air', 'M3', 'M3_11寸_128G', '11', 'base', null, 128, '2025-03-04', 4799, 'https://www.apple.com.cn/cn/newsroom/2025/03/apple-introduces-ipad-air-with-powerful-m3-chip-and-new-magic-keyboard/'],
  ['cn-ipad-mini-a17pro-128', 'iPad_mini', 'A17_Pro', 'A17_Pro_128G', null, 'pro', null, 128, '2024-10-15', 3999, 'https://www.apple.com.cn/cn/newsroom/2024/10/apple-introduces-powerful-new-ipad-mini-with-a17-pro/'],
  ['cn-ipad-mini-a15-64', 'iPad_mini', 'A15', 'A15_64G', null, 'base', null, 64, '2021-09-15', 3799, 'https://www.apple.com.cn/cn/newsroom/2021/09/apple-unveils-new-ipad-mini-with-breakthrough-performance-in-stunning-new-design/'],
].map(([id, category, generation, modelKey, size, chipTier, memoryGb, storageGb, releaseDate, launchMsrp, sourceUrl]) => [id, {
  id,
  category,
  generation,
  model_key: modelKey,
  configuration: { size, chip_tier: chipTier, memory_gb: memoryGb, storage_gb: storageGb },
  region: 'CN',
  currency: 'CNY',
  release_date: releaseDate,
  launch_msrp: launchMsrp,
  price_kind: 'launch_msrp',
  source_url: sourceUrl,
  verification_status: 'verified',
}]);

constants['首发价目录'].records = Object.fromEntries(records);
const byModel = new Map(records.map(([id, record]) => [`${record.category}/${record.model_key}`, id]));
for (const observation of constants['二手价格观测'].records) {
  const launchId = byModel.get(`${observation.category}/${observation.model_key}`) ?? null;
  observation.launch_price_id = launchId;
  observation.calibration_eligible = Boolean(launchId)
    && sameConfiguration(observation, constants['首发价目录'].records[launchId])
    && observation.price_type !== 'reference';
  if (observation.category === 'Mac_mini' && observation.observed_at >= '2026-08-25') {
    observation.event_state = 'launch_window';
    observation.calibration_eligible = false;
  }
}

writeFileSync(SOURCE, JSON.stringify(constants, null, 2) + '\n', 'utf8');
console.log(`[populate-launch-price-catalog] launch_prices=${records.length}`);
console.log(`[populate-launch-price-catalog] linked_observations=${constants['二手价格观测'].records.filter((record) => record.launch_price_id).length}`);
console.log(`[populate-launch-price-catalog] declared_eligible=${constants['二手价格观测'].records.filter((record) => record.calibration_eligible).length}`);
