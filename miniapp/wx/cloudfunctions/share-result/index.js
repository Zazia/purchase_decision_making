// cloudfunctions/share-result/index.js
// 分享结果云函数: 云端 ID 模式
//   - save:   v2一次保存分享和分析快照，幂等返回_id；兼容旧params-only请求
//   - get:    返回公开结果快照；v2过期只失效不删除，旧记录保留懒清理
//   - qrcode: 调 cloud.openapi.wxacode.getUnlimited 生成小程序码, scene=id, page=pages/result/result
//
// 云函数以小程序身份代写云数据库, 用户无需登录授权
// 集合必须仅管理端读写，客户端通过本云函数受限访问完整分析记录

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { validate, canonical } = require('./contract');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/** 30 天后过期 (ms) */
const EXPIRE_MS = 30 * 24 * 60 * 60 * 1000;
/** shared_results 集合名 */
const COLLECTION = 'shared_results';
/** 落地页 */
const LANDING_PAGE = 'pages/result/result';

exports.main = async (event) => {
  const { action } = event || {};
  try {
    if (action === 'save') return event.schemaVersion === undefined ? await saveRecord(event.params) : await saveV2(event);
    if (action === 'get') return await getRecord(event.id);
    if (action === 'qrcode') return await getQrcode(event.id);
    return { ok: false, error: 'unknown action' };
  } catch (err) {
    return { ok: false, error: ['invalid_payload', 'payload_too_large'].includes(err.message) ? err.message : 'internal',
      ...(err.message === 'invalid_payload' && err.invalidFields ? { invalidFields: err.invalidFields } : {}) };
  }
};

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function saveV2(event) {
  // 平台调用信封字段不属于业务数据，也不作为可信身份来源。
  const { userInfo, tcbContext, ...businessEvent } = event;
  const payload = validate(businessEvent);
  const openid = cloud.getWXContext().OPENID;
  if (typeof openid !== 'string' || !openid) return { ok: false, error: 'missing_identity' };
  const anonId = hash('share-result-v2:' + openid);
  const id = hash(anonId + ':' + payload.submissionId).slice(0, 32);
  const payloadHash = hash(canonical(payload));
  const now = Date.now();
  const data = { ...payload, _id: id, anonId, payloadHash, createdAt: now, consentAt: now, expireAt: now + EXPIRE_MS };
  // add 携带确定性 _id，数据库唯一约束原子拒绝重复，绝不 set 覆盖。
  try {
    await db.collection(COLLECTION).add({ data });
    return { ok: true, id, expireAt: data.expireAt };
  } catch (error) {
    let existing;
    try { existing = (await db.collection(COLLECTION).doc(id).get()).data; } catch { throw error; }
    if (!existing) throw error;
    if (existing.payloadHash !== payloadHash) return { ok: false, error: 'conflict' };
    if (existing.expireAt <= now) return { ok: false, error: 'expired' };
    return { ok: true, id, expireAt: existing.expireAt };
  }
}

/**
 * 写入 params, 返回 _id
 * @param {object} params DecisionParams
 */
async function saveRecord(params) {
  if (!params || !params.category || typeof params.budget !== 'number') {
    return { ok: false, error: 'invalid params' };
  }
  const now = Date.now();
  const expireAt = now + EXPIRE_MS;
  const res = await db.collection(COLLECTION).add({
    data: { params, createdAt: now, expireAt },
  });
  return { ok: true, id: res._id };
}

/**
 * 读 params (扫码进 result 时调用)
 * v2过期保留分析记录；旧记录懒清理；均返回expired
 * @param {string} id 云端 _id
 */
async function getRecord(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(id)) return { ok: false, error: 'invalid id' };

  let doc;
  try {
    const res = await db.collection(COLLECTION).doc(id).get();
    doc = res.data;
  } catch (err) {
    // 不存在 / 已被清理
    return { ok: false, error: 'not_found' };
  }

  if (!doc) return { ok: false, error: 'not_found' };

  // 过期懒清理
  if (doc.expireAt && doc.expireAt < Date.now()) {
    try {
      if (doc.schemaVersion !== 2) await db.collection(COLLECTION).doc(id).remove();
    } catch (e) {
      // 删除失败不阻断, 仍返回 expired
    }
    return { ok: false, error: 'expired' };
  }

  if (doc.schemaVersion === 2) {
    if (!doc.reportData || !Array.isArray(doc.reportData.frontier) || !Array.isArray(doc.reportData.dominated)) {
      return { ok: false, error: 'missing_snapshot' };
    }
    return { ok: true, params: doc.params, createdAt: doc.createdAt, schemaVersion: 2,
      reportData: publicReport(doc) };
  }
  return { ok: true, params: doc.params, createdAt: doc.createdAt };
}

/** 公开展示快照，绝不返回完整数据库记录或编辑/分析元数据。 */
function publicReport(doc) {
  const report = doc.reportData;
  const keys = ['model', 'chip', 'buyTiming', 'holdingYears', 'monthlyCost', 'avgPerformance', 'buyPrice',
    'residual', 'maintenanceCost', 'holdingMonths', 'performanceS0', 'performanceSN', 'candidateType',
    'waitMonths', 'predictedPrice', 'systemSupportRisk', 'systemSupportExceedMonths', 'memoryGb', 'storageGb', 'channel', 'useSubsidy'];
  const plans = items => items.map(p => Object.fromEntries(keys.filter(k => p[k] !== undefined).map(k => [k, p[k]])));
  return { params: doc.params, budget: report.budget, performanceFloor: report.performanceFloor,
    frontier: plans(report.frontier), dominated: plans(report.dominated),
    recommendationRange: report.recommendationRange ? { lowerCost: report.recommendationRange.lowerCost,
      upperCost: report.recommendationRange.upperCost, plans: plans(report.recommendationRange.plans) } : null,
    isUserModified: report.isUserModified === true || (report.isUserModified === undefined && (doc.submittedPlans || []).length > 0) };
}

/**
 * 生成小程序码, 返回 base64
 * scene = 云端 _id (v2为32字符hex，旧ID保持兼容)
 * page = pages/result/result (开发期用 checkPath: false 跳过已发布校验)
 * @param {string} id 云端 _id
 */
async function getQrcode(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(id)) return { ok: false, error: 'invalid id' };

  const record = await getRecord(id);
  if (!record.ok) return record;
  const res = await cloud.openapi.wxacode.getUnlimited({
    scene: id,
    page: LANDING_PAGE,
    checkPath: false,
    width: 280,
    autoColor: false,
    lineColor: { r: 0, g: 0, b: 0 },
  });

  if (!res || !res.buffer) {
    return { ok: false, error: 'qrcode_empty' };
  }

  return {
    ok: true,
    contentType: res.contentType || 'image/jpeg',
    buffer: res.buffer.toString('base64'),
  };
}
