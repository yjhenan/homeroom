/**
 * M2 验收（docs/04）：
 * 1. 40 人班级单日考勤录入 ≤30 秒（真实 UI：Excel 导入名单 → 点选异常 → 保存）
 * 2. 刷新留存
 * 3. 360 视图考勤数据与录入一致
 *
 * 运行：pnpm exec tsx scripts/accept-m2.ts   前置：pnpm dev @ 9527
 */
import { chromium } from 'playwright-core';
import assert from 'node:assert';
import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:9527';

const surnames = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴'];
const givens = ['雨轩', '思远', '梦琪', '浩然', '晓彤', '子涵', '俊杰', '紫萱', '博文', '佳怡'];

async function main() {
  // 生成 40 人名单 xlsx
  const aoa: unknown[][] = [['学号*', '姓名*', '性别', '出生日期', '家长电话', '住址', '备注']];
  for (let i = 1; i <= 40; i += 1) {
    aoa.push([
      `26${String(i).padStart(3, '0')}`,
      `${surnames[i % 10]}${givens[(i * 3) % 10]}`,
      i % 2 ? '男' : '女',
      `2010-0${(i % 9) + 1}-15`,
      `139${String(10000000 + i * 137).slice(0, 8)}`,
      `${['阳光', '幸福', '文明', '和平'][i % 4]}小区${(i % 12) + 1}栋`,
      ''
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '学生名单');
  const xlsxPath = path.join(process.cwd(), 'tmp-roster-40.xlsx');
  fs.writeFileSync(xlsxPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const consoleErrors: string[] = [];
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', e => consoleErrors.push(String(e)));

  // 1) UI 导入 40 人名单
  await page.goto(`${BASE}/student`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=新增学生', { timeout: 20000 });
  await page.click('button:has-text("导入")');
  await page.waitForSelector('.n-modal', { timeout: 5000 });
  await page.setInputFiles('.n-modal input[type="file"]', xlsxPath);
  await page.waitForSelector('text=解析完成', { timeout: 10000 });
  const confirmText = await page.locator('.n-modal').textContent();
  assert.ok(confirmText?.includes('新增'), '解析后应进入确认步骤');
  await page.click('.n-modal button:has-text("开始导入")');
  await page.waitForSelector('text=导入完成', { timeout: 15000 });
  console.log('✓ Excel 导入 40 人名单成功（UI 全流程）');

  // 2) 单日考勤：5 人异常（1病假+1事假+1旷课+1迟到+1早退），计时
  await page.goto(`${BASE}/attendance`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.att-card', { timeout: 15000 });
  const cardCount = await page.locator('.att-card').count();
  assert.equal(cardCount, 40, `应有 40 张卡片，实际 ${cardCount}`);

  await page.locator('.n-date-picker input').first().click();
  await page.locator('.n-date-picker input').first().fill('2026-09-07');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);

  const marks = [1, 1, 2, 3, 4, 5]; // 点击次数：病假/病假?/事假/旷课/迟到/早退 —— 6 人异常
  const t0 = Date.now();
  for (let i = 0; i < marks.length; i += 1) {
    const card = page.locator('.att-card').nth(i);
    for (let c = 0; c < marks[i]; c += 1) await card.click();
  }
  await page.click('button:has-text("保存")');
  await page.waitForSelector('text=已保存 2026-09-07 异常 6 人', { timeout: 15000 });
  const elapsed = Date.now() - t0;
  console.log(`✓ 单日考勤（6 人异常 + 保存）耗时 ${elapsed}ms ≤ 30000ms`);
  assert.ok(elapsed <= 30_000, `录入超时：${elapsed}ms`);

  // 3) 刷新留存
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.att-card', { timeout: 15000 });
  await page.locator('.n-date-picker input').first().click();
  await page.locator('.n-date-picker input').first().fill('2026-09-07');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const tags = await page.locator('.att-card .n-tag').allTextContents();
  const abnormal = tags.filter(t => t && t !== '出勤').length;
  assert.equal(abnormal, 6, `刷新后应回显 6 个异常，实际 ${abnormal}`);
  console.log('✓ 刷新后异常回显一致');

  // 4) 360 一致性：第一个异常学生（病假）的 360 视图
  await page.goto(`${BASE}/student`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.n-data-table', { timeout: 15000 });
  await page.locator('.n-data-table tbody tr').first().click({ button: 'right' });
  await page.waitForSelector('.n-dropdown-option', { timeout: 5000 });
  await page.locator('.n-dropdown-option').filter({ hasText: '详情' }).first().click();
  await page.waitForSelector('text=出勤率', { timeout: 15000 });
  await page.waitForTimeout(800);
  const stats = await page.locator('.n-statistic').allTextContents();
  console.log('  360 统计:', stats.join(' / '));
  // 日历口径：9/7 是上课日但"今天"在开学前 → 应出勤 0，出勤率显示 —；异常 1 条（病假）
  assert.ok(stats[0].includes('—'), `开学前应出勤为 0 → 出勤率应为 —，实际 ${stats[0]}`);
  assert.ok(stats[3].includes('1'), `异常天数应为 1，实际 ${stats[3]}`);
  const hist = await page.locator('.n-data-table tbody tr').count();
  assert.equal(hist, 1, `单人历史应 1 行，实际 ${hist}`);
  assert.ok((await page.locator('.n-data-table').textContent())?.includes('2026-09-07'), '日期应一致');
  console.log('✓ 360 视图考勤与录入一致（异常 1 天病假 / 09-07）');

  const realErrors = consoleErrors.filter(e => !e.includes('favicon'));
  console.log(realErrors.length ? `⚠ 控制台错误: ${realErrors.join(' | ')}` : '✓ 无控制台错误');

  await page.screenshot({ path: 'drive-m2-accept.png', fullPage: false });
  await browser.close();
  fs.unlinkSync(xlsxPath);
  console.log('\nM2 浏览器验收全部通过 ✔');
}

main().catch(err => {
  console.error('✗ 验收失败:', err);
  process.exit(1);
});
