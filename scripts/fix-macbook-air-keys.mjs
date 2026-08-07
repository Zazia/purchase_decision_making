#!/usr/bin/env node
/**
 * fix-macbook-air-keys.mjs — 修正 MacBook_Air 二手机型键名
 *
 * 去掉尺寸前缀(M2_13寸_8G_256G_二手 → M2_8G_256G_二手),
 * 与现有二手机型格式保持一致,确保 releaseDateKey 能匹配发布日期表。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CONSTANTS_PATH = '.agents/skills/apple-value-analysis/constants.json';

const RENAMES = [
  { from: 'M2_13寸_8G_256G_二手', to: 'M2_8G_256G_二手' },
  { from: 'M1_13寸_8G_256G_二手', to: 'M1_8G_256G_二手' },
  { from: 'M3_13寸_8G_256G_二手', to: 'M3_8G_256G_二手' },
];

const constants = JSON.parse(readFileSync(CONSTANTS_PATH, 'utf-8'));
const snapshot = constants['实时市场价快照'];
const air = snapshot['MacBook_Air'];

if (!air) {
  console.error('MacBook_Air 品类不存在');
  process.exit(1);
}

for (const { from, to } of RENAMES) {
  if (air[from]) {
    console.log(`重命名: ${from} → ${to}`);
    air[to] = air[from];
    delete air[from];
  } else {
    console.log(`跳过(不存在): ${from}`);
  }
}

writeFileSync(CONSTANTS_PATH, JSON.stringify(constants, null, 2) + '\n', 'utf-8');
console.log('\n修正完成');
