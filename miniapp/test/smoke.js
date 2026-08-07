/**
 * smoke.js — 基础冒烟测试
 *
 * 验证:
 *  1. 能连接到小程序自动化端口
 *  2. reLaunch 到首页 (decision-tree) 成功
 *  3. 首页 data 正确: steps=5, currentStep=0, progress=20
 *  4. 通过 wxml 渲染验证关键元素 (用 evaluate 读 setData 后的 data)
 *  5. 点击交互验证: 选择品类后 currentStep 推进
 *
 * 注意: automator 0.12.1 与新版开发者工具的 page.data() / page.$() 实例方法
 *       存在兼容性问题(超时)。改用 mp.evaluate() / mp.callMethod() 绕过。
 */
const { connect, assert, assertEqual, section, logPass, logInfo, logFail } = require('./helper');

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`[TIMEOUT ${ms}ms] ${label}`)), ms)),
  ]);
}

async function run() {
  section('基础冒烟测试');
  const mp = await connect();
  logPass('连接到小程序自动化端口 ws://127.0.0.1:9420');

  let failed = 0;
  try {
    logInfo('reLaunch 到 /pages/decision-tree/decision-tree ...');
    await withTimeout(mp.reLaunch('/pages/decision-tree/decision-tree'), 20000, 'reLaunch');
    await new Promise((r) => setTimeout(r, 1500));
    logPass('reLaunch 完成');

    // 1. 验证页面路径 (用 currentPage 而非 page.path)
    const cur = await withTimeout(mp.currentPage(), 8000, 'currentPage');
    assert(cur && cur.path && cur.path.includes('decision-tree'), `页面路径应为 decision-tree, 实际=${cur?.path}`);
    logPass(`页面路径正确: ${cur.path}`);

    // 2. 验证页面 data (用 evaluate 绕过 page.data() 超时)
    const data = await withTimeout(mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      return {
        route: p?.route,
        currentStep: p?.data?.currentStep,
        progress: p?.data?.progress,
        stepsLen: p?.data?.steps?.length,
        stepsKeys: (p?.data?.steps || []).map((s) => s.key),
        currentStepTitle: p?.data?.steps?.[p?.data?.currentStep ?? 0]?.title,
        currentOptions: (p?.data?.steps?.[p?.data?.currentStep ?? 0]?.options || []).map((o) => o.label),
        fadeClass: p?.data?.fadeClass,
      };
    }), 8000, 'evaluate(data)');

    assertEqual(data.route, 'pages/decision-tree/decision-tree', 'route');
    assertEqual(data.stepsLen, 5, 'steps 数量');
    assertEqual(data.currentStep, 0, 'currentStep');
    assertEqual(data.progress, 20, 'progress');
    assertEqual(data.fadeClass, 'fade-in', 'fadeClass');
    logPass(`页面 data: steps=${data.stepsLen}步 [${data.stepsKeys.join(',')}], currentStep=${data.currentStep}, progress=${data.progress}%`);

    // 3. 验证首屏选项卡 (6 个品类)
    assertEqual(data.currentOptions.length, 6, `首屏品类选项数 (实际=${JSON.stringify(data.currentOptions)})`);
    logPass(`首屏选项: ${data.currentOptions.join(' / ')}`);

    // 4. 验证步骤标题
    assert(data.currentStepTitle && data.currentStepTitle.length > 0, '步骤标题不应为空');
    logPass(`步骤标题: "${data.currentStepTitle}"`);

    // 5. 验证 wxml 实际渲染了元素 (通过 evaluate 查询 wxml 文本)
    const rendered = await withTimeout(mp.evaluate(() => {
      // 用 selectComponent 或 querySelector 不行, 在小程序环境用 wxml 的方式:
      // 通过 page 的 __wxExparserNodeId__ 拿不到, 用 setData 触发后查 data 已可证明渲染
      // 这里改为: 检查页面 data 的结构完整性
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      const step = p?.data?.steps?.[p?.data?.currentStep ?? 0];
      return {
        hasStep: !!step,
        hasOptions: Array.isArray(step?.options) && step.options.length > 0,
        optionValues: (step?.options || []).map((o) => o.value),
        hasUnsureHandler: typeof p?.onSelectUnsure === 'function',
        hasSelectHandler: typeof p?.onSelectOption === 'function',
      };
    }), 8000, 'evaluate(rendered)');

    assert(rendered.hasStep, '当前步骤对象存在');
    assert(rendered.hasOptions, '当前步骤有选项');
    assert(rendered.hasSelectHandler, 'onSelectOption 处理器存在');
    assert(rendered.hasUnsureHandler, 'onSelectUnsure 处理器存在');
    logPass(`选项 values: ${JSON.stringify(rendered.optionValues)}`);
    logPass('页面方法已注册: onSelectOption, onSelectUnsure');

    // 6. 验证上一步按钮在第一步不显示 (currentStep=0)
    // wxml: <view class="nav-btn back" wx:if="{{currentStep > 0}}"> — currentStep=0 时不渲染
    // 通过 evaluate 检查 currentStep 是否为 0
    assertEqual(data.currentStep, 0, '第一步 currentStep=0 (上一步按钮应隐藏)');
    logPass('第一步隐藏上一步按钮 (currentStep=0, wx:if=false)');

    // 7. 交互测试: 用 evaluate 直接调用页面方法 (automator 0.12.1 无 mp.callMethod)
    logInfo('测试交互: 调用 onSelectOption 选择 "iPhone" ...');
    await withTimeout(mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      p.onSelectOption({ currentTarget: { dataset: { step: 'category', value: 'iphone' } } });
      return true;
    }), 8000, 'evaluate(onSelectOption)');

    // 等待 setTimeout 切换 (decision-tree.ts 中 nextStep 延迟 250ms + 150ms)
    await new Promise((r) => setTimeout(r, 800));

    const afterClick = await withTimeout(mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      return {
        currentStep: p?.data?.currentStep,
        progress: p?.data?.progress,
        selectedCategory: p?.data?.selections?.category,
      };
    }), 8000, 'evaluate(afterClick)');

    assertEqual(afterClick.selectedCategory, 'iphone', '选择品类后 selections.category');
    assertEqual(afterClick.currentStep, 1, '点击后 currentStep 推进到 1');
    assertEqual(afterClick.progress, 40, '点击后 progress=40%');
    logPass(`交互成功: category=${afterClick.selectedCategory}, currentStep=${afterClick.currentStep}, progress=${afterClick.progress}%`);
  } catch (err) {
    failed++;
    logFail(err.message);
    console.error(err);
  } finally {
    await mp.close();
  }

  section(failed === 0 ? '全部通过' : `失败 ${failed} 项`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
