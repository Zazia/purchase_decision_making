// 检验「月均成本 vs 持有期」是否为 U 型曲线(一次性分析脚本)
// 数据源: .agents/skills/apple-value-analysis/constants.json (2026-09-05)
import { readFileSync } from 'node:fs';

const C = JSON.parse(
  readFileSync('i:/_Devolopment/1-small-tools/purchase_decision_making/.agents/skills/apple-value-analysis/constants.json', 'utf-8')
);
const curves = C['保值率曲线'];
const maint = C['持有期预期维修成本'];
const batteryCycle = maint['电池寿命周期_月'];
const batteryPrice = maint['单次电池更换费用'];
const annualRepair = maint['年均故障维修费用'];

function retention(curve, t) {
  const pts = Object.keys(curve)
    .filter(k => /^\d+$/.test(k))
    .map(Number).sort((a, b) => a - b).map(m => [m, curve[String(m)]]);
  const floor = curve['_floor'] ?? 3;
  const hl = curve['_half_life_months'] ?? 24;
  const last = pts[pts.length - 1];
  if (t <= last[0]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [m0, r0] = pts[i], [m1, r1] = pts[i + 1];
      if (t >= m0 && t <= m1) return r0 + (r1 - r0) * (t - m0) / (m1 - m0);
    }
    return last[1];
  }
  return floor + (last[1] - floor) * Math.pow(0.5, (t - last[0]) / hl);
}

function monthlyCost(cfg, N) {
  const r = retention(cfg.curve, N);
  const res = r / 100 * cfg.denominator;
  const bat = Math.floor(N / batteryCycle) * cfg.batteryCost;
  const rep = N / 12 * cfg.repairAnnual;
  return (cfg.buyPrice - res + bat + rep) / N;
}

const devices = [
  { name: 'iPhone17标准(新品5999)', curve: curves['iPhone_标准'], buyPrice: 5999, denominator: 5999, batteryCost: batteryPrice['iPhone'], repairAnnual: annualRepair['iPhone'], r: 0.15 },
  { name: 'iPhone17ProMax(新品9999)', curve: curves['iPhone_ProMax'], buyPrice: 9999, denominator: 9999, batteryCost: batteryPrice['iPhone'], repairAnnual: annualRepair['iPhone'], r: 0.15 },
  { name: 'MacBookAir M5(新品9999)', curve: curves['MacBook_Air'], buyPrice: 9999, denominator: 9999, batteryCost: batteryPrice['MacBook_Air'], repairAnnual: annualRepair['MacBook_Air'], r: 0.16 },
  { name: 'Mac mini M6(新品6999)', curve: curves['Mac_mini'], buyPrice: 6999, denominator: 6999, batteryCost: 0, repairAnnual: annualRepair['Mac_mini'], r: 0.16 },
];

const grid = [6, 12, 18, 24, 30, 35, 36, 42, 48, 54, 60, 66, 71, 72, 78, 84, 90, 96, 102, 107, 108, 114, 120];

for (const d of devices) {
  console.log(`\n===== ${d.name} =====`);
  console.log('持有月数 | 月均成本 | 其中贬值分摊 | 维修分摊 | 保值率% | 残值元 | 单位性能月成本(¥/性能点)');
  for (const N of grid) {
    const r = retention(d.curve, N);
    const res = r / 100 * d.denominator;
    const bat = Math.floor(N / batteryCycle) * d.batteryCost;
    const rep = N / 12 * d.repairAnnual;
    const dep = (d.buyPrice - res) / N;
    const mnt = (bat + rep) / N;
    const cost = dep + mnt;
    // 性能满足度: 新品买入 S(0)=100, S(N)=100/(1+r)^(N/12), 持有期平均取两端均值
    const sAvg = (100 + 100 / Math.pow(1 + d.r, N / 12)) / 2;
    console.log(
      String(N).padStart(5) + '月 | ' +
      cost.toFixed(1).padStart(7) + ' | ' +
      dep.toFixed(1).padStart(8) + ' | ' +
      mnt.toFixed(1).padStart(6) + ' | ' +
      r.toFixed(1).padStart(6) + ' | ' +
      res.toFixed(0).padStart(6) + ' | ' +
      (cost / (sAvg / 100)).toFixed(2).padStart(8)
    );
  }
  // 形状判定: 逐月扫描 6..120, 找全局最小与局部极小
  const costs = [];
  for (let N = 6; N <= 120; N++) costs.push([N, monthlyCost(d, N)]);
  const globalMin = costs.reduce((a, b) => (b[1] < a[1] ? b : a));
  const localMins = costs.filter(([N, v], i) => {
    if (i === 0 || i === costs.length - 1) return false;
    return v < costs[i - 1][1] && v < costs[i + 1][1];
  });
  const jumps = [];
  for (let i = 1; i < costs.length; i++) {
    if (costs[i][1] > costs[i - 1][1]) jumps.push(`${costs[i - 1][0]}→${costs[i][0]}月 +${(costs[i][1] - costs[i - 1][1]).toFixed(1)}`);
  }
  console.log(`形状判定: 全局最小 @${globalMin[0]}月 ¥${globalMin[1].toFixed(1)}/月; 局部极小 @${localMins.map(x => x[0] + '月').join(', ') || '无'}; 上升跳变: ${jumps.join(' | ')}`);
}
