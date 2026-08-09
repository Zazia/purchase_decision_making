// services/saved-results.ts
// 本地缓存服务: 保存完整决策结果快照, 支持回看 / 列表 / 删除 / 分享 path
// 存储介质: wx.setStorageSync (单 key 上限 1MB, 总上限 10MB, 单条快照预估 < 50KB)
// 容量策略: 保留最近 20 条, 超出时删除最旧快照

/** 与 result.ts PlanPoint 对齐的方案点 (含 v3.8 候选类型字段) */
export interface PlanPoint {
  model: string;
  chip: string;
  buyTiming: 'new' | 'used';
  holdingYears: number;
  monthlyCost: number;
  avgPerformance: number;
  buyPrice: number;
  residual: number;
  maintenanceCost: number;
  holdingMonths: number;
  performanceS0: number;
  performanceSN: number;
  candidateType?: 'A' | 'B' | 'C';
  waitMonths?: number;
  predictedPrice?: boolean;
  systemSupportRisk?: 'normal' | 'near-end' | 'exceeded';
  systemSupportExceedMonths?: number;
}

export interface DecisionParams {
  category: string;
  budget: number;
  buyTiming: 'new' | 'used' | 'both';
  performanceFloor: number;
  holdingYears: number[];
}

export interface RecommendationRange {
  lowerCost: number;
  upperCost: number;
  plans: PlanPoint[];
}

/** report 页渲染所需完整数据 (回看时直接用, 不重算) */
export interface ReportData {
  params: DecisionParams;
  frontier: PlanPoint[];
  dominated: PlanPoint[];
  recommendationRange: RecommendationRange | null;
  performanceFloor: number;
  budget: number;
}

/** 完整结果快照 */
export interface SavedResult {
  /** 唯一ID = 保存时间戳 (Date.now()) */
  id: string;
  /** 保存时间 (ms) */
  createdAt: number;
  /** 决策参数 (列表展示 + 分享 path 生成) */
  params: DecisionParams;
  /** report 页渲染所需完整数据 */
  reportData: ReportData;
  /** 报告标题 (列表展示 + 回看标题) */
  headerTitle: string;
  /** 保存时所用的数据快照日期 */
  lastUpdated: string;
  /** 云端记录 _id (展示我的方案勾选且云函数成功时回填; 不勾选或失败为 null) */
  cloudId?: string | null;
}

/** 列表索引项 (轻量, 不含完整 reportData) */
export interface SavedResultIndexItem {
  id: string;
  createdAt: number;
  category: string;
  budget: number;
  headerTitle: string;
  /** 首选方案摘要, 如 "M2 16G 256G · 二手 · 3年" */
  topPlanLabel: string;
}

const INDEX_KEY = 'saved_result_index';
const SNAPSHOT_KEY = (id: string) => `saved_result_${id}`;
const MAX_COUNT = 20;

/** 简化机型显示: "M2_16G_256G_二手 × 3年" → "M2 16G 256G" */
function formatModelLabel(model: string): string {
  return model.replace(/\s*×\s*\d+年$/, '').replace(/_/g, ' ');
}

/**
 * 按首选顺序排序: 最接近性能地板的优先
 * (优先满足地板; 接近度相同按月均成本升序)
 * 用于结论卡/保存/分享卡/列表标签的"首选方案"选取, 与完整报告推荐表 🥇 首选一致
 */
export function sortPreferredPlans(plans: PlanPoint[], performanceFloor: number): PlanPoint[] {
  const floor = performanceFloor;
  return [...plans].sort((a, b) => {
    const aMeets = a.avgPerformance >= floor;
    const bMeets = b.avgPerformance >= floor;
    if (aMeets && !bMeets) return -1;
    if (!aMeets && bMeets) return 1;
    const da = Math.abs(a.avgPerformance - floor);
    const db = Math.abs(b.avgPerformance - floor);
    if (da !== db) return da - db;
    return a.monthlyCost - b.monthlyCost;
  });
}

/** 从 reportData 提取首选方案摘要: "{机型} · {新品/二手} · {N}年" */
function buildTopPlanLabel(reportData: ReportData): string {
  const recPlans = reportData.recommendationRange?.plans ?? [];
  const pool = recPlans.length > 0 ? recPlans : reportData.frontier;
  const top = sortPreferredPlans(pool, reportData.performanceFloor)[0];
  if (!top) return '暂无方案';
  const model = formatModelLabel(top.model);
  const timing = top.buyTiming === 'new' ? '新品' : '二手';
  return `${model} · ${timing} · ${top.holdingYears}年`;
}

/** 读索引 (按 createdAt 降序) */
function readIndex(): SavedResultIndexItem[] {
  try {
    const idx = wx.getStorageSync(INDEX_KEY) as SavedResultIndexItem[];
    return Array.isArray(idx) ? idx : [];
  } catch {
    return [];
  }
}

/** 写索引 */
function writeIndex(items: SavedResultIndexItem[]): void {
  wx.setStorageSync(INDEX_KEY, items);
}

/** 删除某条快照 (不抛错) */
function removeSnapshot(id: string): void {
  try {
    wx.removeStorageSync(SNAPSHOT_KEY(id));
  } catch {
    // 忽略
  }
}

/**
 * 保存结果快照
 * 生成 id=Date.now(), 写快照 + 更新索引 + 容量清理 (保留 20 条), 返回 id
 * 写入失败时清理最旧条目重试一次; 仍失败则抛错由调用方降级处理
 */
