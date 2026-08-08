/**
 * engine-bridge: 引擎适配层
 *
 * 职责:
 * 1. getConstants() — 返回本地快照 Promise<Constants>, 封装数据访问
 * 2. compute(params) — 调用引擎 computeParetoFrontier, 返回前沿结果
 *
 * 解耦设计: 调用方(页面)仅依赖本适配层, 不直接接触引擎与快照细节。
 * M2 升级云开发时, 仅替换 getConstants() 内部实现, 调用方零改动。
 */
// 引擎产物由 scripts/sync-engine.mjs 同步到 ../vendor/apple-value-engine/
// 用相对路径 import 替代 bare import 'apple-value-engine',
// 因为微信小程序运行时不支持 bare import, 且 miniprogram_npm 机制需要开发者工具构建 npm 触发注册。
// TS 编译时用 index.d.ts 做类型检查, 运行时 require 解析到 index.js。
import { loadConstants, computeParetoFrontier } from '../vendor/apple-value-engine/index';
import type { Constants, DecisionParams, MacroContext, ParetoFrontierResult } from '../vendor/apple-value-engine/index';

// 本地快照(require 方式, 由小程序打包时注入)
// 注意: 微信小程序运行时 require('xxx.json') 会被解析为 xxx.json.js 导致找不到模块,
// 所以 scripts/sync-snapshot.mjs 会生成 constants.js 包装文件, 这里 require .js 版本。
// 顶部 MAY 含 MACRO_CONTEXT 字段(由维护者人工写入, 见 sync-snapshot.mjs / 任务 11.2)。
const snapshotRaw = require('../snapshot/constants.js') as Record<string, unknown> & {
  MACRO_CONTEXT?: MacroContext;
};

let cachedConstants: Constants | null = null;

/**
 * 获取 Constants 数据
 *
 * MVP 阶段: 返回本地打包快照, 无网络请求
 * M2 阶段: 内部改为先查云数据库缓存、失败回退本地快照(调用方零改动)
 */
export function getConstants(): Promise<Constants> {
  if (cachedConstants) {
    return Promise.resolve(cachedConstants);
  }
  try {
    cachedConstants = loadConstants(JSON.stringify(snapshotRaw));
    return Promise.resolve(cachedConstants);
  } catch (err) {
    return Promise.reject(err);
  }
}

/**
 * 读取快照顶部维护者人工写入的宏观状态(MACRO_CONTEXT)。
 *
 * 见任务 11.2: sync-snapshot.mjs 不会自动生成此字段, 由维护者人工写入当前宏观状态。
 * 缺省时返回 storageSuperCycleStage='none' + hasGlobalPriceHike=false,
 * analysisMonth 回退 constants.lastUpdated 的 YYYY-MM, 保证向后兼容。
 */
export async function getMacroContext(): Promise<MacroContext> {
  const constants = await getConstants();
  const mc = snapshotRaw.MACRO_CONTEXT;
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
 * 默认 considerWait=true, 自动注入 macroContext(从快照读取),
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

/** 获取快照的 last_updated 日期(用于数据时效提示) */
export async function getSnapshotDate(): Promise<string> {
  const constants = await getConstants();
  return constants.lastUpdated;
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
