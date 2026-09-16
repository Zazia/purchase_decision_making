/**
 * wx-cloud-api.mjs — 微信云开发服务端 HTTP API 共享封装
 *
 * 供数据维护脚本复用: stable_token 获取 + tcb/databasequery 查询。
 * 凭证解析优先级与 scripts/publish-constants.mjs 保持一致:
 *   appid:  WX_APPID 环境变量 > scripts/.wx-publish-credentials.json > miniapp/wx/project.config.json
 *   secret: WX_SECRET 环境变量 > scripts/.wx-publish-credentials.json
 * 凭证 MUST NOT 入库 (.gitignore 已覆盖凭证文件)。
 *
 * 注意: HTTP query DSL 不保证支持 db.command 比较运算符 (_.gt 等),
 * 增量过滤由调用方在本地做(拉取全量 orderBy 后按水位线过滤)。
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const CREDENTIALS_FILE = join(ROOT, 'scripts', '.wx-publish-credentials.json');
const PROJECT_CONFIG = join(ROOT, 'miniapp', 'wx', 'project.config.json');
/** 与 miniapp/wx/app.ts 的 CLOUD_ENV 保持一致 */
export const DEFAULT_ENV_ID = 'cloud1-d7gb4dzhoaca5534d';

export class CloudApiError extends Error {
  /** @param {string} step 失败步骤名 @param {string} message */
  constructor(step, message) {
    super(`[wx-cloud-api] FAIL @ ${step}: ${message}`);
    this.name = 'CloudApiError';
    this.step = step;
  }
}

/** @returns {{appid?: string, secret?: string}} */
function loadCredentials() {
  let credentials = {};
  if (existsSync(CREDENTIALS_FILE)) {
    try {
      credentials = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8'));
    } catch (err) {
      throw new CloudApiError('credentials-parse', `Failed to parse ${CREDENTIALS_FILE}: ${err.message}`);
    }
  }
  let appid = process.env.WX_APPID || credentials.appid;
  if (!appid) {
    try {
      appid = JSON.parse(readFileSync(PROJECT_CONFIG, 'utf-8')).appid;
    } catch { /* project.config.json 缺失或损坏, 由下方缺凭证报错统一处理 */ }
  }
  const secret = process.env.WX_SECRET || credentials.secret;
  return { appid, secret };
}

/**
 * @param {object} [options]
 * @param {string} [options.envId] 云环境 ID, 默认 DEFAULT_ENV_ID
 */
export async function createCloudClient(options = {}) {
  const envId = options.envId || DEFAULT_ENV_ID;
  const { appid, secret } = loadCredentials();
  if (!appid) {
    throw new CloudApiError('credentials-check',
      '未找到 appid (WX_APPID / 凭证文件 / project.config.json 均缺失)');
  }
  if (!secret) {
    throw new CloudApiError('credentials-check',
      '未找到 AppSecret。配置方式任选其一:\n' +
      '  1) 设置环境变量 WX_SECRET (推荐)\n' +
      `  2) 创建 ${CREDENTIALS_FILE} 内容 {"secret": "你的AppSecret"} (已加入 .gitignore)`);
  }

  // 网络层瞬时抖动重试 (仅网络异常重试, API 业务错误不重试)
  const NETWORK_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 600;
  async function fetchWithRetry(url, init) {
    let lastErr;
    for (let i = 0; i < NETWORK_ATTEMPTS; i++) {
      try {
        return await fetch(url, init);
      } catch (err) {
        lastErr = err;
        if (i < NETWORK_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
    throw new CloudApiError('network', `fetch failed after ${NETWORK_ATTEMPTS} attempts: ${lastErr?.message || lastErr}`);
  }

  // stable_token (不作废其他 token, 与云函数内置凭证互不干扰)
  const tokenRes = await fetchWithRetry('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid, secret, force_refresh: false }),
  }).then((r) => r.json());
  if (!tokenRes.access_token) {
    throw new CloudApiError('stable_token',
      `获取 access_token 失败: ${JSON.stringify(tokenRes)} (检查 appid 与 AppSecret 是否匹配, IP 是否在白名单)`);
  }
  const accessToken = tokenRes.access_token;

  /** 调用 tcb/databasequery; data 为 JSON 字符串数组 */
  async function databaseQuery(queryString) {
    const res = await fetchWithRetry(`https://api.weixin.qq.com/tcb/databasequery?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env: envId, query: queryString }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { errcode: -1, errmsg: `HTTP ${res.status}, 非 JSON 响应: ${text.slice(0, 200)}` };
    }
    if (data.errcode !== 0) {
      throw new CloudApiError('databasequery',
        `查询失败: ${JSON.stringify(data)}\n  query: ${queryString.slice(0, 200)}`);
    }
    return (data.data || []).map((s) => JSON.parse(s));
  }

  return {
    envId,
    query: databaseQuery,
    queryOne: async (queryString) => (await databaseQuery(queryString))[0] ?? null,
    getDoc: async (collection, docId) =>
      (await databaseQuery(`db.collection("${collection}").doc("${docId}").get()`))[0] ?? null,
    /**
     * 全量分页列举集合 (orderBy 默认 createdAt asc)。
     * 单页不足 limit 视为取尽; 最多翻 200 页防失控。
     */
    listCollection: async (collection, listOptions = {}) => {
      const limit = listOptions.limit ?? 100;
      const field = listOptions.orderBy ?? 'createdAt';
      const order = listOptions.order ?? 'asc';
      const all = [];
      for (let page = 0; page < 200; page++) {
        const skip = page * limit;
        const docs = await databaseQuery(
          `db.collection("${collection}").orderBy("${field}","${order}").skip(${skip}).limit(${limit}).get()`
        );
        all.push(...docs);
        if (docs.length < limit) return all;
      }
      throw new CloudApiError('pagination', `集合 ${collection} 翻页超过 200 页上限, 中止`);
    },
  };
}
