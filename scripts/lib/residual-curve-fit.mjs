import { normalizeObservationData } from './residual-observations.mjs';

const PRICE_WEIGHTS = { transaction: 1, verified_paid: 1, listing: 0.55, trade_in: 0.35, reference: 0.2 };
const CONFIDENCE_WEIGHTS = { high: 1, medium: 0.7, low: 0.4 };

function daysBetween(left, right) {
  return Math.round((Date.parse(right) - Date.parse(left)) / 86400000);
}

function ageMonths(observedAt, releaseDate) {
  return daysBetween(releaseDate, observedAt) / 30.4375;
}

function curveKnots(curve) {
  return Object.keys(curve).filter((key) => /^\d+$/.test(key)).map(Number).sort((a, b) => a - b);
}

function interpolationWeights(knots, age) {
  if (age <= knots[0]) return [[0, 1]];
  if (age >= knots.at(-1)) return [[knots.length - 1, 1]];
  for (let index = 0; index < knots.length - 1; index += 1) {
    if (age <= knots[index + 1]) {
      const fraction = (age - knots[index]) / (knots[index + 1] - knots[index]);
      return [[index, 1 - fraction], [index + 1, fraction]];
    }
  }
  return [[knots.length - 1, 1]];
}

function projectMonotonic(logRates, logFloor) {
  logRates[0] = Math.log(100);
  for (let index = 1; index < logRates.length; index += 1) {
    logRates[index] = Math.min(logRates[index - 1], Math.max(logFloor, logRates[index]));
  }
}

function fitForLambda(samples, baselineCurve, lambda) {
  const knots = curveKnots(baselineCurve);
  const floor = baselineCurve._floor ?? 3;
  const x = knots.map((month) => Math.log(baselineCurve[month]));
  const rows = samples.map((sample) => ({
    ...sample,
    target: Math.log(sample.retention * 100),
    coefficients: interpolationWeights(knots, sample.age_months),
  }));
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0) || 1;
  const step = 0.04 / (totalWeight + lambda * 8 + 1);

  for (let iteration = 0; iteration < 5000; iteration += 1) {
    const gradient = Array(x.length).fill(0);
    for (const row of rows) {
      const prediction = row.coefficients.reduce((sum, [index, coefficient]) => sum + x[index] * coefficient, 0);
      const error = prediction - row.target;
      for (const [index, coefficient] of row.coefficients) gradient[index] += 2 * row.weight * error * coefficient;
    }
    for (let index = 1; index < x.length - 1; index += 1) {
      const leftSpan = knots[index] - knots[index - 1];
      const rightSpan = knots[index + 1] - knots[index];
      const second = (x[index + 1] - x[index]) / rightSpan - (x[index] - x[index - 1]) / leftSpan;
      gradient[index - 1] += 2 * lambda * second / leftSpan;
      gradient[index] += 2 * lambda * second * (-1 / rightSpan - 1 / leftSpan);
      gradient[index + 1] += 2 * lambda * second / rightSpan;
    }
    let maxMove = 0;
    for (let index = 1; index < x.length; index += 1) {
      const move = step * gradient[index];
      x[index] -= move;
      maxMove = Math.max(maxMove, Math.abs(move));
    }
    projectMonotonic(x, Math.log(floor));
    if (maxMove < 1e-10) break;
  }

  const curve = Object.fromEntries(knots.map((month, index) => [month, Number(Math.exp(x[index]).toFixed(4))]));
  curve._floor = floor;
  if (baselineCurve._half_life_months !== undefined) curve._half_life_months = baselineCurve._half_life_months;
  return curve;
}

export function rateAt(curve, age) {
  const knots = curveKnots(curve);
  if (age <= knots[0]) return curve[knots[0]];
  if (age >= knots.at(-1)) return curve[knots.at(-1)];
  const [[leftIndex, leftWeight], [rightIndex, rightWeight]] = interpolationWeights(knots, age);
  return Math.exp(Math.log(curve[knots[leftIndex]]) * leftWeight + Math.log(curve[knots[rightIndex]]) * rightWeight);
}

