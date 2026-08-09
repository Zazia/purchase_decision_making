// -*- coding: utf-8 -*-
// 验证引擎修复: iPad全系分析, 确认新品方案可见且性能评分合理
const { loadConstants, computeParetoFrontier } = require('../wx/vendor/apple-value-engine/index');
const fs = require('fs');
const path = require('path');

// 加载小程序快照
const snapshotRaw = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../wx/snapshot/constants.json'), 'utf-8')
);
// 注入 MACRO_CONTEXT (模拟 engine-bridge 的 constants.js 顶部字段)
snapshotRaw.MACRO_CONTEXT = {
  storageSuperCycleStage: 'ongoing',
  hasGlobalPriceHike: true,
  analysisMonth: '2026-08',
};

const constants = loadConstants(JSON.stringify(snapshotRaw));

// 模拟用户选择: iPad / 5000元 / 持有1-5年 / 都看看 / 40%性能地板
const params = {
  category: 'ipad',
  budget: 5000,
  holdingYears: [1, 1.5, 2, 3, 4, 5],
  buyTiming: 'both',
  performanceFloor: 0.4,
  considerWait: true,
  macroContext: {
    storageSuperCycleStage: 'ongoing',
    hasGlobalPriceHike: true,
    analysisMonth: '2026-08',
  },
};

const result = computeParetoFrontier(constants, params);

console.log('='.repeat(100));
console.log('iPad全系修复验证 (buyTiming=both, 预算5000, 持有1-5年)');
console.log('='.repeat(100));

console.log('\n【前沿方案】(按月均成本升序)');
console.log('机型'.padEnd(35), '类型'.padEnd(4), '买入价'.padStart(6), '持年'.padStart(4),
  '月均'.padStart(6), '性能S0'.padStart(6), '平均性能'.padStart(6), '候选'.padStart(4));
console.log('-'.repeat(100));
for (const p of result.frontier) {
  const timing = p.buyTiming === 'new' ? '新品' : '二手';
  const ct = p.candidateType || 'A';
  console.log(
    p.model.padEnd(35),
    timing.padEnd(4),
    String(Math.round(p.buyPrice)).padStart(6),
    String(p.holdingYears).padStart(4),
    String(Math.round(p.monthlyCost)).padStart(6),
    (p.performanceS0 * 100).toFixed(1).padStart(5) + '%',
    (p.avgPerformance * 100).toFixed(1).padStart(5) + '%',
    ct.padStart(4),
  );
}

console.log('\n【推荐区间(预算内)】');
const rec = result.recommendationRange;
if (rec.plans && rec.plans.length > 0) {
  console.log(`  月均成本范围: ${Math.round(rec.lowerCost)} - ${Math.round(rec.upperCost)} 元`);
  for (const p of rec.plans) {
    console.log(`  ✓ ${p.model} | ${p.buyTiming === 'new' ? '新品' : '二手'} ${Math.round(p.buyPrice)}元 | 持${p.holdingYears}年 | 月均${Math.round(p.monthlyCost)}元 | 性能${(p.avgPerformance * 100).toFixed(1)}%`);
  }
} else {
  console.log('  (无预算内方案)');
}

if (rec.overBudgetPlans && rec.overBudgetPlans.length > 0) {
  console.log('\n【超预算参考方案】(overBudgetPlans)');
  for (const p of rec.overBudgetPlans) {
    console.log(`  + ${p.model} | ${p.buyTiming === 'new' ? '新品' : '二手'} ${Math.round(p.buyPrice)}元 | 持${p.holdingYears}年 | 月均${Math.round(p.monthlyCost)}元 | 性能${(p.avgPerformance * 100).toFixed(1)}%`);
  }
}

// 重点验证: iPad Pro 性能
console.log('\n【iPad Pro 性能验证】');
const proPlans = result.frontier.filter(p => p.model.includes('Pro') && p.model.includes('iPad'));
for (const p of proPlans.slice(0, 5)) {
  console.log(`  ${p.model} | S0=${(p.performanceS0 * 100).toFixed(1)}% | 平均=${(p.avgPerformance * 100).toFixed(1)}% | 月均${Math.round(p.monthlyCost)}元`);
}

// 重点验证: 新品方案数量
const newPlans = result.frontier.filter(p => p.buyTiming === 'new');
const usedPlans = result.frontier.filter(p => p.buyTiming === 'used');
console.log(`\n【新品 vs 二手 前沿方案数】`);
console.log(`  新品: ${newPlans.length}个`);
console.log(`  二手: ${usedPlans.length}个`);
if (newPlans.length === 0) {
  console.log('  ⚠️ 修复后新品仍为0! 需要检查 extractCandidates 逻辑');
} else {
  console.log('  ✅ 新品方案已出现在前沿中');
}

console.log(`\n【被支配方案】${result.dominated.length}个`);
const domNew = result.dominated.filter(p => p.buyTiming === 'new');
console.log(`  其中新品: ${domNew.length}个`);
