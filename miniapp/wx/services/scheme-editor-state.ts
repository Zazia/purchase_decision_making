// services/scheme-editor-state.ts
// 方案编辑器状态管理: 撤销栈 + 自动保存
//
// 设计 (见 manual-scheme-editor/design.md D3):
//   - 快照式撤销栈: 每次 push 一个完整 EditorSnapshot (含全部 EditedPlanPoint + 分组状态)
//   - 撤销 = cursor-- 并恢复该快照; 历史上限 30 步, 超出丢弃最旧
//   - 自动保存: 每次 push 后 wx.setStorageSync('scheme_editor_draft_<resultKey>', snapshot)
//     resultKey = 参数指纹 (与 buildSharePath 同款), 回看模式额外带 savedId
//     与 saved-results 的 key 前缀 (saved_result_) 隔离
//
// 单 snapshot 体积预估 < 50KB (与 saved-results 一致), 30 步 < 1.5MB,
// 但 draft 仅存最新一个 snapshot (非全历史), 实际占用 < 50KB。

/** 与 saved-results PlanPoint 对齐, 但加上编辑器扩展字段 */
export interface EditedPlanPoint {
  // PlanPoint 基础字段
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
  // 编辑器扩展字段
  editedBuyPrice?: number;
  source: 'original' | 'edited' | 'custom';
  excluded?: boolean;
  deferred?: boolean;
  channel?: string;
  useSubsidy?: boolean;
  /** 自定义方案新增时由用户填入 (引擎重算需要) */
  memoryGb?: number;
  storageGb?: number;
  /** 行唯一 id (用于稳定 keying, 避免编辑后 model 变化丢同步) */
  rowId: string;
}

/** 决策参数 (与 saved-results DecisionParams 对齐) */
export interface DecisionParams {
  category: string;
  budget: number;
  buyTiming: 'new' | 'used' | 'both';
  performanceFloor: number;
  holdingYears: number[];
}

/** 编辑器快照: 含全部方案点 + 暂不考虑分组 + 排除标记 (排除标记在 EditedPlanPoint.excluded 上) */
export interface EditorSnapshot {
  /** 全部方案点 (含已排除/暂不考虑, 引擎重算时过滤) */
  points: EditedPlanPoint[];
  /** 暂不考虑分组的 rowId 列表 (与 point.deferred=true 等价, 这里冗余存便于快速过滤) */
  deferredRowIds: string[];
  /** 上次更新时间戳 */
  updatedAt: number;
}

/** 撤销栈上限 (见 design.md D3: 30 步) */
const MAX_HISTORY = 30;

/** draft key 前缀 (与 saved_result_ 隔离) */
const DRAFT_KEY_PREFIX = 'scheme_editor_draft_';

/**
 * 构造 draft resultKey = 参数指纹 (与 buildSharePath 同款)
 * 回看模式额外带 savedId, 避免覆盖实时计算场景的草稿。
 */
export function buildResultKey(params: DecisionParams, savedId?: string): string {
  const base = `${params.category}-${params.budget}-${params.holdingYears.join(',')}-${params.buyTiming}-${params.performanceFloor}`;
  return savedId ? `${base}-replay-${savedId}` : base;
}

