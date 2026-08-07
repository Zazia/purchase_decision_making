#!/usr/bin/env node
/**
 * debug-xianyu-page.mjs — 调试闲鱼页面 DOM 结构
 *
 * 打开闲鱼搜索页,保存 HTML + 截图,提取所有可能的价格元素,
 * 帮助分析 fetch-xianyu-prices.mjs 提取失败的原因。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const QUERY = 'Mac mini M2 8G 256G';
const DEBUG_DIR = 'scripts/debug';

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  console.log('打开闲鱼首页,等待扫码登录...');
  await page.goto('https://www.goofish.com/', { waitUntil: 'domcontentloaded' });

  try {
    await page.waitForFunction(
      () =>
        !!document.querySelector(
          '[class*="avatar"], [class*="Avatar"], [class*="user-info"], [class*="userInfo"]',
        ) ||
        (document.cookie.includes('_m_h5_tk') && !location.href.includes('login')),
      { timeout: 300000 },
    );
    await page.waitForTimeout(3000);
    console.log('登录成功');
  } catch {
    console.error('登录超时');
    await browser.close();
    process.exit(1);
  }

  // 打开搜索页
  const url = `https://www.goofish.com/search?q=${encodeURIComponent(QUERY)}`;
  console.log(`\n搜索: ${QUERY}`);
  console.log(`URL: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  // 滚动加载
  await autoScroll(page);
  await page.waitForTimeout(2000);

  // 保存截图
  await page.screenshot({ path: `${DEBUG_DIR}/xianyu-search.png`, fullPage: true });
  console.log(`截图已保存: ${DEBUG_DIR}/xianyu-search.png`);

  // 保存 HTML
  const html = await page.content();
  writeFileSync(`${DEBUG_DIR}/xianyu-search.html`, html, 'utf-8');
  console.log(`HTML 已保存: ${DEBUG_DIR}/xianyu-search.html`);

  // 提取页面所有文本(前 2000 字符)
  const text = await page.evaluate(() => document.body.innerText);
  writeFileSync(`${DEBUG_DIR}/xianyu-search-text.txt`, text, 'utf-8');
  console.log(`页面文本已保存: ${DEBUG_DIR}/xianyu-search-text.txt`);

  // 分析价格模式
  const priceAnalysis = await page.evaluate(() => {
    const results = {
      // 1. 所有包含 ¥ 或 ￥ 的元素
      yuanElements: [],
      // 2. 所有 class 含 price 的元素
      priceClassElements: [],
      // 3. 所有可能的商品卡片
      cardCandidates: [],
      // 4. 页面 URL
      currentUrl: location.href,
      // 5. 页面标题
      title: document.title,
      // 6. body 文本长度
      textLength: document.body.innerText.length,
      // 7. body 文本前 500 字符
      textPreview: document.body.innerText.slice(0, 500),
    };

    // 1. ¥/￥ 元素
    document.querySelectorAll('*').forEach((el) => {
      const t = el.textContent || '';
      if (/[¥￥]\s*\d{3,5}|\d{3,5}\s*元/.test(t) && t.length < 100) {
        results.yuanElements.push({
          tag: el.tagName,
          class: el.className?.toString?.() || '',
          text: t.trim().slice(0, 80),
        });
      }
    });

    // 2. class 含 price 的元素
    document.querySelectorAll('[class*="price"], [class*="Price"]').forEach((el) => {
      results.priceClassElements.push({
        tag: el.tagName,
        class: el.className?.toString?.() || '',
        text: (el.textContent || '').trim().slice(0, 80),
      });
    });

    // 3. 可能的商品卡片(class 含 item/card/feed/product)
    document
      .querySelectorAll('[class*="item"], [class*="card"], [class*="feed"], [class*="product"]')
      .forEach((el) => {
        const t = (el.textContent || '').trim();
        if (t.length > 20 && t.length < 500) {
          results.cardCandidates.push({
            tag: el.tagName,
            class: el.className?.toString?.() || '',
            text: t.slice(0, 150),
          });
        }
      });

    return results;
  });

  writeFileSync(`${DEBUG_DIR}/xianyu-price-analysis.json`, JSON.stringify(priceAnalysis, null, 2), 'utf-8');
  console.log(`\n价格分析已保存: ${DEBUG_DIR}/xianyu-price-analysis.json`);

  console.log('\n=== 分析摘要 ===');
  console.log(`当前 URL: ${priceAnalysis.currentUrl}`);
  console.log(`页面标题: ${priceAnalysis.title}`);
  console.log(`文本长度: ${priceAnalysis.textLength}`);
  console.log(`含 ¥/￥ 元素: ${priceAnalysis.yuanElements.length} 个`);
  console.log(`class 含 price 元素: ${priceAnalysis.priceClassElements.length} 个`);
  console.log(`可能商品卡片: ${priceAnalysis.cardCandidates.length} 个`);

  if (priceAnalysis.yuanElements.length > 0) {
    console.log('\n前 5 个 ¥/￥ 元素:');
    priceAnalysis.yuanElements.slice(0, 5).forEach((el, i) => {
      console.log(`  [${i + 1}] <${el.tag}> class="${el.class}" → "${el.text}"`);
    });
  }

  if (priceAnalysis.priceClassElements.length > 0) {
    console.log('\n前 5 个 price class 元素:');
    priceAnalysis.priceClassElements.slice(0, 5).forEach((el, i) => {
      console.log(`  [${i + 1}] <${el.tag}> class="${el.class}" → "${el.text}"`);
    });
  }

  console.log('\n页面文本前 500 字符:');
  console.log(priceAnalysis.textPreview);

  await browser.close();
  console.log('\n=== 调试完成 ===');
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 300);
        total += 300;
        if (total >= document.body.scrollHeight || total > 3000) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}

main().catch((err) => {
  console.error('调试失败:', err);
  process.exit(1);
});