export function saveResult(snapshot: Omit<SavedResult, 'id' | 'createdAt'>): string {
  const id = String(Date.now());
  const createdAt = Number(id);
  const saved: SavedResult = { id, createdAt, ...snapshot };

  const writeOnce = (): boolean => {
    try {
      wx.setStorageSync(SNAPSHOT_KEY(id), saved);
      return true;
    } catch {
      return false;
    }
  };

  // 首次写入
  if (!writeOnce()) {
    // 清理最旧一条后重试一次
    const idx = readIndex();
    if (idx.length > 0) {
      const oldest = idx[idx.length - 1];
      removeSnapshot(oldest.id);
    }
    if (!writeOnce()) {
      throw new Error('保存失败, 请清理微信存储后重试');
    }
  }

  // 更新索引 (降序, 新增在前)
  const item: SavedResultIndexItem = {
    id,
    createdAt,
    category: snapshot.params.category,
    budget: snapshot.params.budget,
    headerTitle: snapshot.headerTitle,
    topPlanLabel: buildTopPlanLabel(snapshot.reportData),
  };

  const idx = readIndex();
  const next = [item, ...idx];

  // 容量清理: 超出 MAX_COUNT 时删除最旧的快照 key + 索引项
  if (next.length > MAX_COUNT) {
    const overflow = next.splice(MAX_COUNT);
    overflow.forEach((it) => removeSnapshot(it.id));
  }

  writeIndex(next);
  return id;
}

/**
 * 覆盖更新已有的结果快照 (保持原 id/createdAt, 只更新 params/reportData/headerTitle/lastUpdated/cloudId)
 * 用于分享卡"重新生成"场景: 避免对同一组参数反复保存多条重复快照
 * id 不存在时降级为新建 (调用 saveResult), 返回 id
 */
export function updateResult(id: string, snapshot: Omit<SavedResult, 'id' | 'createdAt'>): string {
  let existing: SavedResult | null = null;
  try {
    const saved = wx.getStorageSync(SNAPSHOT_KEY(id)) as SavedResult | undefined;
    if (saved && saved.params) existing = saved;
  } catch {
    // 忽略读错误, 降级为新建
  }
  if (!existing) {
    return saveResult(snapshot);
  }

  // 原地覆盖: 保留 id/createdAt, 更新其余字段
  const updated: SavedResult = {
    id: existing.id,
    createdAt: existing.createdAt,
    params: snapshot.params,
    reportData: snapshot.reportData,
    headerTitle: snapshot.headerTitle,
    lastUpdated: snapshot.lastUpdated,
    cloudId: snapshot.cloudId ?? existing.cloudId ?? null,
  };
  try {
    wx.setStorageSync(SNAPSHOT_KEY(id), updated);
  } catch {
    // 写失败降级为新建
    return saveResult(snapshot);
  }

  // 同步索引项 (topPlanLabel 可能随首选方案变化)
  const idx = readIndex();
  const i = idx.findIndex((it) => it.id === id);
  if (i >= 0) {
    idx[i] = {
      id: existing.id,
      createdAt: existing.createdAt,
      category: snapshot.params.category,
      budget: snapshot.params.budget,
      headerTitle: snapshot.headerTitle,
      topPlanLabel: buildTopPlanLabel(snapshot.reportData),
    };
    writeIndex(idx);
  }
  return id;
}

/** 读取单条快照, 失败返回 null */
export function getSavedResult(id: string): SavedResult | null {
  try {
    const saved = wx.getStorageSync(SNAPSHOT_KEY(id)) as SavedResult | undefined;
    if (!saved || !saved.params) return null;
    return saved;
  } catch {
    return null;
  }
}

/** 读索引, 按 createdAt 降序返回 */
export function listSavedResults(): SavedResultIndexItem[] {
  return readIndex().sort((a, b) => b.createdAt - a.createdAt);
}

/** 删除单条: 删快照 key + 索引项 */
export function deleteSavedResult(id: string): void {
  removeSnapshot(id);
  const idx = readIndex().filter((it) => it.id !== id);
  writeIndex(idx);
}

/** 生成分享 path: /pages/result/result?category=...&budget=...&buyTiming=...&performanceFloor=...&holdingYears=2,3,4 */
export function buildSharePath(params: DecisionParams): string {
  const q = `category=${params.category}&budget=${params.budget}&buyTiming=${params.buyTiming}&performanceFloor=${params.performanceFloor}&holdingYears=${params.holdingYears.join(',')}`;
  return `/pages/result/result?${q}`;
}

/** 读索引长度, 供 decision-tree 显示数量 */
export function getSavedCount(): number {
  return readIndex().length;
}

/**
 * 云函数写入成功后回填本地快照的 cloudId 字段
 * 失败时静默 (cloudId 缺失只会让小程序码无法重用, 不影响分享卡本身)
 */
export function updateCloudId(id: string, cloudId: string): void {
  try {
    const saved = wx.getStorageSync(SNAPSHOT_KEY(id)) as SavedResult | undefined;
    if (!saved || !saved.params) return;
    saved.cloudId = cloudId;
    wx.setStorageSync(SNAPSHOT_KEY(id), saved);
  } catch {
    // 忽略: 回填失败不影响主流程
  }
}
