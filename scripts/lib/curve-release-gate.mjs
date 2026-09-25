import { validateObservationSchema } from './residual-observations.mjs';

const curveCategories = (constants) => Object.keys(constants['保值率曲线'] ?? {}).filter((key) => !key.startsWith('_'));
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);

export function changedCurveCategories(current, baseline) {
  const categories = new Set([...curveCategories(current), ...curveCategories(baseline)]);
  return [...categories].filter((category) => !sameJson(
    current['保值率曲线']?.[category],
    baseline['保值率曲线']?.[category],
  )).sort();
}

export function validateCalibrationManifest(manifest, category, current) {
  const errors = [];
  const required = [
    'id', 'category', 'target_constants_version', 'status', 'generated_at', 'script_version',
    'input_observation_ids', 'excluded_observations', 'fit_parameters', 'metrics',
    'old_curve', 'new_curve', 'coverage',
  ];
  for (const field of required) {
    if (!hasOwn(manifest, field)) errors.push(`${category}: manifest missing ${field}`);
  }
  if (manifest?.category !== category) errors.push(`${category}: manifest category mismatch`);
  if (manifest?.target_constants_version !== current.metadata?.version) {
    errors.push(`${category}: manifest target_constants_version must equal ${current.metadata?.version}`);
  }
  if (!Array.isArray(manifest?.input_observation_ids)) errors.push(`${category}: input_observation_ids must be array`);
  if (!Array.isArray(manifest?.excluded_observations)) errors.push(`${category}: excluded_observations must be array`);
  for (const excluded of manifest?.excluded_observations ?? []) {
    if (!excluded?.observation_id || !Array.isArray(excluded?.reasons) || excluded.reasons.length === 0) {
      errors.push(`${category}: every excluded observation needs id and reasons`);
    }
  }
  for (const metric of ['training_weighted_mae', 'training_weighted_mape', 'validation_method', 'validation_weighted_mae', 'validation_weighted_mape']) {
    if (!hasOwn(manifest?.metrics, metric)) errors.push(`${category}: metrics missing ${metric}`);
  }
  for (const field of ['generation_count', 'observation_count', 'age_span_days']) {
    if (!hasOwn(manifest?.coverage, field)) errors.push(`${category}: coverage missing ${field}`);
  }
  if (!sameJson(manifest?.new_curve, current['保值率曲线']?.[category])) {
    errors.push(`${category}: manifest new_curve does not match constants`);
  }
  return errors;
}

export function auditCurveRelease(current, baseline) {
  const schema = validateObservationSchema(current);
  const errors = schema.violations.map((violation) => `observation schema: ${violation}`);
  const changedCategories = changedCurveCategories(current, baseline);
  const manifests = current['保值率校准清单']?.records ?? [];

  for (const category of changedCategories) {
    const candidates = manifests.filter((manifest) => (
      manifest.category === category && manifest.target_constants_version === current.metadata?.version
    ));
    const manifest = candidates.at(-1);
    if (!manifest) errors.push(`${category}: curve changed but matching calibration manifest is missing`);
    else errors.push(...validateCalibrationManifest(manifest, category, current));
  }

  return {
    ok: errors.length === 0,
    mode: changedCategories.length === 0 ? 'market_snapshot_fast_path' : 'full_curve_validation',
    changed_categories: changedCategories,
    observation_count: schema.rows.length,
    eligible_observation_count: schema.rows.filter((row) => row.calibration_eligible).length,
    errors,
  };
}
