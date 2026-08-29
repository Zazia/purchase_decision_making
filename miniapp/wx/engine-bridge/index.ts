/**
 * engine-bridge: 引擎适配层
 *
 * 职责:
 * 1. getConstants() — 按「云端优先、本地快照兜底」链路返回 Promise<Constants>
 * 2. compute(params) — 调用引擎 computeParetoFrontier, 返回前沿结果
 *
 * 解耦设计: 调用方(页面)仅依赖本适配层, 不直接接触引擎与快照细节。
 *
 * constants 加载链 (cloud-constants-distribution):
 *   内存缓存(会话固定) → 存储正缓存(立即采用+后台刷新) → [无缓存] 等待云端(10s超时) → 本地打包快照兜底
 * 版本仲裁: 仅当云端/存储版本 ≥ 本地快照 metadata.last_updated 时采用, 防止发版后数据回退。
 * 云端文档契约: 集合 constants / 文档 latest, 字段 {_ready, version, payload, macroContext, hash, publishedAt}。
 */
// 引擎产物由 scripts/sync-engine.mjs 同步到 ../vendor/apple-value-engine/
// 用相对路径 import 替代 bare import 'apple-value-engine',
// 因为微信小程序运行时不支持 bare import, 且 miniprogram_npm 机制需要开发者工具构建 npm 触发注册。
// TS 编译时用 index.d.ts 做类型检查, 运行时 require 解析到 index.js。
import { loadConstants, computeParetoFrontier, recomputeFrontierFromPoints } from '../vendor/apple-value-engine/index';
import type { Constants, DecisionParams, MacroContext, ParetoFrontierResult, EditedPlanPoint } from '../vendor/apple-value-engine/index';

// 本地快照(require 方式, 由小程序打包时注入)
// 注意: 微信小程序运行时 require('xxx.json') 会被解析为 xxx.json.js 导致找不到模块,
// 所以 scripts/sync-snapshot.mjs 会生成 constants.js 包装文件, 这里 require .js 版本。
// 顶部 MAY 含 MACRO_CONTEXT 字段(由维护者人工写入, 见 sync-snapshot.mjs / 任务 11.2)。
const snapshotRaw = require('../snapshot/constants.js') as Record<string, unknown> & {
  MACRO_CONTEXT?: MacroContext;
};

// ============================================================================
// 云端 constants 加载链
// ============================================================================

/** 云数据库集合/文档 ID (与 scripts/publish-constants.mjs 的发布目标一致) */
const CLOUD_COLLECTION = 'constants';
const CLOUD_DOC_ID = 'latest';
/** 本地存储缓存键 (schema 变更时递增后缀) */
const STORAGE_KEY = 'constants_cloud_cache_v1';
/** 首次启动等待云端拉取的超时上限 (ms) */
const CLOUD_FETCH_TIMEOUT_MS = 10 * 1000;
/** 负缓存有效期: 失败后 24h 内冷启动不再等待云端 */
const NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 云端 constants/latest 文档契约 */
interface CloudConstantsDoc {
  _ready?: boolean;
  version?: string;
  payload?: string;
  macroContext?: MacroContext | null;
  hash?: string;
  publishedAt?: string;
}

/** 本地存储缓存记录; payload=null 表示负缓存(云端近期不可达) */
interface StorageRecord {
  version: string;
  payload: string | null;
  macroContext?: MacroContext | null;
  skipUntil?: number;
}

/** 当前生效数据源(未经过 loadConstants 校验前的原始形态) */
interface EffectiveSource {
  raw: Record<string, unknown> & { MACRO_CONTEXT?: MacroContext };
  version: string;
}

/** 当前生效的 constants (内存缓存) 与其原始数据/版本 */
let cachedConstants: Constants | null = null;
let effectiveRaw: Record<string, unknown> & { MACRO_CONTEXT?: MacroContext } = snapshotRaw;
let effectiveVersion = '';
/** 首次加载的进行中 Promise (并发去重) */
let loadPromise: Promise<Constants> | null = null;
/** 本会话是否已发起过后台刷新 (单飞) */
let backgroundRefreshStarted = false;

/** 本地打包快照的版本号 (= metadata.last_updated) */
function readLocalVersion(): string {
  const meta = snapshotRaw['metadata'] as { last_updated?: string } | undefined;
  return (meta && typeof meta.last_updated === 'string') ? meta.last_updated : '';
}

