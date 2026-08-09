// cloudfunctions/share-result/index.js
// 分享结果云函数: 云端 ID 模式
//   - save:   写入 shared_results 集合 (params + createdAt + expireAt=30天), 返回 _id
//   - get:    读 shared_results.doc(id), 过期则删除并返回 { ok: false, error: 'expired' }, 否则返回 params
//   - qrcode: 调 cloud.openapi.wxacode.getUnlimited 生成小程序码, scene=id, page=pages/result/result
//
// 云函数以小程序身份代写云数据库, 用户无需登录授权
// 集合权限规则设为「仅创建者可读写」, 云函数用管理端身份绕过

const cloud = require('wx-server-sdk');

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
    if (action === 'save') return await saveRecord(event.params);
    if (action === 'get') return await getRecord(event.id);
    if (action === 'qrcode') return await getQrcode(event.id);
    return { ok: false, error: 'unknown action' };
  } catch (err) {
    console.error('[share-result] action', action, 'failed:', err);
    return { ok: false, error: 'internal', message: err && err.errMsg || String(err) };
  }
};

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
 * 过期则懒清理: 删除该记录并返回 { ok: false, error: 'expired' }
 * @param {string} id 云端 _id
 */
async function getRecord(id) {
  if (!id) return { ok: false, error: 'missing id' };

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
      await db.collection(COLLECTION).doc(id).remove();
    } catch (e) {
      // 删除失败不阻断, 仍返回 expired
    }
    return { ok: false, error: 'expired' };
  }

  return { ok: true, params: doc.params, createdAt: doc.createdAt };
}

/**
 * 生成小程序码, 返回 base64
 * scene = 云端 _id (24 字符 hex, < 32 字符限制)
 * page = pages/result/result (开发期用 checkPath: false 跳过已发布校验)
 * @param {string} id 云端 _id
 */
async function getQrcode(id) {
  if (!id) return { ok: false, error: 'missing id' };

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
