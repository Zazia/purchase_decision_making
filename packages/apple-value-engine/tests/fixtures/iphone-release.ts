import type { Constants } from '../../src/index.js';

/** 固定算法测试前置条件；不改写生产常量或共享对象。 */
export function withIPhoneReleaseWindow(base: Constants): Constants {
  const fixture = structuredClone(base);
  fixture.lastUpdated = '2026-08-01';
  for (const category of ['iPhone_Pro', 'iPhone_ProMax']) {
    fixture.releaseRhythm[category]['下一次预计'] = '2026-09 测试发布窗口';
  }
  fixture.releaseTimeValidation = {
    _当前校验结果_2026_08: {
      ...Object.assign({}, ...Object.entries(base.releaseTimeValidation ?? {})
        .filter(([key]) => key.startsWith('_当前校验结果_'))
        .map(([, value]) => value)),
      iPhone_Pro: { 置信度: '高' },
      iPhone_ProMax: { 置信度: '高(已官宣)' },
    },
  };
  return fixture;
}
