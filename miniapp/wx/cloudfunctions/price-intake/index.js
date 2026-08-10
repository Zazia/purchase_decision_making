// cloudfunctions/price-intake/index.js
const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || 'unknown';
  
  // Hash OPENID for anonymity
  const anonId = crypto.createHash('sha256').update(openid + 'price_intake_salt').digest('hex');

  const { action, submittedPlans, originalPlans, params } = event;

  if (action === 'submit') {
    try {
      const now = new Date().toISOString();
      const result = await db.collection('price_intake_shadow').add({
        data: {
          submittedPlans,
          originalPlans,
          params,
          createdAt: now,
          submittedAt: now,
          anonId
        }
      });
      return { ok: true, id: result._id };
    } catch (err) {
      console.error(err);
      return { ok: false, error: err.message };
    }
  }

  return { ok: false, error: 'Unknown action' };
};