/** 生成唯一 rowId */
function genRowId(): string {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 去重: 相同 model + buyTiming + holdingYears + _copyKey 的点只保留第一个。
 * 用于消除引擎可能生成的重复方案, 同时保留用户通过复制按钮产生的副本 (有不同 _copyKey)。
 */
function deduplicatePoints(points: EditedPlanPoint[]): EditedPlanPoint[] {
  const seen = new Set<string>();
  return points.filter((p) => {
    const copyKey = (p as any)._copyKey || '';
    const key = `${p.model}_${p.buyTiming}_${p.holdingYears}_${copyKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 编辑器状态管理类
 *
 * 用法:
 *   const state = new EditorState();
 *   state.initFromPlans(frontier, dominated, params);
 *   state.push(snapshotAfterEdit);
 *   if (state.canUndo()) state.undo();
 */
export class EditorState {
  private history: EditorSnapshot[] = [];
  private cursor: number = -1; // 指向当前生效的 snapshot; -1 表示未初始化
  private resultKey: string = '';

  /** 当前生效的 snapshot (只读视图) */
  get current(): EditorSnapshot | null {
    if (this.cursor < 0 || this.cursor >= this.history.length) return null;
    return this.history[this.cursor];
  }

  /** 是否可撤销 */
  canUndo(): boolean {
    return this.cursor > 0;
  }

  /** 撤销: cursor-- 并恢复该快照; 不写入 storage (撤销后仍以当前快照为最新 draft) */
  undo(): EditorSnapshot | null {
    if (!this.canUndo()) return null;
    this.cursor--;
    // 撤销后也写入 draft (让 draft 始终反映当前编辑态)
    this.saveDraft();
    return this.current;
  }

  /**
   * 推入新快照 (任何编辑动作都调此方法)
   * 截断 cursor 之后的 redo 历史, 上限 MAX_HISTORY 时丢弃最旧。
   */
  push(snapshot: EditorSnapshot): void {
    // 截断 redo 历史
    if (this.cursor < this.history.length - 1) {
      this.history = this.history.slice(0, this.cursor + 1);
    }
    this.history.push(snapshot);
    // 上限丢弃最旧
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
    this.cursor = this.history.length - 1;
    this.saveDraft();
  }

  /** 设置 resultKey (用于 draft 持久化), 通常在 initFromPlans / loadDraft 时调用 */
  setResultKey(resultKey: string): void {
    this.resultKey = resultKey;
  }

  /** 写入 draft 到本地 storage (覆盖最新 snapshot, 不存全历史) */
  private saveDraft(): void {
    if (!this.resultKey || !this.current) return;
    try {
      wx.setStorageSync(DRAFT_KEY_PREFIX + this.resultKey, this.current);
    } catch {
      // 写入失败不阻断编辑 (容量满时静默, 调用方按 saved-results 容量策略清理)
    }
  }

  /** 加载 draft: 返回是否恢复成功 */
  loadDraft(resultKey: string): EditorSnapshot | null {
    this.resultKey = resultKey;
    try {
      const draft = wx.getStorageSync(DRAFT_KEY_PREFIX + resultKey) as EditorSnapshot | undefined;
      if (!draft || !Array.isArray(draft.points)) return null;
      // 用 draft 作为初始 snapshot
      this.history = [draft];
      this.cursor = 0;
      return draft;
    } catch {
      return null;
    }
  }

  /** 清理 draft (用户主动清除或保存后) */
  clearDraft(resultKey?: string): void {
    const key = resultKey ?? this.resultKey;
    if (!key) return;
    try {
      wx.removeStorageSync(DRAFT_KEY_PREFIX + key);
    } catch {
      // 忽略
    }
  }

  /**
   * 从引擎原始方案初始化编辑态
   * 把 frontier + dominated 转为 EditedPlanPoint[] (source='original'), 推入初始快照。
   * 已有 draft 时优先返回 draft (不覆盖用户上次编辑)。
   * 自动去重: 相同 model + buyTiming + holdingYears + _copyKey 的点只保留第一个。
   *
   * @returns 初始化后的 snapshot (来自 draft 或新建)
   */
  initFromPlans(
    frontier: Array<Omit<EditedPlanPoint, 'source' | 'rowId'>>,
    dominated: Array<Omit<EditedPlanPoint, 'source' | 'rowId'>>,
    params: DecisionParams,
    savedId?: string,
  ): EditorSnapshot {
    const resultKey = buildResultKey(params, savedId);
    this.resultKey = resultKey;

    // 优先加载已有 draft
    const existing = this.loadDraft(resultKey);
    if (existing) {
      // 去重 draft 中可能存在的引擎重复点 (保留有 _copyKey 的副本)
      existing.points = deduplicatePoints(existing.points);
      return existing;
    }

    // 新建初始 snapshot: 全部方案 source='original', 无排除/暂不考虑
    const allPoints: EditedPlanPoint[] = [
      ...frontier.map((p) => ({ ...p, source: 'original' as const, rowId: genRowId() })),
      ...dominated.map((p) => ({ ...p, source: 'original' as const, rowId: genRowId() })),
    ];
    // 去重: 引擎可能对同一 (model, buyTiming, holdingYears) 生成多条, 只保留第一条
    const points = deduplicatePoints(allPoints);
    const snapshot: EditorSnapshot = {
      points,
      deferredRowIds: [],
      updatedAt: Date.now(),
    };
    this.history = [snapshot];
    this.cursor = 0;
    this.saveDraft();
    return snapshot;
  }

  /** 重置状态 (退出编辑器时调用, 不清 draft) */
  reset(): void {
    this.history = [];
    this.cursor = -1;
    this.resultKey = '';
  }
}
