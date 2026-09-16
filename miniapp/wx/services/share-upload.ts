import type { ReportData } from './saved-results';
import type { EditorSnapshot } from './scheme-editor-state';

export const CONSENT_VERSION = 'share-price-analysis-v1';
export interface UploadContext {
  submittedPlans: Array<Record<string, any>>;
  originalPlans: Array<Record<string, any>>;
}
export interface UploadState {
  fingerprint: string;
  submissionId: string;
  consentVersion?: string;
  cloudId?: string;
  expireAt?: number;
}
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const modelKey = (p: any) => JSON.stringify([
  p.model.replace(/\s*×\s*\d+(\.\d+)?\s*年\s*$/, ''), p.chip, p.buyTiming,
  p.memoryGb ?? null, p.storageGb ?? null, p.holdingYears,
]);

/** 在重算开始时捕获输入，成功后与该结果一起保存；不读取后续编辑态。 */
export function captureUploadContext(snapshot: EditorSnapshot, originals: any[]): UploadContext {
  const submittedPlans: UploadContext['submittedPlans'] = [];
  const originalPlans: UploadContext['originalPlans'] = [];
  for (const point of snapshot.points) {
    if (point.excluded || point.deferred || snapshot.deferredRowIds.includes(point.rowId)) continue;
    const explicit = point.editedBuyPrice !== undefined || point.source === 'custom';
    if (!explicit) continue;
    const price = point.editedBuyPrice ?? point.buyPrice;
    if (!Number.isFinite(price) || price <= 0) throw new Error('输入价格必须为有限正数');
    const p: Record<string, any> = {};
    for (const key of ['model', 'chip', 'buyTiming', 'holdingYears', 'memoryGb', 'storageGb', 'channel', 'useSubsidy']) {
      if ((point as any)[key] !== undefined) p[key] = (point as any)[key];
    }
    p.buyPrice = price;
    p.source = point.source === 'custom' ? 'custom' : 'edited';
    p.predictedPrice = false;
    p.sourceId = point.rowId;
    submittedPlans.push(p);
    const original = point.source !== 'custom' && originals.find(o => modelKey(o) === modelKey(point));
    if (original) originalPlans.push({ ...clone(original), sourceId: point.rowId });
  }
  return clone({ submittedPlans, originalPlans });
}

function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

export function buildUploadContent(reportData: ReportData, context?: UploadContext | null, isTest = false) {
  return clone({ schemaVersion: 2, params: reportData.params, reportData,
    submittedPlans: context?.submittedPlans ?? [], originalPlans: context?.originalPlans ?? [], isTest });
}

/** 完整规范化内容作为精确指纹，避免短哈希碰撞复用同意。 */
export function prepareUpload(content: ReturnType<typeof buildUploadContent>, prior?: UploadState | null): UploadState {
  const fingerprint = canonical(content);
  if (prior?.fingerprint === fingerprint && (!prior.expireAt || prior.expireAt > Date.now())) return clone(prior);
  return { fingerprint, submissionId: `s-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` };
}

export function uploadRequest(content: ReturnType<typeof buildUploadContent>, state: UploadState) {
  if (state.consentVersion !== CONSENT_VERSION) throw new Error('请确认上传用途');
  const p = content.params;
  if (!Number.isFinite(p.budget) || p.budget <= 0 || !Number.isFinite(p.performanceFloor)
    || p.performanceFloor < 0 || p.performanceFloor > 1 || !['new', 'used', 'both'].includes(p.buyTiming)
    || !p.holdingYears.length || p.holdingYears.some(y => !Number.isFinite(y) || y <= 0)) {
    throw new Error('方案参数无效，仅本地保存');
  }
  for (const plan of [...content.submittedPlans, ...content.originalPlans, ...content.reportData.frontier, ...content.reportData.dominated]) {
    if (!Number.isFinite(plan.buyPrice) || plan.buyPrice <= 0 || !Number.isFinite(plan.holdingYears) || plan.holdingYears <= 0
      || !['new', 'used'].includes(plan.buyTiming) || typeof plan.model !== 'string' || !plan.model || plan.model.length > 160) {
      throw new Error('方案价格或字段无效，仅本地保存');
    }
  }
  const request = { action: 'save', ...content, submissionId: state.submissionId, consentVersion: state.consentVersion };
  if (content.submittedPlans.length > 200 || content.originalPlans.length > 200
    || unescape(encodeURIComponent(JSON.stringify(request))).length > 200 * 1024) {
    throw new Error('方案超过上传上限，仅本地保存');
  }
  return request;
}
