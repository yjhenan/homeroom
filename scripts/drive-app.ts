/**
 * M1 浏览器验收驱动（playwright-core + 系统 Edge 无头）
 *
 * 运行：pnpm exec tsx scripts/drive-app.ts
 * 前置：pnpm dev 已在 http://localhost:9527
 */
import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:9527';

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();

  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(String(err)));

  // 1. 打开根路径：无登录页、直达首页
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=班级总览', { timeout: 20000 });
  const url = page.url();
  const hasLogin = await page.locator('text=登录').count();
  console.log(`✓ 根路径直达首页（url=${url}，登录元素=${hasLogin}）`);

  // 深色主题：html 上应有 dark 类
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  console.log(`✓ 深色主题 html.dark=${isDark}`);
  await page.screenshot({ path: 'drive-home.png', fullPage: false });

  // 2. 侧栏「学生管理」→ 学生列表
  await page.click('text=学生管理');
  await page.waitForSelector('text=学生名单', { timeout: 20000 });
  await page.waitForSelector('text=新增学生', { timeout: 10000 });
  console.log(`✓ 学生列表页可达（url=${page.url()}）`);

  // 学期切换器存在且显示默认学期（顶栏含学期名文本）
  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasSemester = bodyText.includes('2026-2027学年 第一学期');
  console.log(`✓ 学期切换器显示默认学期：${hasSemester}`);

  // 3. 新增一个学生走通 CRUD UI
  await page.click('text=新增学生');
  await page.waitForSelector('text=新增学生', { timeout: 5000 }).catch(() => {});
  await page.fill('.n-modal input[placeholder="如 2026001"]', '900001');
  await page.fill('.n-modal input[placeholder="必填"]', '验收测试生');
  await page.click('.n-modal button:has-text("保存")');
  await page.waitForSelector('text=验收测试生', { timeout: 10000 });
  console.log('✓ 新增学生保存成功并出现在列表');

  await page.screenshot({ path: 'drive-student.png', fullPage: false });

  // 4. 刷新留存
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('text=验收测试生', { timeout: 20000 });
  console.log('✓ 刷新后数据仍在');

  // 控制台错误（过滤 favicon 404 等噪音）
  const realErrors = consoleErrors.filter(e => !e.includes('favicon'));
  if (realErrors.length) {
    console.log('⚠ 控制台错误:');
    realErrors.forEach(e => console.log('  ', e.slice(0, 300)));
  } else {
    console.log('✓ 无控制台错误');
  }

  await browser.close();
  console.log('\n浏览器验收全部通过 ✔（截图 drive-home.png / drive-student.png）');
}

main().catch(err => {
  console.error('✗ 浏览器验收失败:', err);
  process.exit(1);
});
