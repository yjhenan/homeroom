/**
 * M1 验收链路：xlsx 文件 → parseStudentFile → repo.importStudents ≥40 行
 *
 * 运行：pnpm exec tsx scripts/smoke-e2e.ts
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert';
import * as XLSX from 'xlsx';
import { createRepo } from '../src/repo/index';
import { parseStudentFile } from '../src/utils/excel';

async function main() {
  // 模拟一份真实名单：45 行，学号/姓名/性别/出生日期/家长电话/住址，偶有备注
  const aoa: unknown[][] = [['学号*', '姓名*', '性别', '出生日期', '家长电话', '住址', '备注']];
  const surnames = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴'];
  const givens = ['雨轩', '思远', '梦琪', '浩然', '晓彤', '子涵', '俊杰', '紫萱', '博文', '佳怡'];
  for (let i = 1; i <= 45; i++) {
    aoa.push([
      `26${String(i).padStart(3, '0')}`,
      `${surnames[i % 10]}${givens[(i * 3) % 10]}`,
      i % 2 ? '男' : '女',
      new Date(2010 + (i % 3), i % 12, (i % 27) + 1), // Date 单元格
      `139${String(10000000 + i * 137).slice(0, 8)}`,
      `${['阳光', '幸福', '文明', '和平'][i % 4]}小区${i % 12 + 1}栋`,
      i % 7 === 0 ? '午托' : ''
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '学生名单');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  // 1. 解析：零错误
  const parsed = await parseStudentFile(new File([buf], '真实名单.xlsx'));
  if (parsed.errors.length) console.log('DEBUG first errors:', JSON.stringify(parsed.errors.slice(0, 3), null, 2));
  const { rows, errors } = parsed;
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 45);
  console.log(`✓ 解析 45 行名单零错误（含 Date 单元格 → ${rows[0].birth_date}）`);

  // 2. 导入：全量新增
  const repo = createRepo();
  const sem = await repo.createSemester({
    id: '2026-2027-1',
    name: '2026-2027学年 第一学期',
    start_date: '2026-09-01',
    end_date: '2027-01-20',
    is_active: true
  });
  const r = await repo.importStudents(rows, sem.id, 'overwrite');
  assert.deepEqual(r, { created: 45, updated: 0, skipped: 0 });
  assert.equal((await repo.listStudents(sem.id)).length, 45);
  console.log('✓ 45 人全部入库并挂名册');

  // 3. 模拟“刷新”：新仓库实例读同一 IndexedDB 库
  const repoAfterRefresh = createRepo();
  const after = await repoAfterRefresh.listStudents(sem.id);
  assert.equal(after.length, 45);
  assert.equal(after[0].name, rows[0].name);
  console.log('✓ 新实例（等价刷新）读取数据仍为 45 人');

  // 4. JSON 导出再导入往返一致
  const backup = await repoAfterRefresh.exportAll();
  await repoAfterRefresh.importAll(JSON.parse(JSON.stringify(backup)));
  const restored = await repoAfterRefresh.exportAll();
  assert.deepEqual(restored.students, backup.students);
  assert.deepEqual(restored.enrollments, backup.enrollments);
  assert.equal((await repoAfterRefresh.listStudents(sem.id)).length, 45);
  console.log('✓ JSON 导出再导入后数据一致');

  console.log('\nM1 数据链路验收全部通过 ✔');
}

main().catch(err => {
  console.error('✗ 验收失败:', err);
  process.exit(1);
});
