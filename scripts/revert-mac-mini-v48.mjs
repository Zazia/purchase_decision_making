#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeObservationData } from './lib/residual-observations.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const constants = JSON.parse(readFileSync(SOURCE, 'utf8'));
const curve = constants['保值率曲线'].Mac_mini;
const oldCurve = structuredClone(curve);

for (const [month, rate] of Object.entries({ 18: 72, 24: 65, 36: 52, 48: 46 })) curve[month] = rate;
if (curve['_曲线修订_v4.8']) {
  curve['_无效校准_v4.8'] = {
    ...curve['_曲线修订_v4.8'],
    '_失效原因_v4.9': '校准分母统一使用当前 Mac mini M6 基础款 6999 元，而曲线定义要求同型号同配置首发官方价；报告 MAE 与理论曲线口径不兼容。',
    '_状态': 'invalid_calibration_applied',
  };
  delete curve['_曲线修订_v4.8'];
}
curve['_临时基线_v4.9'] = {
  '_状态': 'provisional/unverified',
  '_说明': '18–48 月恢复 v4.5 节点仅用于撤销 v4.8 错误断崖，不代表 v4.5 已被新观测验证。',
  '_恢复节点': { 18: 72, 24: 65, 36: 52, 48: 46 },
  '_正式重拟合前置条件': '同配置首发价、跨至少两个代际、每个受影响年龄带至少三个中高置信观测且含成交/实付，并通过留一代交叉验证。',
};

constants.metadata.version = '4.9';
constants.metadata.last_updated = '2026-09-25';
constants.metadata['v4.9_变更摘要'] = [
  '判定 Mac mini v4.8 校准失效：九个旧报告点使用当前 M6 基础款 6999 元或说明文本作为分母，与“同型号同配置首发官方价”曲线定义不兼容，旧 MAE 改善不得作为验收证据。',
  '撤销 Mac mini 18/24/36/48 月 68/55/47/41 节点，恢复 v4.5 的 72/65/52/46 临时基线；0–12 月、60 月、floor=5 与 half-life=45 不变。临时基线标记 provisional/unverified，不宣称准确。',
  '新增结构化首发价目录、70 条二手观测、三类价格比率归一化、全品类审计与曲线发布门禁；高配/CTO、事件窗口及来源不足观测保留但不进入校准。',
];

const macRows = normalizeObservationData(constants).rows.filter((row) => row.category === 'Mac_mini');
const manifest = {
  id: 'mac-mini-v4.9-provisional-rollback',
  category: 'Mac_mini',
  target_constants_version: '4.9',
  status: 'provisional_unverified',
  generated_at: '2026-09-25T00:00:00.000Z',
  script_version: 'revert-mac-mini-v48@1.0.0',
  input_observation_ids: [],
  excluded_observations: macRows.map((row) => ({
    observation_id: row.observation_id,
    reasons: row.exclusion_reasons.length ? row.exclusion_reasons : ['provisional_rollback_not_refit'],
  })),
  fit_parameters: {
    method: 'rollback_to_v4.5_risk_control_baseline',
    regularization_lambda: null,
    monotonic_constraint: true,
    fixed_r0: 100,
    floor: 5,
  },
  metrics: {
    training_weighted_mae: null,
    training_weighted_mape: null,
    validation_method: 'not_applicable_provisional_rollback',
    validation_weighted_mae: null,
    validation_weighted_mape: null,
  },
  old_curve: oldCurve,
  new_curve: structuredClone(curve),
  coverage: { generation_count: 0, observation_count: 0, age_span_days: 0 },
  limitations: [
    'v4.5 节点本身尚未通过统一首发价口径验证',
    '当前 Mac mini 合格观测未满足跨代际与年龄带覆盖门槛',
    '不得将该 manifest 解释为正式拟合通过',
  ],
};
constants['保值率校准清单'].records = [
  ...(constants['保值率校准清单'].records ?? []).filter((item) => item.id !== manifest.id),
  manifest,
];

writeFileSync(SOURCE, JSON.stringify(constants, null, 2) + '\n', 'utf8');
console.log('[revert-mac-mini-v48] Mac mini 18–48 month nodes restored to v4.5 provisional baseline');
console.log('[revert-mac-mini-v48] metadata.version=4.9, last_updated=2026-09-25');
console.log('[revert-mac-mini-v48] provisional manifest written');
