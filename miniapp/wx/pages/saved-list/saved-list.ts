// pages/saved-list/saved-list.ts
// 我的保存结果列表: 读取本地缓存索引, 展示已保存的结果快照
// 点击 → 回看模式打开 report 页; 长按 → 确认删除

import {
  listSavedResults,
  deleteSavedResult,
  type SavedResultIndexItem,
} from '../../services/saved-results';

/** 列表展示项 (索引项 + 格式化时间) */
interface DisplayItem extends SavedResultIndexItem {
  savedTimeLabel: string;
}

/** 格式化时间戳为 "YYYY-MM-DD HH:mm" */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

Page({
  data: {
    list: [] as DisplayItem[],
  },

  onLoad() {
    this.loadList();
  },

  onShow() {
    // 每次显示时刷新列表 (从回看页返回时数据可能已变化)
    this.loadList();
  },

  /** 读取索引并格式化为展示项 */
  loadList() {
    const items = listSavedResults();
    const list: DisplayItem[] = items.map((it) => ({
      ...it,
      savedTimeLabel: formatTime(it.createdAt),
    }));
    this.setData({ list });
  },

  /** 点击结果项 → 回看模式打开 result 页(用户可从结果页自行进入完整报告) */
  onTapItem(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({ url: `/pages/result/result?savedId=${id}` });
  },

  /** 长按结果项 → 确认删除 */
  onLongPressItem(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;

    wx.showModal({
      title: '删除该结果',
      content: '删除后无法恢复，确认删除？',
      confirmText: '删除',
      confirmColor: '#F24B4B',
      success: (res: { confirm: boolean }) => {
        if (res.confirm) {
          deleteSavedResult(id);
          this.loadList();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      },
    });
  },

  /** 空态: 跳转决策树首页 */
  onGoDecisionTree() {
    wx.navigateTo({ url: '/pages/decision-tree/decision-tree' });
  },
});
