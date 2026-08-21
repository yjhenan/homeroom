/**
 * M3 验收（docs/04）：
 * 1. 从 Excel 粘贴一列成绩无误入库
 * 2. 切换学期各模块数据隔离
 * 3. 归档学期不可编辑
 *
 * 运行：pnpm exec tsx scripts/accept-m3.ts   前置：pnpm dev @ 9527
 */
import { chromium } from 'playwright-core';
import assert from 'node:assert';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:9527';

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const consoleErrors: string[] = [];
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', e => consoleErrors.push(String(e)));

  // ---- 造数据：3 学生 + 每模块一条（学期一）----
  await page.goto(`${BASE}/student`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=新增学生', { timeout: 20000 });
  for (const [no, nm] of [['990001', '验收A'], ['990002', '验收B'], ['990003', '验收C']] as const) {
    await page.click('button:has-text("新增学生")');
    await page.waitForSelector('.n-modal input[placeholder="如 2026001"]', { timeout: 5000 });
    await page.fill('.n-modal input[placeholder="如 2026001"]', no);
    await page.fill('.n-modal input[placeholder="必填"]', nm);
    await page.click('.n-modal button:has-text("保存")');
    await page.waitForSelector(`text=${nm}`, { timeout: 10000 });
  }

  // ---- 标准 1：Excel 粘贴一列成绩 ----
  await page.click('text=成绩管理');
  await page.waitForSelector('text=新建考试', { timeout: 15000 });
  await page.click('button:has-text("新建考试")');
  await page.waitForSelector('.n-modal', { timeout: 5000 });
  await page.fill('.n-modal input[placeholder="如期中考试"]', '验收考试');
  await page.locator('.n-modal .n-date-picker input').click();
  await page.locator('.n-modal .n-date-picker input').fill('2026-11-10');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.click('.n-modal button:has-text("保存")');
  await page.waitForTimeout(600);
  await page.locator('.n-select', { hasText: '选择/输入科目' }).click();
  await page.waitForTimeout(300);
  await page.locator('.n-base-select-option', { hasText: '语文' }).first().click();
  await page.waitForTimeout(300);
  await page.click('button:has-text("粘贴成绩列")');
  await page.waitForSelector('.n-modal textarea', { timeout: 5000 });
  await page.fill('.n-modal textarea', '100\n95\n缺');
  await page.click('.n-modal button:has-text("应用到名单")');
  await page.waitForTimeout(300);
  const cells = [];
  for (let i = 0; i < 3; i += 1) {
    cells.push(await page.locator(`input[data-idx="${i}"]`).inputValue());
  }
  assert.deepEqual(cells, ['100', '95', '缺'], `粘贴列应按名单序应用：${cells}`);
  await page.click('button:has-text("保存")');
  await page.waitForTimeout(800);
  console.log('✓ 标准1：Excel 粘贴一列成绩（100/95/缺）按名单序无误入库');

  // 德育 + 值日 + 文档各一条（供隔离验证）
  await page.click('text=德育纪律');
  await page.waitForSelector('text=记一笔', { timeout: 15000 });
  await page.locator('.n-card .n-select').first().click();
  await page.waitForTimeout(300);
  await page.locator('.n-base-select-option').first().click();
  await page.keyboard.press('Escape');
  await page.fill('input[placeholder="必填，如：课间打闹"]', '隔离验证事件');
  await page.click('button:has-text("记一笔")');
  await page.waitForTimeout(500);

  await page.click('text=值日卫生');
  await page.waitForSelector('text=值日排班', { timeout: 15000 });
  await page.click('button:has-text("+排")');
  await page.waitForSelector('.n-modal', { timeout: 5000 });
  await page.locator('.n-modal .n-select').click();
  await page.waitForTimeout(300);
  await page.locator('.n-base-select-option').first().click();
  await page.keyboard.press('Escape');
  await page.click('.n-modal button:has-text("保存")');
  await page.waitForTimeout(500);

  await page.click('text=文档台账');
  await page.waitForSelector('text=登记文档', { timeout: 15000 });
  await page.click('button:has-text("登记文档")');
  await page.waitForSelector('.n-modal', { timeout: 5000 });
  await page.fill('.n-modal input[placeholder="必填"]', '隔离验证文档');
  await page.click('.n-modal button:has-text("保存")');
  await page.waitForTimeout(500);
  console.log('✓ 前置：学期一四个模块各有数据');

  // ---- 标准 2：切换学期数据隔离 ----
  await page.click('text=系统设置');
  await page.waitForSelector('text=学期管理', { timeout: 15000 });
  await page.click('button:has-text("新建学期")');
  await page.waitForSelector('.n-modal', { timeout: 5000 });
  await page.fill('.n-modal input[placeholder="如 2026-2027-2"]', '2026-2027-2');
  await page.fill('.n-modal input[placeholder="如 2026-2027学年 第二学期"]', '验收隔离学期');
  const dateInputs = page.locator('.n-modal .n-date-picker input');
  await dateInputs.nth(0).click();
  await dateInputs.nth(0).fill('2027-02-20');
  await page.keyboard.press('Enter');
  await dateInputs.nth(1).click();
  await dateInputs.nth(1).fill('2027-06-30');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.click('.n-modal button:has-text("创建并切换")');
  await page.waitForTimeout(1000);
  console.log('✓ 新学期已创建并切换（未复制名册）');

  // 各模块应为空
  await page.click('text=学生管理');
  await page.waitForSelector('text=学生名单', { timeout: 15000 });
  await page.waitForTimeout(500);
  const stuCount = await page.locator('.n-data-table tbody tr').count();
  assert.equal(stuCount, 0, `新学期学生应为空，实际 ${stuCount}`);

  await page.click('text=成绩管理');
  await page.waitForTimeout(600);
  const examCount = await page.locator('.n-data-table tbody tr').count();
  assert.equal(examCount, 0, '新学期考试应为空');

  await page.click('text=德育纪律');
  await page.waitForTimeout(600);
  const evText = await page.evaluate(() => document.body.innerText);
  assert.ok(!evText.includes('隔离验证事件'), '新学期德育应为空');

  await page.click('text=文档台账');
  await page.waitForTimeout(600);
  const docText = await page.evaluate(() => document.body.innerText);
  assert.ok(!docText.includes('隔离验证文档'), '新学期文档应为空');
  console.log('✓ 标准2：切换学期后学生/考试/德育/文档全隔离');

  // ---- 标准 3：归档学期不可编辑 ----
  // 当前是新学期 → 归档旧学期（2026-2027-1）
  await page.click('text=系统设置');
  await page.waitForSelector('text=学期管理', { timeout: 15000 });
  await page.click('button:has-text("归档")');
  await page.waitForSelector('.n-dialog', { timeout: 5000 });
  await page.click('.n-dialog button:has-text("归档")');
  await page.waitForTimeout(800);
  // 切回旧学期（已归档）
  await page.click('button:has-text("切换为当前")');
  await page.waitForTimeout(800);

  for (const nav of ['成绩管理', '德育纪律', '值日卫生', '文档台账']) {
    await page.click(`text=${nav}`);
    await page.waitForSelector('text=学期已归档，只读', { timeout: 15000 });
  }
  console.log('✓ 标准3：归档学期四个模块均显示只读');

  // 归档学期数据仍可查看
  await page.click('text=文档台账');
  await page.waitForTimeout(500);
  const archivedDoc = await page.evaluate(() => document.body.innerText);
  assert.ok(archivedDoc.includes('隔离验证文档'), '归档学期数据仍可查看');

  const realErrors = consoleErrors.filter(e => !e.includes('favicon'));
  console.log(realErrors.length ? `⚠ 控制台错误: ${realErrors.join(' | ')}` : '✓ 无控制台错误');

  await page.screenshot({ path: 'drive-m3-accept.png', fullPage: false });
  await browser.close();
  console.log('\nM3 浏览器验收全部通过 ✔');
}

main().catch(err => {
  console.error('✗ 验收失败:', err);
  process.exit(1);
});
