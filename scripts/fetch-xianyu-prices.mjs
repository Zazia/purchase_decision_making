#!/usr/bin/env node
/**
 * fetch-xianyu-prices.mjs v3 — 闲鱼二手价采集脚本
 *
 * v3 改进: 用 connectOverCDP 连接到用户手动启动的真实 Chrome,
 * 绕过闲鱼 Baxia 反爬系统(Playwright 启动的浏览器会被 Baxia 检测)。
 *
 * 用法:
 *   1. 关闭所有 Chrome 窗口
 *   2. 运行本脚本,它会自动启动 Chrome(remote debugging 模式)
 *   3. 在 Chrome 中扫码登录闲鱼
 *   4. 脚本自动搜索并采集价格
 *
 * 或手动启动 Chrome:
 *   chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\temp\xianyu-chrome"
 *   然后运行: node scripts/fetch-xianyu-prices.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { exec } from 'node:child_process';

const CDP_PORT = 9222;
const USER_DATA_DIR = 'C:\\temp\\xianyu-chrome';
const TARGETS = [
  // === P0 批次2: MBP 32G/36G + iMac 16G_512G (4项) ===
  {
    model: 'MacBook Pro M2Pro 32G 512G 二手',
    category: 'MacBook_Pro',
    query: 'MacBook Pro M2Pro 32G 512G',
    priceMin: 6000,
    priceMax: 12000,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', '16G', '16g', 'M2 ', 'M3', 'M1', 'Max', '13寸'],
  },
  {
    model: 'MacBook Pro M3Pro 36G 512G 二手',
    category: 'MacBook_Pro',
    query: 'MacBook Pro M3Pro 36G 512G',
    priceMin: 9000,
    priceMax: 16000,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', '16G', '16g', 'M2', 'M1', 'Max', '13寸'],
  },
  {
    model: 'iMac M3 24寸 16G 512G 二手',
    category: 'iMac',
    query: 'iMac M3 24寸 16G 512G',
    priceMin: 5000,
    priceMax: 9000,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', 'M1', 'M4', '8G', '256G'],
  },
  {
    model: 'iMac M1 24寸 16G 512G 二手',
    category: 'iMac',
    query: 'iMac M1 24寸 16G 512G',
    priceMin: 3500,
    priceMax: 6000,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', 'M3', 'M4', '8G', '256G'],
  },
  // === P1 批次3: iPhone 16 不同存储 (4项) ===
  {
    model: 'iPhone 16 ProMax 512G 二手',
    category: 'iPhone_proMax',
    query: 'iPhone 16 ProMax 512G',
    priceMin: 7000,
    priceMax: 10000,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', '128G', '256G', '15', '14', '13'],
  },
  {
    model: 'iPhone 16 Pro 128G 二手',
    category: 'iPhone_Pro',
    query: 'iPhone 16 Pro 128G',
    priceMin: 4500,
    priceMax: 6500,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', '256G', '512G', 'ProMax', '15', '14', '13'],
  },
  {
    model: 'iPhone 16 Pro 512G 二手',
    category: 'iPhone_Pro',
    query: 'iPhone 16 Pro 512G',
    priceMin: 6500,
    priceMax: 9000,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', '128G', '256G', 'ProMax', '15', '14', '13'],
  },
  {
    model: 'iPhone 16 128G 二手',
    category: 'iPhone_标准',
    query: 'iPhone 16 128G',
    priceMin: 3000,
    priceMax: 5000,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', '256G', '512G', 'Pro', 'ProMax', '15', '14', '13'],
  },
  // === P1 批次4: iPad/Mac 存储升级 (6项) ===
  {
    model: 'Mac mini M2 16G 512G 二手',
    category: 'Mac_mini',
    query: 'Mac mini M2 16G 512G',
    priceMin: 3000,
    priceMax: 5000,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', '8G', '256G', 'M1', 'M3', 'M4'],
  },
  {
    model: 'MacBook Air M2 16G 512G 二手',
    category: 'MacBook_Air',
    query: 'MacBook Air M2 16G 512G',
    priceMin: 3500,
    priceMax: 5500,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', '8G', '256G', 'M1', 'M3', 'Pro', '15寸'],
  },
  {
    model: 'iPad Pro M2 11寸 512G 二手',
    category: 'iPad_Pro',
    query: 'iPad Pro M2 11寸 512G',
    priceMin: 4000,
    priceMax: 6500,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', '256G', '128G', 'M4', 'M1', '13寸', '12.9'],
  },
  {
    model: 'iPad Pro M2 13寸 512G 二手',
    category: 'iPad_Pro',
    query: 'iPad Pro M2 13寸 512G',
    priceMin: 5000,
    priceMax: 8000,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', '256G', '128G', 'M4', 'M1', '11寸', '12.9'],
  },
  {
    model: 'iPad Air M2 11寸 256G 二手',
    category: 'iPad_Air',
    query: 'iPad Air M2 11寸 256G',
    priceMin: 3000,
    priceMax: 4500,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', '128G', '64G', 'M4', 'M1', '13寸', 'Pro'],
  },
  {
    model: 'iPad Air M2 13寸 256G 二手',
    category: 'iPad_Air',
    query: 'iPad Air M2 13寸 256G',
    priceMin: 3500,
    priceMax: 5500,
    excludeKeywords: ['维修', '翻新', '换屏', '配件', '壳', '租', '远程', '128G', '64G', 'M4', 'M1', '11寸', 'Pro'],
  },
];

async function main() {
  console.log('=== 闲鱼二手价采集 v3 (connectOverCDP) ===');
  console.log('目标机型: ' + TARGETS.length + ' 个\n');

  // Step 1: 启动真实 Chrome(remote debugging 模式)
  console.log('启动 Chrome(remote debugging 模式)...');
  if (!existsSync(USER_DATA_DIR)) mkdirSync(USER_DATA_DIR, { recursive: true });

  // 查找 Chrome 路径
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  ];
  let chromePath = null;
  for (const p of chromePaths) {
    if (existsSync(p)) {
      chromePath = p;
      break;
    }
  }

  if (chromePath) {
    console.log(`Chrome 路径: ${chromePath}`);
    exec(`"${chromePath}" --remote-debugging-port=${CDP_PORT} --user-data-dir="${USER_DATA_DIR}" "https://www.goofish.com/"`, (err) => {
      if (err) console.error('启动 Chrome 失败:', err.message);
    });
  } else {
    console.log('未找到 Chrome,尝试用默认浏览器启动...');
    exec(`start chrome --remote-debugging-port=${CDP_PORT} --user-data-dir="${USER_DATA_DIR}" "https://www.goofish.com/"`, (err) => {
      if (err) console.error('启动 Chrome 失败:', err.message);
    });
  }

  // 等待 Chrome 启动
  console.log('等待 Chrome 启动...');
  await sleep(5000);

  // Step 2: 通过 CDP 连接到真实 Chrome
  console.log(`连接到 Chrome (端口 ${CDP_PORT})...`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  } catch (err) {
    console.error(`✗ 无法连接到 Chrome: ${err.message}`);
    console.error('请确保 Chrome 已以 --remote-debugging-port=9222 启动');
    process.exit(1);
  }

  // 获取已打开的页面
  const contexts = browser.contexts();
  const pages = contexts[0]?.pages() || [];
  let page = pages.find((p) => p.url().includes('goofish')) || pages[0];

  if (!page) {
    page = await contexts[0].newPage();
    await page.goto('https://www.goofish.com/');
  }

  console.log('\n>>> 请在 Chrome 中扫码登录闲鱼 <<<');
  console.log('登录成功后脚本自动继续(超时 5 分钟)\n');

  // 等待登录
  try {
    await page.waitForFunction(
      () =>
        !!document.querySelector(
          '[class*="avatar"], [class*="Avatar"], [class*="user-info"], [class*="userInfo"]',
        ) ||
        (document.cookie.includes('_m_h5_tk') && !location.href.includes('login')),
      { timeout: 300000 },
    );
    await page.waitForTimeout(5000);
    console.log('✓ 登录成功,开始采集...\n');
  } catch {
    console.error('✗ 登录超时');
    process.exit(1);
  }

  // Step 3: 依次搜索目标机型
  const results = [];
  for (let i = 0; i < TARGETS.length; i++) {
    const target = TARGETS[i];
    console.log(`[${i + 1}/${TARGETS.length}] 搜索: ${target.model}`);

    // 设置 API 响应拦截
    const apiResponses = [];
    const responseHandler = async (response) => {
      const url = response.url();
      const type = response.request().resourceType();
      if (type === 'xhr' || type === 'fetch') {
        try {
          const ct = response.headers()['content-type'] || '';
          if (ct.includes('json') || ct.includes('javascript') || ct.includes('text')) {
            const text = await response.text();
            if (
              text.includes('price') ||
              text.includes('Price') ||
              text.includes('¥') ||
              text.includes('title')
            ) {
              apiResponses.push({ url, text: text.slice(0, 80000), type, ct });
            }
          }
        } catch {
          // 忽略
        }
      }
    };
    page.on('response', responseHandler);

    const url = `https://www.goofish.com/search?q=${encodeURIComponent(target.query)}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // 反爬: 模拟人类浏览节奏,先等待较长时间让页面初始渲染
      await page.waitForTimeout(6000);
      // 反爬: 模拟人类鼠标移动
      await page.mouse.move(400 + Math.random() * 200, 300 + Math.random() * 200);
      await sleep(1000 + Math.random() * 2000);
      await autoScroll(page);
      // 反爬: 滚动后等待较长时间让 API 响应
      await page.waitForTimeout(5000);
      // 反爬: 再滚动一次,触发更多加载
      await autoScroll(page);
      await page.waitForTimeout(3000);

      // 从拦截的 API 响应中提取价格
      const apiPrices = extractPricesFromApiResponses(apiResponses, target);
      // 从 DOM 提取(双保险)
      const domPrices = await extractPricesFromDom(page, target);
      const allPrices = [...new Set([...apiPrices, ...domPrices])].sort((a, b) => a - b);

      console.log(`  API 响应: ${apiResponses.length} 个, API 价格: ${apiPrices.length} 个, DOM 价格: ${domPrices.length} 个`);
      console.log(`  有效价格(${allPrices.length}个): [${allPrices.join(', ')}]`);

      const median = calculateMedian(allPrices);
      const range = allPrices.length > 0 ? [Math.min(...allPrices), Math.max(...allPrices)] : null;
      console.log(`  中位价: ${median ?? '无'}${range ? ` (区间 ${range[0]}-${range[1]})` : ''}\n`);

      results.push({
        model: target.model,
        category: target.category,
        query: target.query,
        xianyu_median_price: median,
        xianyu_price_range: range,
        xianyu_sample_count: allPrices.length,
        xianyu_prices: allPrices,
        api_response_count: apiResponses.length,
        search_date: new Date().toISOString().split('T')[0],
        confidence: allPrices.length >= 3 ? '中' : allPrices.length > 0 ? '低' : '无',
        source: '闲鱼(goofish.com)真实浏览器 CDP 连接 + API 拦截',
        note:
          allPrices.length > 0
            ? `闲鱼搜索'${target.query}'拦截${apiResponses.length}个API响应,提取${allPrices.length}个有效价格。挂单价非实付,实际成交低5-10%`
            : `未采集到有效价格(API响应${apiResponses.length}个)`,
      });

      // 保存第一个机型的 API 响应用于调试
      if (i === 0 && apiResponses.length > 0) {
        writeFileSync(
          'scripts/debug/xianyu-api-response-v3.json',
          JSON.stringify(
            apiResponses.slice(0, 3).map((r) => ({
              url: r.url,
              type: r.type,
              contentType: r.ct,
              text: r.text.slice(0, 5000),
            })),
            null,
            2,
          ),
          'utf-8',
        );
        console.log(`  [调试] API 响应已保存到 scripts/debug/xianyu-api-response-v3.json`);
      }
    } catch (err) {
      console.error(`  ✗ 采集失败: ${err.message}\n`);
      results.push({
        model: target.model,
        category: target.category,
        query: target.query,
        xianyu_median_price: null,
        xianyu_price_range: null,
        xianyu_sample_count: 0,
        xianyu_prices: [],
        search_date: new Date().toISOString().split('T')[0],
        confidence: '无',
        source: '闲鱼(goofish.com)真实浏览器 CDP 连接',
        note: `采集失败: ${err.message}`,
      });
    }
    page.off('response', responseHandler);
    // 反爬: 搜索间隔加长 + 随机延迟,模拟人类操作节奏
    await sleep(3000 + Math.random() * 4000);
  }

  const outputPath = 'scripts/xianyu-prices-batch2.json';
  writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log('=== 采集完成 ===');
  console.log(`结果已保存到 ${outputPath}`);
  console.log('\n注意: Chrome 仍在运行,可手动关闭。');

  // 不关闭浏览器(因为是用户手动启动的)
  // browser.close() 只断开 CDP 连接,不关闭 Chrome
  await browser.close();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractPricesFromApiResponses(apiResponses, target) {
  const prices = [];
  for (const resp of apiResponses) {
    try {
      let jsonStr = resp.text;
      // JSONP 提取
      const jsonpMatch = jsonStr.match(/mtopjsonp\d*\((.*)\)/s);
      if (jsonpMatch) jsonStr = jsonpMatch[1];
      const data = JSON.parse(jsonStr);
      findPriceFields(data, target, prices);
    } catch {
      // 忽略
    }
  }
  return prices;
}

function findPriceFields(obj, target, prices, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (/price/i.test(key) && (typeof val === 'number' || typeof val === 'string')) {
      let num;
      if (typeof val === 'number') {
        num = val;
      } else {
        const m = val.match(/[\d.]+/);
        num = m ? parseFloat(m[0]) : null;
      }
      if (num && num > 10000 && num < 1000000) num = num / 100; // 分转元
      if (num && num >= target.priceMin && num <= target.priceMax) {
        prices.push(Math.round(num));
      }
    }
    if (val && typeof val === 'object') {
      findPriceFields(val, target, prices, depth + 1);
    }
  }
}

async function extractPricesFromDom(page, target) {
  const items = await page.evaluate(() => {
    const results = [];
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.children.length === 0 || el.children.length <= 2) {
        const text = (el.textContent || '').trim();
        const match = text.match(/[¥￥]\s*(\d{3,5}(?:\.\d{1,2})?)|(\d{3,5}(?:\.\d{1,2})?)\s*元/);
        if (match) {
          const price = parseFloat(match[1] || match[2]);
          if (price >= 100 && price <= 50000) {
            const parent = el.parentElement;
            const context = parent ? (parent.textContent || '').slice(0, 200) : text;
            results.push({ price, context });
          }
        }
      }
    }
    return results;
  });

  return items
    .filter((item) => {
      if (item.price < target.priceMin || item.price > target.priceMax) return false;
      for (const kw of target.excludeKeywords) {
        if (item.context.includes(kw)) return false;
      }
      return true;
    })
    .map((item) => Math.round(item.price));
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 400);
        total += 400;
        if (total >= document.body.scrollHeight || total > 4000) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

function calculateMedian(prices) {
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

main().catch((err) => {
  console.error('采集失败:', err);
  process.exit(1);
});
