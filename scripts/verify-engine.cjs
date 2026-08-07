// verify-engine.cjs — 验证引擎能正确解析新增机型
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { computeParetoFrontier, loadConstants } = require(path.join(ROOT, 'packages/apple-value-engine/dist/index.js'));

// 读取原始 JSON 文本并用 loadConstants 转换为引擎格式
const rawText = fs.readFileSync(path.join(ROOT, '.agents/skills/apple-value-analysis/constants.json'), 'utf-8');
const constants = loadConstants(rawText);

const cats = ['Mac_mini','MacBook_Air','MacBook_Pro','iMac','iPhone_Pro','iPhone_标准','iPhone_proMax','iPad_Pro','iPad_Air'];

console.log('=== 引擎验证：各品类候选点/前沿点数量 ===\n');

// 先测试 Mac_mini，加详细调试
const testCat = 'Mac_mini';
const testParams = {
  category: testCat,
  budget: 20000,
  holdingYears: [2, 3, 4],
  buyTiming: 'used',
  performanceFloor: 0,
};
try {
  console.log('marketSnapshots keys:', Object.keys(constants.marketSnapshots || {}).slice(0, 10));
  if (constants.marketSnapshots?.[testCat]) {
    const models = Object.keys(constants.marketSnapshots[testCat]).filter(k => !k.startsWith('_'));
    console.log('Mac_mini 机型数:', models.length, models);
  }
  const r = computeParetoFrontier(constants, testParams);
  console.log('成功! 前沿:', r.frontier.length, '支配:', r.dominated.length);
} catch (err) {
  console.log('错误:', err.message);
  console.log('堆栈:', err.stack?.split('\n').slice(0, 8).join('\n'));
}

console.log('\n--- 全部品类 ---\n');
for (const cat of cats) {
  const params = {
    category: cat,
    budget: 20000,
    holdingYears: [2, 3, 4],
    buyTiming: 'used',
    performanceFloor: 0,
  };
  try {
    const r = computeParetoFrontier(constants, params);
    const total = r.frontier.length + r.dominated.length;
    console.log(`${cat.padEnd(15)} 候选:${String(total).padStart(2)}  前沿:${String(r.frontier.length).padStart(2)}  支配:${String(r.dominated.length).padStart(2)}`);
    // 列出前沿方案的机型
    if (r.frontier.length > 0) {
      const models = r.frontier.map(f => f.modelKey || f.model || '?').slice(0, 5);
      console.log(`                 前沿机型: ${models.join(', ')}${r.frontier.length > 5 ? '...' : ''}`);
    }
  } catch (err) {
    console.log(`${cat.padEnd(15)} 错误: ${err.message}`);
  }
}
