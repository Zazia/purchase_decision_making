// components/repo-footer/repo-footer.ts
// 页面底部项目仓库链接, 点击复制到剪贴板

const REPO_URL = 'https://github.com/Zazia/apple-value-analysis';

Component({
  methods: {
    onTap() {
      wx.setClipboardData({
        data: REPO_URL,
        success: () => {
          wx.showToast({ title: '仓库链接已复制', icon: 'none' });
        },
      });
    },
  },
});
