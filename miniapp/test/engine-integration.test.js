/**
 * engine-integration.test.js — 引擎与小程序快照集成测试
 *
 * 在 Node 中模拟 engine-bridge 的行为:
 *  1. 加载 miniapp/wx/snapshot/constants.json
 *  2. 用 loadConstants 解析
 *  3. 用 computeParetoFrontier 计算各种决策参数
 *  4. 验证前沿非空、字段完整、推荐区间合理
 *
 * 这等同于测试 result 页的 compute() 调用链。
 */
const path = require('path');
const fs = require('fs');

const engine = require(path.join(__dirname, '..', 'wx', 'vendor', 'apple-value-engine', 'index.js'));
const snapshotRaw = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'wx', 'snapshot', 'constants.json'), 'utf-8'),
);

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  [PASS] ${msg}`); }
  else { failed++; console.log(`  [FAIL] ${msg}`); }
}

function section(name) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${name}`);
  console.log('='.repeat(60));
}

async function run() {
  section('1. 加载快照');
  let constants;
  try {
    constants = engine.loadConstants(JSON.stringify(snapshotRaw));
    assert(!!constants, 'loadConstants 成功');
    assert(!!constants.lastUpdated, `lastUpdated=${constants.lastUpdated}`);
    console.log(`  [INFO] 数据版本: ${snapshotRaw.metadata?.version}, 更新于: ${constants.lastUpdated}`);
  } catch (e) {
    console.log(`  [FATAL] loadConstants 失败: ${e.message}`);
    process.exit(1);
  }

  section('2. computeParetoFrontier — 各品类测试');

  const categories = ['mac-mini', 'macbook-air', 'macbook-pro', 'iphone', 'ipad', 'imac'];
  const budgetMap = { 'mac-mini': 5000, 'macbook-air': 7000, 'macbook-pro': 12000, 'iphone': 5000, 'ipad': 4000, 'imac': 10000 };

  for (const category of categories) {
    console.log(`\n  --- ${category} ---`);
    const params = {
      category,
      budget: budgetMap[category],
      holdingYears: [2, 3, 4],
      buyTiming: 'used',
      performanceFloor: 0.4,
    };
    try {
      const result = engine.computeParetoFrontier(constants, params);
      assert(result.frontier.length > 0, `${category}: 前沿非空 (${result.frontier.length} 个方案)`);

      if (result.frontier.length > 0) {
        const p = result.frontier[0];
        assert(typeof p.model === 'string', `${category}: model 是字符串 (${p.model})`);
        assert(typeof p.monthlyCost === 'number' && p.monthlyCost > 0, `${category}: monthlyCost>0 (${p.monthlyCost})`);
        assert(typeof p.avgPerformance === 'number', `${category}: avgPerformance=${p.avgPerformance}`);
        assert(typeof p.buyPrice === 'number', `${category}: buyPrice=${p.buyPrice}`);
        assert(typeof p.residual === 'number', `${category}: residual=${p.residual}`);
        assert(p.buyPrice <= budgetMap[category], `${category}: buyPrice<=budget (${p.buyPrice}<=${budgetMap[category]})`);

        // 推荐区间 (可能为空, 如旧机型性能低于地板)
        if (result.recommendationRange) {
          const rr = result.recommendationRange;
          assert(rr.lowerCost <= rr.upperCost, `${category}: 推荐区间 lower<=upper (${rr.lowerCost}<=${rr.upperCost})`);
          console.log(`  [INFO] ${category}: 推荐区间方案数=${rr.plans.length} (可能因性能地板过滤为0)`);
        }
      }
    } catch (e) {
      assert(false, `${category}: computeParetoFrontier 抛错: ${e.message}`);
    }
  }

  section('3. 边界场景测试');

  // 3.1 极低预算 — 前沿不按预算过滤(设计如此), 但推荐区间应空
  console.log('\n  --- 极低预算 (1000元): 推荐区间应为空 ---');
  try {
    const result = engine.computeParetoFrontier(constants, {
      category: 'mac-mini', budget: 1000, holdingYears: [2], buyTiming: 'used', performanceFloor: 0.3,
    });
    assert(result.recommendationRange.plans.length === 0, `极低预算推荐区间应空 (${result.recommendationRange.plans.length} 个)`);
    console.log(`  [INFO] 前沿数: ${result.frontier.length} (不按预算过滤, 设计如此)`);
  } catch (e) {
    assert(false, `极低预算抛错: ${e.message}`);
  }

  // 3.2 新品
  console.log('\n  --- 新品 ---');
  try {
    const result = engine.computeParetoFrontier(constants, {
      category: 'mac-mini', budget: 8000, holdingYears: [3], buyTiming: 'new', performanceFloor: 0.5,
    });
    assert(result.frontier.length > 0, `新品方案非空 (${result.frontier.length} 个)`);
    if (result.frontier.length > 0) {
      assert(result.frontier.every(p => p.buyTiming === 'new'), '所有方案应为新品');
    }
  } catch (e) {
    assert(false, `新品抛错: ${e.message}`);
  }

  // 3.3 高性能地板
  // 设计: 性能地板只过滤推荐区间, 不影响前沿本身
  console.log('\n  --- 高性能地板 (0.8) ---');
  try {
    const result = engine.computeParetoFrontier(constants, {
      category: 'macbook-pro', budget: 20000, holdingYears: [3, 4, 5], buyTiming: 'used', performanceFloor: 0.8,
    });
    console.log(`  [INFO] 高性能地板前沿数: ${result.frontier.length} (不按性能地板过滤, 设计如此)`);
    assert(result.frontier.length > 0, `前沿非空 (${result.frontier.length} 个方案)`);
    // 推荐区间里的方案必须满足性能地板
    const plans = result.recommendationRange.plans;
    console.log(`  [INFO] 推荐区间方案数: ${plans.length}`);
    if (plans.length > 0) {
      assert(plans.every(p => p.avgPerformance >= 0.8 - 0.001), '推荐区间所有方案性能>=0.8');
    }
  } catch (e) {
    assert(false, `高性能地板抛错: ${e.message}`);
  }

  // 3.4 持有期 5 年
  console.log('\n  --- 持有期 5 年 ---');
  try {
    const result = engine.computeParetoFrontier(constants, {
      category: 'mac-mini', budget: 8000, holdingYears: [5], buyTiming: 'used', performanceFloor: 0.3,
    });
    assert(result.frontier.length > 0, `5年持有期方案非空 (${result.frontier.length} 个)`);
    if (result.frontier.length > 0) {
      assert(result.frontier.every(p => p.holdingYears === 5), '所有方案持有期=5年');
    }
  } catch (e) {
    assert(false, `5年持有期抛错: ${e.message}`);
  }

  section(failed === 0 ? `全部通过 (${passed} 项)` : `通过 ${passed}, 失败 ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