export function weightedMetrics(curve, samples) {
  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  if (!totalWeight) return { weighted_mae: null, weighted_mape: null };
  let absolute = 0;
  let percentage = 0;
  for (const sample of samples) {
    const observed = sample.retention * 100;
    const error = Math.abs(rateAt(curve, sample.age_months) - observed);
    absolute += sample.weight * error;
    percentage += sample.weight * error / observed;
  }
  return {
    weighted_mae: absolute / totalWeight,
    weighted_mape: percentage / totalWeight,
  };
}

export function prepareCalibrationSamples(constants, category) {
  const catalog = constants['首发价目录']?.records ?? {};
  const raw = constants['二手价格观测']?.records ?? [];
  const normalized = normalizeObservationData(constants).rows;
  const rawById = new Map(raw.map((observation) => [observation.id, observation]));
  const timeCounts = new Map();
  for (const observation of raw.filter((item) => item.category === category)) {
    const key = `${observation.model_key}/${observation.observed_at}`;
    timeCounts.set(key, (timeCounts.get(key) ?? 0) + 1);
  }

  const accepted = [];
  const validationOnly = [];
  const excluded = [];
  for (const row of normalized.filter((item) => item.category === category)) {
    const observation = rawById.get(row.observation_id);
    const launch = catalog[row.launch_price_id];
    const reasons = [...row.exclusion_reasons];
    if (!launch?.release_date) reasons.push('release_date_missing');
    const role = launch?.configuration_role ?? 'base';
    if (role !== 'base') {
      const paired = raw.some((candidate) => candidate.category === category
        && candidate.generation === observation.generation
        && candidate.configuration_role === 'base'
        && Math.abs(daysBetween(candidate.observed_at, observation.observed_at)) <= 90);
      if (!paired) reasons.push('unpaired_non_base_configuration');
    }
    if (observation.event_state !== 'normal' && !reasons.includes('event_state_excluded')) reasons.push('event_state_excluded');

    if (reasons.length > 0 || row.retention_observed === null) {
      const target = reasons.includes('unpaired_non_base_configuration') ? validationOnly : excluded;
      target.push({ observation_id: row.observation_id, reasons: [...new Set(reasons)] });
      continue;
    }

    const stabilityCount = [...timeCounts.keys()].filter((key) => key.startsWith(`${observation.model_key}/`)).length;
    const weight = (PRICE_WEIGHTS[observation.price_type] ?? 0)
      * (CONFIDENCE_WEIGHTS[observation.confidence] ?? 0)
      * Math.min(1.5, Math.sqrt(observation.sample_size) / Math.sqrt(3))
      * (stabilityCount >= 2 ? 1.2 : 1);
    accepted.push({
      observation_id: row.observation_id,
      generation: observation.generation,
      observed_at: observation.observed_at,
      age_months: ageMonths(observation.observed_at, launch.release_date),
      retention: row.retention_observed,
      weight,
      price_type: observation.price_type,
      confidence: observation.confidence,
    });
  }
  return { accepted, validationOnly, excluded };
}

function crossValidationGroups(samples) {
  const generations = [...new Set(samples.map((sample) => sample.generation))];
  if (generations.length >= 2) return { method: 'leave_one_generation_out', groups: generations, key: 'generation', provisional: false };
  const dates = [...new Set(samples.map((sample) => sample.observed_at))].sort();
  const span = dates.length >= 2 ? daysBetween(dates[0], dates.at(-1)) : 0;
  if (dates.length >= 3 && span >= 90) return { method: 'leave_one_timepoint_out', groups: dates, key: 'observed_at', provisional: true };
  return { method: 'insufficient', groups: [], key: null, provisional: true };
}

