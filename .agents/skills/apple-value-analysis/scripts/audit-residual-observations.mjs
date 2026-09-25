import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const constantsPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(skillDir, 'constants.json');
if (!fs.existsSync(constantsPath)) {
  console.error(`constants.json 不存在：${constantsPath}`);
  process.exit(2);
}

const constants = JSON.parse(fs.readFileSync(constantsPath, 'utf8'));
const catalog = constants['首发价目录']?.records ?? {};
const observations = constants['二手价格观测']?.records ?? [];
const errors = [];
const reasons = {};
let launchLinked = 0;
let eligible = 0;
let replacementRatios = 0;
let ownerRatios = 0;

const same = (left, right) => (left ?? null) === (right ?? null);
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const addReason = (reason) => { reasons[reason] = (reasons[reason] ?? 0) + 1; };

for (const observation of observations) {
  const launch = observation.launch_price_id ? catalog[observation.launch_price_id] : null;
  const exclusions = [];
  if (!positive(observation.observed_price)) exclusions.push('invalid_observed_price');
  if (!launch) exclusions.push('launch_price_missing');
  if (launch) {
    launchLinked += 1;
    if (launch.price_kind !== 'launch_msrp') exclusions.push('launch_price_not_official_launch_msrp');
    if (launch.verification_status !== 'verified') exclusions.push('launch_price_unverified');
    if (observation.category !== launch.category || observation.generation !== launch.generation
      || observation.model_key !== launch.model_key || observation.region !== launch.region
      || observation.currency !== launch.currency) exclusions.push('identity_mismatch');
    for (const field of ['size', 'chip_tier', 'memory_gb', 'storage_gb']) {
      if (!same(observation.configuration?.[field], launch.configuration?.[field])) {
        exclusions.push(`configuration_mismatch:${field}`);
      }
    }
  }
  if (observation.calibration_eligible !== true) exclusions.push('marked_ineligible');
  if (observation.event_state !== 'normal') exclusions.push('event_state_excluded');
  if (positive(observation.current_new_same_tier_price)) replacementRatios += 1;
  if (positive(observation.actual_paid_price)) ownerRatios += 1;
  for (const forbidden of ['calibration_denominator', 'calibration_denominator_type', 'denominator_from_notes']) {
    if (forbidden in observation) errors.push(`${observation.id}: 禁止字段 ${forbidden}`);
  }
  if (observation.calibration_eligible === true && exclusions.length > 0) {
    errors.push(`${observation.id}: 标记可校准但存在 ${[...new Set(exclusions)].join(', ')}`);
  }
  if (exclusions.length === 0) eligible += 1;
  [...new Set(exclusions)].forEach(addReason);
}

console.log(JSON.stringify({
  constants_version: constants.metadata?.version,
  observation_count: observations.length,
  launch_linked_count: launchLinked,
  calibration_eligible_count: eligible,
  replacement_value_ratio_count: replacementRatios,
  owner_value_ratio_count: ownerRatios,
  exclusion_reason_counts: reasons,
  errors,
}, null, 2));

if (errors.length > 0) process.exit(1);
