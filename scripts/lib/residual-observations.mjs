export const PRICE_TYPES = new Set(['transaction', 'verified_paid', 'listing', 'trade_in', 'reference']);
export const CONDITIONS = new Set(['new', 'like_new', 'excellent', 'good', 'fair', 'mixed', 'unknown']);
export const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);
export const EVENT_STATES = new Set(['normal', 'launch_window', 'official_repricing', 'shortage_or_bubble']);
export const VERIFICATION_STATES = new Set(['verified', 'provisional', 'unverified', 'rejected']);

const finitePositive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const sameOptional = (left, right) => (left ?? null) === (right ?? null);

export function sameConfiguration(observation, launchPrice) {
  return observation.category === launchPrice.category
    && observation.generation === launchPrice.generation
    && observation.model_key === launchPrice.model_key
    && sameOptional(observation.configuration?.size, launchPrice.configuration?.size)
    && sameOptional(observation.configuration?.chip_tier, launchPrice.configuration?.chip_tier)
    && sameOptional(observation.configuration?.memory_gb, launchPrice.configuration?.memory_gb)
    && sameOptional(observation.configuration?.storage_gb, launchPrice.configuration?.storage_gb);
}

export function validateLaunchPrice(id, record) {
  const violations = [];
  const requiredStrings = ['category', 'generation', 'model_key', 'region', 'currency', 'release_date', 'source_url', 'verification_status'];
  for (const field of requiredStrings) {
    if (typeof record?.[field] !== 'string' || record[field].length === 0) violations.push(`${id}.${field}: missing`);
  }
  if (record?.id !== id) violations.push(`${id}.id: must equal catalog key`);
  if (record?.price_kind !== 'launch_msrp') violations.push(`${id}.price_kind: must be launch_msrp`);
  if (!finitePositive(record?.launch_msrp)) violations.push(`${id}.launch_msrp: must be positive number`);
  if (!VERIFICATION_STATES.has(record?.verification_status)) violations.push(`${id}.verification_status: invalid`);
  if (!record?.configuration || typeof record.configuration !== 'object') violations.push(`${id}.configuration: missing`);
  return violations;
}

export function normalizeObservation(observation, launchCatalog) {
  const exclusionReasons = [];
  const launchPrice = observation.launch_price_id ? launchCatalog[observation.launch_price_id] : null;

  if (!finitePositive(observation.observed_price)) exclusionReasons.push('invalid_observed_price');
  if (!PRICE_TYPES.has(observation.price_type)) exclusionReasons.push('invalid_price_type');
  if (!CONDITIONS.has(observation.condition)) exclusionReasons.push('invalid_condition');
  if (!CONFIDENCE_LEVELS.has(observation.confidence)) exclusionReasons.push('invalid_confidence');
  if (!EVENT_STATES.has(observation.event_state)) exclusionReasons.push('invalid_event_state');
  if (!Number.isInteger(observation.sample_size) || observation.sample_size < 1) exclusionReasons.push('invalid_sample_size');
  if (!launchPrice) exclusionReasons.push('launch_price_missing');
  if (launchPrice) {
    if (launchPrice.price_kind !== 'launch_msrp') exclusionReasons.push('launch_price_not_official_launch_msrp');
    if (launchPrice.verification_status !== 'verified') exclusionReasons.push('launch_price_unverified');
    if (observation.region !== launchPrice.region) exclusionReasons.push('region_mismatch');
    if (observation.currency !== launchPrice.currency) exclusionReasons.push('currency_mismatch');
    if (!sameConfiguration(observation, launchPrice)) exclusionReasons.push('configuration_mismatch');
  }

  if (observation.calibration_eligible !== true) exclusionReasons.push('marked_ineligible');
  if (observation.event_state !== 'normal') exclusionReasons.push('event_state_excluded');

  const launchEligible = launchPrice
    && !exclusionReasons.some((reason) => [
      'launch_price_not_official_launch_msrp', 'launch_price_unverified', 'region_mismatch',
      'currency_mismatch', 'configuration_mismatch', 'launch_price_missing', 'invalid_observed_price',
    ].includes(reason));

  return {
    observation_id: observation.id,
    category: observation.category,
    generation: observation.generation,
    model_key: observation.model_key,
    observed_at: observation.observed_at,
    observed_price: observation.observed_price,
    price_type: observation.price_type,
    condition: observation.condition,
    sample_size: observation.sample_size,
    confidence: observation.confidence,
    event_state: observation.event_state,
    launch_price_id: observation.launch_price_id ?? null,
    launch_msrp: launchPrice?.launch_msrp ?? null,
    retention_observed: launchEligible ? observation.observed_price / launchPrice.launch_msrp : null,
    current_new_same_tier_price: finitePositive(observation.current_new_same_tier_price)
      ? observation.current_new_same_tier_price : null,
    replacement_value_ratio: finitePositive(observation.current_new_same_tier_price)
      ? observation.observed_price / observation.current_new_same_tier_price : null,
    actual_paid_price: finitePositive(observation.actual_paid_price) ? observation.actual_paid_price : null,
    owner_value_ratio: finitePositive(observation.actual_paid_price)
      ? observation.observed_price / observation.actual_paid_price : null,
    calibration_eligible: exclusionReasons.length === 0,
    exclusion_reasons: [...new Set(exclusionReasons)],
    source_url: observation.source_url,
  };
}

