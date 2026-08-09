// 检查 iPad Pro 候选详情
const { loadConstants, computeParetoFrontier } = require('../wx/vendor/apple-value-engine/index');
const fs = require('fs');
const path = require('path');

const snapshotRaw = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../wx/snapshot/constants.json'), 'utf-8')
);
snapshotRaw.MACRO_CONTEXT = {
  storageSuperCycleStage: 'ongoing',
  hasGlobalPriceHike: true,
  analysisMonth: '2026-08',
};
const constants = loadConstants(JSON.stringify(snapshotRaw));

const params = {
  category: 'ipad', budget: 5000, holdingYears: [2, 3, 5],
  buyTiming: 'both', performanceFloor: 0.4, considerWait: true,
  macroContext: { storageSuperCycleStage: 'ongoing', hasGlobalPriceHike: true, analysisMonth: '2026-08' },
};
const result = computeParetoFrontier(constants, params);

// 找所有 iPad Pro 方案(前沿 + 被支配)
const allPro = [...result.frontier, ...result.dominated].filter(p => p.model.includes('Pro') && !p.model.includes('iPhone'));

console.log('【iPad Pro 全部方案】');
console.log('机型'.padEnd(35), '类型'.padEnd(4), '买入价'.padStart(6), '持年'.padStart(4),
  '月均'.padStart(6), 'S0'.padStart(6), '平均性能'.padStart(6), '在前沿'.padStart(4));
console.log('-'.repeat(90));
for (const p of allPro) {
  const inFront = result.frontier.includes(p) ? '✓' : '✗';
  console.log(
    p.model.padEnd(35),
    (p.buyTiming === 'new' ? '新品' : '二手').padEnd(4),
    String(Math.round(p.buyPrice)).padStart(6),
    String(p.holdingYears).padStart(4),
    String(Math.round(p.monthlyCost)).padStart(6),
    (p.performanceS0 * 100).toFixed(1).padStart(5) + '%',
    (p.avgPerformance * 100).toFixed(1).padStart(5) + '%',
    inFront.padStart(4),
  );
}

// 对比: iPad Air M4 新品
const airM4 = [...result.frontier, ...result.dominated].filter(p => p.model.includes('M4') && p.model.includes('128G'));
console.log('\n【iPad Air M4 对比】');
for (const p of airM4.slice(0, 3)) {
  const inFront = result.frontier.includes(p) ? '✓' : '✗';
  console.log(
    p.model.padEnd(35),
    (p.buyTiming === 'new' ? '新品' : '二手').padEnd(4),
    String(Math.round(p.buyPrice)).padStart(6),
    String(p.holdingYears).padStart(4),
    String(Math.round(p.monthlyCost)).padStart(6),
    (p.performanceS0 * 100).toFixed(1).padStart(5) + '%',
    (p.avgPerformance * 100).toFixed(1).padStart(5) + '%',
    inFront.padStart(4),
  );
}

// 验证: iPad Pro S0 是否用了 Mac 基准(M5=17100)
console.log('\n【S0 验证】');
console.log('iPad Pro M2 8GB 256G 预期: (9700/17100)*0.65*0.85*1.08 =', (9700/17100 * 0.65 * 0.85 * 1.08 * 100).toFixed(1) + '%');
console.log('iPad Air M4 12GB 128G 预期: (15000/9500)*1.0*0.85*1.0 =', (15000/9500 * 1.0 * 0.85 * 1.0 * 100).toFixed(1) + '%');