export function fitResidualCurve(samples, baselineCurve, options = {}) {
  const lambdas = options.lambdas ?? [0, 0.1, 1, 10];
  const cv = crossValidationGroups(samples);
  const scores = [];
  for (const lambda of lambdas) {
    const folds = [];
    for (const group of cv.groups) {
      const training = samples.filter((sample) => sample[cv.key] !== group);
      const validation = samples.filter((sample) => sample[cv.key] === group);
      if (!training.length || !validation.length) continue;
      const curve = fitForLambda(training, baselineCurve, lambda);
      folds.push(weightedMetrics(curve, validation));
    }
    const valid = folds.filter((fold) => fold.weighted_mae !== null);
    scores.push({
      lambda,
      validation_weighted_mae: valid.length ? valid.reduce((sum, fold) => sum + fold.weighted_mae, 0) / valid.length : null,
      validation_weighted_mape: valid.length ? valid.reduce((sum, fold) => sum + fold.weighted_mape, 0) / valid.length : null,
    });
  }
  const comparable = scores.filter((score) => score.validation_weighted_mae !== null);
  const selected = comparable.sort((left, right) => left.validation_weighted_mae - right.validation_weighted_mae)[0]
    ?? scores.find((score) => score.lambda === 1)
    ?? scores[0];
  const curve = fitForLambda(samples, baselineCurve, selected.lambda);
  const dates = [...new Set(samples.map((sample) => sample.observed_at))].sort();
  const generations = [...new Set(samples.map((sample) => sample.generation))];
  const hasPaid = samples.some((sample) => ['transaction', 'verified_paid'].includes(sample.price_type));
  const gaps = [];
  if (generations.length < 2 && !(dates.length >= 3 && daysBetween(dates[0], dates.at(-1)) >= 90)) gaps.push('insufficient_generation_or_timepoint_coverage');
  if (samples.length < 3) gaps.push('fewer_than_three_eligible_observations');
  if (!hasPaid) gaps.push('no_transaction_or_verified_paid_observation');
  if (cv.method === 'insufficient') gaps.push('cross_validation_unavailable');
  return {
    curve,
    lambda: selected.lambda,
    lambda_scores: scores,
    training_metrics: weightedMetrics(curve, samples),
    validation_metrics: {
      method: cv.method,
      weighted_mae: selected.validation_weighted_mae,
      weighted_mape: selected.validation_weighted_mape,
    },
    coverage: {
      generation_count: generations.length,
      observation_count: samples.length,
      timepoint_count: dates.length,
      age_span_days: dates.length >= 2 ? daysBetween(dates[0], dates.at(-1)) : 0,
    },
    provisional: cv.provisional,
    publishable: gaps.length === 0,
    gaps,
  };
}

export function buildCalibrationManifest({ category, version, baselineCurve, preparation, fit, scriptVersion = 'fit-residual-curve@1.0.0' }) {
  return {
    id: `${category.toLowerCase()}-${version}-fit`,
    category,
    target_constants_version: version,
    status: fit.publishable ? (fit.provisional ? 'provisional' : 'verified') : 'insufficient_data',
    generated_at: new Date().toISOString(),
    script_version: scriptVersion,
    input_observation_ids: preparation.accepted.map((sample) => sample.observation_id),
    excluded_observations: [...preparation.excluded, ...preparation.validationOnly],
    fit_parameters: { method: 'weighted_monotonic_log_nodes', regularization_lambda: fit.lambda, fixed_r0: 100, floor: baselineCurve._floor },
    metrics: {
      training_weighted_mae: fit.training_metrics.weighted_mae,
      training_weighted_mape: fit.training_metrics.weighted_mape,
      validation_method: fit.validation_metrics.method,
      validation_weighted_mae: fit.validation_metrics.weighted_mae,
      validation_weighted_mape: fit.validation_metrics.weighted_mape,
    },
    old_curve: baselineCurve,
    new_curve: fit.curve,
    coverage: fit.coverage,
    gaps: fit.gaps,
  };
}