export function normalizeObservationData(constants) {
  const launchCatalog = constants['首发价目录']?.records ?? {};
  const observations = constants['二手价格观测']?.records ?? [];
  const violations = [];
  const seen = new Set();

  for (const [id, record] of Object.entries(launchCatalog)) {
    violations.push(...validateLaunchPrice(id, record));
  }

  const rows = observations.map((observation, index) => {
    if (typeof observation?.id !== 'string' || observation.id.length === 0) violations.push(`observations[${index}].id: missing`);
    else if (seen.has(observation.id)) violations.push(`observations[${index}].id: duplicate ${observation.id}`);
    else seen.add(observation.id);
    return normalizeObservation(observation, launchCatalog);
  });

  return { rows, violations };
}

export function validateObservationSchema(constants) {
  const result = normalizeObservationData(constants);
  const violations = [...result.violations];
  const observations = constants['二手价格观测']?.records ?? [];
  const normalizedById = new Map(result.rows.map((row) => [row.observation_id, row]));

  observations.forEach((observation, index) => {
    const path = `二手价格观测.records[${index}]`;
    const row = normalizedById.get(observation.id);
    if (observation.calibration_eligible === true && row && !row.calibration_eligible) {
      violations.push(`${path} (${observation.id}): calibration_eligible=true but ${row.exclusion_reasons.join(',')}`);
    }
    for (const field of ['calibration_denominator', 'calibration_denominator_type', 'denominator_from_notes']) {
      if (observation[field] !== undefined) violations.push(`${path}.${field}: forbidden executable denominator field`);
    }
  });

  const manifests = constants['保值率校准清单']?.records ?? [];
  for (const manifest of manifests) {
    for (const observationId of manifest.input_observation_ids ?? []) {
      const row = normalizedById.get(observationId);
      if (!row) violations.push(`保值率校准清单.${manifest.id}.input_observation_ids: unknown ${observationId}`);
      else if (!row.calibration_eligible) violations.push(`保值率校准清单.${manifest.id}: ineligible input ${observationId}`);
    }
  }
  return { ...result, violations };
}

export function rowsToCsv(rows) {
  const columns = [
    'observation_id', 'category', 'generation', 'model_key', 'observed_at', 'observed_price',
    'price_type', 'condition', 'sample_size', 'confidence', 'event_state', 'launch_price_id',
    'launch_msrp', 'retention_observed', 'current_new_same_tier_price', 'replacement_value_ratio',
    'actual_paid_price', 'owner_value_ratio', 'calibration_eligible', 'exclusion_reasons', 'source_url',
  ];
  const escape = (value) => {
    const text = Array.isArray(value) ? value.join('|') : (value ?? '').toString();
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(','), ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\n') + '\n';
}