/**
 * 版本比较: a >= b。
 * 优先按日期语义比较(YYYY-MM-DD 可被 Date.parse 解析), 解析失败时回退字典序。
 */
function versionGE(a: string, b: string): boolean {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (!Number.isNaN(da) && !Number.isNaN(db)) return da >= db;
  return a >= b;
}

/** 读取本地存储缓存; 无效记录返回 null */
function readStorageRecord(): StorageRecord | null {
  try {
    const rec = wx.getStorageSync(STORAGE_KEY) as unknown;
    if (!rec || typeof rec !== 'object') return null;
    const r = rec as Partial<StorageRecord>;
    if (typeof r.version !== 'string') return null;
    if (r.payload !== null && typeof r.payload !== 'string') return null;
    return r as StorageRecord;
  } catch {
    return null;
  }
}

/** 写本地存储缓存; 存储失败静默(不阻断主流程) */
function writeStorageRecord(rec: StorageRecord): void {
  try {
    wx.setStorageSync(STORAGE_KEY, rec);
  } catch (err) {
    console.warn('[engine-bridge] write storage cache failed:', err);
  }
}

/** 清除本地存储缓存(缓存损坏时) */
function clearStorageRecord(): void {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * 拉取云端 constants/latest 文档。
 * 任何失败(云开发未初始化/网络/超时/集合不存在)均 resolve null, 不 reject。
 */
function fetchCloudDoc(): Promise<CloudConstantsDoc | null> {
  return new Promise((resolve) => {
    // 防御式取 wx.cloud: 旧基础库可能无云开发能力
    const cloudApi = (typeof wx !== 'undefined' && wx.cloud) ? wx.cloud : undefined;
    if (!cloudApi) {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (doc: CloudConstantsDoc | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(doc);
    };
    const timer = setTimeout(() => finish(null), CLOUD_FETCH_TIMEOUT_MS);
    try {
      const db = cloudApi.database() as {
        collection: (name: string) => {
          doc: (id: string) => { get: () => Promise<{ data?: unknown }> };
        };
      };
      db.collection(CLOUD_COLLECTION)
        .doc(CLOUD_DOC_ID)
        .get()
        .then((res: { data?: unknown }) => {
          const doc = res && res.data;
          finish(doc && typeof doc === 'object' ? (doc as CloudConstantsDoc) : null);
        })
        .catch((err: unknown) => {
          console.warn('[engine-bridge] cloud constants fetch failed:', err);
          finish(null);
        });
    } catch (err) {
      console.warn('[engine-bridge] cloud database access failed:', err);
      finish(null);
    }
  });
}

/**
 * 云端文档 → EffectiveSource。
 * `_ready` 非 true / payload 缺失 / JSON 解析失败时返回 null (视为来源不可用)。
 */
function parseCloudDoc(doc: CloudConstantsDoc): EffectiveSource | null {
  if (!doc || doc._ready !== true || typeof doc.payload !== 'string' || doc.payload.length === 0) {
    return null;
  }
  try {
    const raw = JSON.parse(doc.payload) as Record<string, unknown> & { MACRO_CONTEXT?: MacroContext };
    if (!raw || typeof raw !== 'object') return null;
    if (doc.macroContext && typeof doc.macroContext === 'object') {
      raw.MACRO_CONTEXT = doc.macroContext;
    }
    const meta = raw['metadata'] as { last_updated?: string } | undefined;
    const version = (typeof doc.version === 'string' && doc.version)
      ? doc.version
      : ((meta && typeof meta.last_updated === 'string') ? meta.last_updated : '');
    return { raw, version };
  } catch {
    return null;
  }
}

/** 采用某个数据源: loadConstants 校验(失败抛错) + 更新内存缓存与当前生效 raw */
function adoptSource(src: EffectiveSource): Constants {
  const constants = loadConstants(JSON.stringify(src.raw));
  effectiveRaw = src.raw;
  effectiveVersion = src.version;
  cachedConstants = constants;
  return constants;
}

/** 采用本地打包快照 (版本号取快照自身 metadata.last_updated) */
function adoptLocalSnapshot(): Constants {
  return adoptSource({ raw: snapshotRaw, version: readLocalVersion() });
}

/**
 * 后台静默刷新 (每会话单飞):
 * 成功 → 校验通过后仅写存储缓存, 供下次会话使用, 不改内存 (会话内数据版本固定);
 * 失败 → 仅当不存在正缓存时写负缓存, 避免弱网用户下次冷启动再等超时。
 */
function refreshInBackground(): void {
  if (backgroundRefreshStarted) return;
  backgroundRefreshStarted = true;
  (async () => {
    const doc = await fetchCloudDoc();
    if (!doc) {
      const rec = readStorageRecord();
      // 已有正缓存则保留 (旧但仍有效的数据优于负缓存)
      if (rec && typeof rec.payload === 'string' && rec.payload.length > 0) return;
      writeStorageRecord({
        version: effectiveVersion || readLocalVersion(),
        payload: null,
        skipUntil: Date.now() + NEGATIVE_CACHE_TTL_MS,
      });
      return;
    }
    const src = parseCloudDoc(doc);
    if (!src) return;
    try {
      loadConstants(JSON.stringify(src.raw)); // 仅校验, 不采纳
      writeStorageRecord({
        version: src.version,
        payload: doc.payload as string,
        macroContext: doc.macroContext ?? null,
      });
    } catch (err) {
      console.warn('[engine-bridge] cloud data failed validation, keep current cache:', err);
    }
  })();
}

/**
 * 获取 Constants 数据
 *
 * 加载链: 内存缓存 → 存储正缓存(立即采用+后台刷新) → [无缓存] 等待云端 → 本地打包快照兜底。
 * 对外签名保持 Promise<Constants>, 调用方零改动。
 */
export function getConstants(): Promise<Constants> {
  if (cachedConstants) {
    return Promise.resolve(cachedConstants);
  }
  if (loadPromise) {
    return loadPromise;
  }
  loadPromise = (async (): Promise<Constants> => {
    const localVersion = readLocalVersion();
    const rec = readStorageRecord();

    // 1) 存储正缓存: 与本地快照取版本高者立即采用, 后台刷新供下次会话
    if (rec && typeof rec.payload === 'string' && rec.payload.length > 0) {
      try {
        const raw = JSON.parse(rec.payload) as Record<string, unknown> & { MACRO_CONTEXT?: MacroContext };
        if (rec.macroContext && typeof rec.macroContext === 'object') {
          raw.MACRO_CONTEXT = rec.macroContext;
        }
        const cacheVersion = rec.version || localVersion;
        const constants = versionGE(cacheVersion, localVersion)
          ? adoptSource({ raw, version: cacheVersion }) // 校验失败抛错 → catch 清缓存降级
          : adoptLocalSnapshot();
        refreshInBackground();
        return constants;
      } catch (err) {
        console.warn('[engine-bridge] storage cache corrupted, fall back to cloud/local:', err);
        clearStorageRecord();
        // 落入下方云端路径
      }
    } else if (
      rec && rec.payload === null
      && typeof rec.skipUntil === 'number' && rec.skipUntil > Date.now()
    ) {
      // 2) 负缓存未过期: 直接本地快照 + 后台刷新, 不等待云端超时
      const constants = adoptLocalSnapshot();
      refreshInBackground();
      return constants;
    }

    // 3) 无有效缓存: 等待云端拉取 (首次启动)
    const doc = await fetchCloudDoc();
    if (doc) {
      const src = parseCloudDoc(doc);
      if (src) {
        if (versionGE(src.version, localVersion)) {
          try {
            const constants = adoptSource(src);
            writeStorageRecord({
              version: src.version,
              payload: doc.payload as string,
              macroContext: doc.macroContext ?? null,
            });
            return constants;
          } catch (err) {
            console.warn('[engine-bridge] cloud data failed validation, fall back to local:', err);
          }
        } else {
          // 云端版本旧于本地快照: 用本地, 不写缓存(下次会话再拉云端)
          return adoptLocalSnapshot();
        }
      }
    }

    // 4) 兜底: 本地打包快照 + 负缓存 (仅云端不可用时)
    const constants = adoptLocalSnapshot();
    writeStorageRecord({
      version: localVersion,
      payload: null,
      skipUntil: Date.now() + NEGATIVE_CACHE_TTL_MS,
    });
    return constants;
  })();
  return loadPromise;
}

/**
 * 读取当前生效数据源顶部的宏观状态(MACRO_CONTEXT)。
 *
 * 来源跟随 getConstants() 实际采用的数据(云端文档的 macroContext 字段
 * 或本地快照包装内维护者人工写入的 MACRO_CONTEXT)。
 * 缺省时返回 storageSuperCycleStage='none' + hasGlobalPriceHike=false,
 * analysisMonth 回退 constants.lastUpdated 的 YYYY-MM, 保证向后兼容。
 */
export async function getMacroContext(): Promise<MacroContext> {
  const constants = await getConstants();
  const mc = effectiveRaw.MACRO_CONTEXT;
  if (mc && typeof mc.storageSuperCycleStage === 'string' && typeof mc.hasGlobalPriceHike === 'boolean') {
    return {
      storageSuperCycleStage: mc.storageSuperCycleStage,
      hasGlobalPriceHike: mc.hasGlobalPriceHike,
      analysisMonth: typeof mc.analysisMonth === 'string' ? mc.analysisMonth : constants.lastUpdated.slice(0, 7),
    };
  }
  return {
    storageSuperCycleStage: 'none',
    hasGlobalPriceHike: false,
    analysisMonth: constants.lastUpdated.slice(0, 7),
  };
}

/**
 * 调用引擎计算帕累托前沿
 *
 * 默认 considerWait=true, 自动注入 macroContext(从当前生效数据源读取),
 * 调用方可通过 params.considerWait=false / params.macroContext 显式覆盖。
 *
 * @param params 决策参数(品类/预算/持有期/买入时机/性能地板)
 * @returns { frontier, dominated, recommendationRange }
 */
export async function compute(params: DecisionParams): Promise<ParetoFrontierResult> {
  const constants = await getConstants();
  const merged: DecisionParams = {
    ...params,
    considerWait: params.considerWait !== false ? true : false,
    macroContext: params.macroContext ?? (await getMacroContext()),
  };
  return computeParetoFrontier(constants, merged);
}

/**
 * 按用户编辑后的方案集重算帕累托前沿
 *
 * 与 compute() 的差异: 不重新从 constants 市场快照提取候选,
 * 而是在 editedPoints 上做帕累托筛选与推荐区间截取。
 * 透传 mSeriesCAGR / aSeriesCAGR (缺省走引擎默认), 不需要 macroContext
 * (重算不涉及类型 B/C 候选生成, 用户编辑的是已有方案)。
 *
 * @param params 决策参数 (用于推荐区间截取与 CAGR 透传)
 * @param editedPoints 用户编辑后的方案集
 * @returns { frontier, dominated, recommendationRange }
 */
export async function recomputeFromEditedPlans(
  params: DecisionParams,
  editedPoints: EditedPlanPoint[],
): Promise<ParetoFrontierResult> {
  const constants = await getConstants();
  return recomputeFrontierFromPoints(constants, params, editedPoints);
}

/** 获取当前生效数据源的 last_updated 日期(用于数据时效提示) */
export async function getSnapshotDate(): Promise<string> {
  const constants = await getConstants();
  return constants.lastUpdated;
}

/**
 * 获取已知芯片名列表 (从 constants.chipBenchmarks 提取)
 * 用于编辑器新增自定义方案时的芯片下拉选择
 */
export async function getKnownChips(): Promise<string[]> {
  const constants = await getConstants();
  const chips: string[] = [];
  const benchmarks = constants.chipBenchmarks as Record<string, Record<string, unknown> | undefined>;
  if (benchmarks) {
    for (const category of Object.values(benchmarks)) {
      if (category && typeof category === 'object') {
        chips.push(...Object.keys(category));
      }
    }
  }
  return chips;
}

/**
 * 计算数据时效分级
 * - ≤ 35 天: 'fresh' (无提示)
 * - 35-60 天: 'stale' (黄色提示)
 * - > 60 天: 'expired' (红色提示 + GitHub 链接)
 */
export async function getDataFreshness(): Promise<{
  level: 'fresh' | 'stale' | 'expired';
  days: number;
  lastUpdated: string;
}> {
  const lastUpdated = await getSnapshotDate();
  const last = new Date(lastUpdated);
  const now = new Date();
  const days = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));

  if (days <= 35) return { level: 'fresh', days, lastUpdated };
  if (days <= 60) return { level: 'stale', days, lastUpdated };
  return { level: 'expired', days, lastUpdated };
}
