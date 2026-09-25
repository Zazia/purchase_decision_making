import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const constants = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents/skills/apple-value-analysis/constants.json'), 'utf8'));
const reportPath = path.join(ROOT, `${constants.metadata.last_updated}-产品残值曲线可视化.html`);
const payloadPath = path.join(ROOT, 'scripts/debug/residual-curves-payload.json');
const report = fs.readFileSync(reportPath, 'utf8');
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const errors = [];

if (payload.summary.observations !== 70) errors.push(`expected 70 observations, got ${payload.summary.observations}`);
if (payload.comparison_points.length !== payload.summary.observations) errors.push('comparison point count does not match summary');
if (payload.comparison_points.some((point) => point.retention_observed != null && point.denominator_kind !== 'launch_msrp')) {
  errors.push('curve-comparison point uses a denominator other than launch_msrp');
}
if (payload.comparison_points.some((point) => point.retention_observed != null && point.launch_msrp == null)) {
  errors.push('curve-comparison point has no launch MSRP');
}
if (payload.comparison_points.some((point) => point.calibration_eligible && point.retention_observed == null)) {
  errors.push('calibration-eligible point has no observed retention');
}
if (payload.categories.some((category) => category.read_only_retention_mae != null && category.eligible_count === 0)) {
  errors.push('MAE shown without calibration-eligible retention observations');
}
if (!report.includes('listing 为“挂牌价”') || !report.includes('挂牌价')) errors.push('listing is not visibly labelled as 挂牌价');
if (!report.includes('替代价值率') || !report.includes('个体投资保值率')) errors.push('independent ratio layers are missing');
if (!report.includes('错误校准已撤销') || !report.includes('本次不进行正式重拟合')) errors.push('rollback/provisional conclusion is missing');
if (/cdn\.jsdelivr|<script\s+src=|<link\s+[^>]*href=/i.test(report)) errors.push('report contains an external asset dependency');
if (report.includes('优先本条官方价 / 说明明示 / 同品类在售新品官价')) errors.push('legacy denominator fallback text remains');
if (report.includes('实价</') || report.includes('参考价口径')) errors.push('ambiguous legacy price labels remain');

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`报告口径验证通过：${payload.summary.observations} 条观测，${payload.summary.launch_linked} 条首发价链接，${payload.summary.calibration_eligible} 条可校准。`);
