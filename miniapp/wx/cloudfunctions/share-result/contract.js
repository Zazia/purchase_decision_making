'use strict';
const CONSENT_VERSION = 'share-price-analysis-v1';
const fail = () => { throw new Error('invalid_payload'); };
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const unknown = Object.keys(value).filter(k => !keys.includes(k));
  if (unknown.length) {
    const error = new Error('invalid_payload');
    error.invalidFields = unknown.slice(0, 10).map(k => k.slice(0, 80));
    throw error;
  }
}
function text(value, max, optional = false) {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) fail();
}
function number(value, min = 0, inclusive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (inclusive ? value < min : value <= min)) fail();
}
function enumeration(value, values, optional = false) {
  if (!(optional && value === undefined) && !values.includes(value)) fail();
}
function params(p) {
  object(p, ['category', 'budget', 'buyTiming', 'performanceFloor', 'holdingYears']);
  enumeration(p.category, ['mac-mini', 'macbook-air', 'macbook-pro', 'iphone', 'ipad', 'imac']);
  enumeration(p.buyTiming, ['new', 'used', 'both']);
  number(p.budget); number(p.performanceFloor, 0, true);
  if (p.performanceFloor > 1 || !Array.isArray(p.holdingYears) || !p.holdingYears.length || p.holdingYears.length > 100) fail();
  p.holdingYears.forEach(y => number(y));
}
const planKeys = ['model', 'chip', 'buyTiming', 'holdingYears', 'monthlyCost', 'avgPerformance', 'buyPrice',
  'residual', 'maintenanceCost', 'holdingMonths', 'performanceS0', 'performanceSN', 'candidateType', 'waitMonths',
  'predictedPrice', 'systemSupportRisk', 'systemSupportExceedMonths', 'memoryGb', 'storageGb', 'channel', 'useSubsidy',
  'sourceId', 'source', 'rowId', 'editedBuyPrice', 'excluded', 'deferred', '_copyKey'];
function plan(p, sample = false) {
  object(p, sample ? ['model', 'chip', 'buyTiming', 'holdingYears', 'buyPrice', 'memoryGb', 'storageGb',
    'channel', 'useSubsidy', 'sourceId', 'source', 'predictedPrice'] : planKeys);
  text(p.model, 160); text(p.channel, 80, true);
  if (typeof p.chip !== 'string' || p.chip.length > 80 || /[\x00-\x1f]/.test(p.chip)) fail();
  for (const k of ['sourceId', 'rowId', '_copyKey']) text(p[k], 160, true);
  enumeration(p.buyTiming, ['new', 'used']);
  number(p.buyPrice); number(p.holdingYears);
  for (const k of ['memoryGb', 'storageGb', 'editedBuyPrice']) if (p[k] !== undefined) number(p[k]);
  for (const k of ['monthlyCost', 'avgPerformance', 'residual', 'maintenanceCost', 'holdingMonths', 'performanceS0',
    'performanceSN', 'waitMonths', 'systemSupportExceedMonths']) {
    if (p[k] !== undefined && (typeof p[k] !== 'number' || !Number.isFinite(p[k]))) fail();
  }
  for (const k of ['predictedPrice', 'useSubsidy', 'excluded', 'deferred']) {
    if (p[k] !== undefined && typeof p[k] !== 'boolean') fail();
  }
  enumeration(p.candidateType, ['A', 'B', 'C'], true);
  enumeration(p.systemSupportRisk, ['normal', 'near-end', 'exceeded'], true);
  enumeration(p.source, ['original', 'edited', 'custom'], !sample);
  if (sample && (!['edited', 'custom'].includes(p.source) || p.predictedPrice !== false || !p.sourceId)) fail();
}
function plans(value, limit, sample = false) {
  if (!Array.isArray(value) || value.length > limit) fail();
  value.forEach(p => plan(p, sample));
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function validate(event) {
  object(event, ['action', 'schemaVersion', 'submissionId', 'params', 'reportData', 'submittedPlans', 'originalPlans', 'consentVersion', 'isTest']);
  if (event.schemaVersion !== 2 || event.consentVersion !== CONSENT_VERSION || event.action !== 'save') fail();
  text(event.submissionId, 64);
  if (event.isTest !== undefined && typeof event.isTest !== 'boolean') fail();
  if (Buffer.byteLength(JSON.stringify(event), 'utf8') > 200 * 1024) throw new Error('payload_too_large');
  params(event.params);
  const report = event.reportData;
  object(report, ['params', 'frontier', 'dominated', 'recommendationRange', 'performanceFloor', 'budget', 'isUserModified']);
  if (report.isUserModified !== undefined && typeof report.isUserModified !== 'boolean') fail();
  params(report.params);
  if (canonical(report.params) !== canonical(event.params) || report.budget !== event.params.budget
    || report.performanceFloor !== event.params.performanceFloor) fail();
  plans(report.frontier, 2000); plans(report.dominated, 2000);
  if (report.recommendationRange !== null) {
    const range = report.recommendationRange;
    object(range, ['lowerCost', 'upperCost', 'plans']);
    for (const k of ['lowerCost', 'upperCost']) if (typeof range[k] !== 'number' || !Number.isFinite(range[k])) fail();
    plans(range.plans, 2000);
  }
  plans(event.submittedPlans, 200, true); plans(event.originalPlans, 200);
  const { action, ...payload } = event;
  return JSON.parse(JSON.stringify(payload));
}
module.exports = { CONSENT_VERSION, canonical, validate };
