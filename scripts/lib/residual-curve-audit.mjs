import { normalizeObservationData } from './residual-observations.mjs';

export const AUDIT_STATUSES = new Set([
  'invalid_calibration_applied',
  'invalid_evaluation_only',
  'provenance_missing',
  'verified',
]);

export function buildResidualCurveAudit(constants) {
  const curves = constants['保值率曲线'] ?? {};
  const observations = constants['二手价格观测']?.records ?? [];
  const normalized = normalizeObservationData(constants).rows;
  const metadataText = JSON.stringify(constants.metadata ?? {});
  const categories = Object.keys(curves).filter((category) => !category.startsWith('_')).sort();

  const records = categories.map((category) => {
    const raw = observations.filter((observation) => observation.category === category);
    const derived = normalized.filter((observation) => observation.category === category);
    const denominatorSources = raw.reduce((summary, observation) => {
      const source = observation.legacy_trace?.denominator_source ?? (observation.launch_price_id ? '结构化首发价' : '缺失');
      summary[source] = (summary[source] ?? 0) + 1;
      return summary;
    }, {});
    const historyMentions = [...metadataText.matchAll(new RegExp(category.replace('_', '[ _]'), 'gi'))].length;
    const curveMeta = Object.fromEntries(Object.entries(curves[category] ?? {}).filter(([key]) => key.startsWith('_')));

    let status;
    let evidence;
    let recommendedAction;
    if (category === 'Mac_mini') {
      status = 'invalid_calibration_applied';
      evidence = [
        'metadata.v4.8_变更摘要明确记录以九个“二手价/6999 当前新品价”点计算 MAE 并修改 18–48 月节点',
        `旧报告观测 ${raw.length} 条；旧分母来源 ${JSON.stringify(denominatorSources)}`,
        `结构化后可校准 ${derived.filter((row) => row.calibration_eligible).length} 条；M6 官宣窗口样本已排除`,
      ];
      recommendedAction = '撤销 v4.8 中期节点，恢复 v4.5 临时基线并保持 provisional；待跨代际/年龄带门槛满足后再重拟合。';
    } else if (raw.length > 0) {
      status = 'invalid_evaluation_only';
      evidence = [
        `旧报告包含 ${raw.length} 条观测，分母来源 ${JSON.stringify(denominatorSources)}`,
        `没有证据表明该品类曲线曾依据这些错误口径观测被改写；metadata 命中 ${historyMentions} 处仅作人工复核线索`,
        `结构化首发价链接 ${raw.filter((item) => item.launch_price_id).length} 条，可校准 ${derived.filter((row) => row.calibration_eligible).length} 条`,
      ];
      recommendedAction = '保留现有节点；旧报告偏差/MAE 作废，仅用结构化首发价观测做只读验证，数据门槛满足前不得重拟合。';
    } else {
      status = 'provenance_missing';
      evidence = [
        '现有 70 点迁移库没有该品类观测',
        `曲线元数据字段：${Object.keys(curveMeta).join(', ') || '无'}`,
        `metadata 文本品类命中 ${historyMentions} 处，未形成可重建校准 manifest`,
      ];
      recommendedAction = '保留现有节点并标记未验证；补齐来源、首发价与跨时点观测后再评估。';
    }

    return {
      category,
      status,
      curve_source_metadata: curveMeta,
      observation_count: raw.length,
      eligible_observation_count: derived.filter((row) => row.calibration_eligible).length,
      denominator_source_distribution: denominatorSources,
      calibration_history_mentions: historyMentions,
      evidence,
      recommended_action: recommendedAction,
    };
  });

  return {
    schema_version: '1.0',
    constants_version: constants.metadata?.version,
    constants_last_updated: constants.metadata?.last_updated,
    category_count: records.length,
    records,
  };
}

export function auditToMarkdown(audit) {
  const lines = [
    '# 残值曲线全品类审计',
    '',
    `- constants 版本：${audit.constants_version}`,
    `- 数据日期：${audit.constants_last_updated}`,
    `- 覆盖品类：${audit.category_count}`,
    '',
    '| 品类 | 状态 | 观测 | 可校准 | 建议动作 |',
    '|---|---|---:|---:|---|',
  ];
  for (const record of audit.records) {
    lines.push(`| ${record.category} | ${record.status} | ${record.observation_count} | ${record.eligible_observation_count} | ${record.recommended_action} |`);
  }
  lines.push('', '## 证据', '');
  for (const record of audit.records) {
    lines.push(`### ${record.category}`, '', ...record.evidence.map((item) => `- ${item}`), '');
  }
  return lines.join('\n') + '\n';
}
