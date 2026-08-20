/**
 * ClassRepo(Dexie) 冒烟测试：node 环境跑不通 UI，但仓储逻辑可完整验证
 *
 * 运行：pnpm exec tsx scripts/smoke-repo.ts
 * 退出码 0 = 全部通过
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert';
import { createRepo } from '../src/repo/index';
import type { StudentInput } from '../src/repo/types';

const repo = createRepo();

async function main() {
  // ---- 学期 ----
  const sem = await repo.createSemester({
    id: '2026-2027-1',
    name: '2026-2027学年 第一学期',
    start_date: '2026-09-01',
    end_date: '2027-01-20',
    is_active: true
  });
  assert.equal(sem.id, '2026-2027-1');

  const sem2 = await repo.createSemester({
    id: '2026-2027-2',
    name: '2026-2027学年 第二学期',
    start_date: '2027-02-20',
    end_date: '2027-06-30'
  });
  assert.equal((await repo.getActiveSemester())?.id, '2026-2027-1');

  await repo.setActiveSemester(sem2.id);
  assert.equal((await repo.getActiveSemester())?.id, '2026-2027-2');
  console.log('✓ 学期 CRUD + 唯一 active');

  // ---- 学生 CRUD ----
  const stu = await repo.createStudent(
    { name: '张三', student_no: '2026001', gender: 'male', parent_contact: '13800000000' },
    sem.id
  );
  assert.equal(stu.id.length, 12);

  await assert.rejects(
    () => repo.createStudent({ name: '重复学号', student_no: '2026001', gender: 'unknown' }, sem.id),
    /学号已存在/
  );

  const updated = await repo.updateStudent(stu.id, { notes: '测试备注' });
  assert.equal(updated.notes, '测试备注');
  assert.equal(updated.student_no, '2026001');

  const listed = await repo.listStudents(sem.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].enrollment?.status, 'active');
  console.log('✓ 学生 CRUD + 学号唯一 + 名册联动');

  // ---- 删除提示计数 ----
  const counts = await repo.countStudentRecords(stu.id);
  assert.equal(counts.enrollments, 1);
  console.log('✓ 删除影响计数');

  // ---- 批量导入（40 行，含覆盖/跳过）----
  const rows: StudentInput[] = Array.from({ length: 40 }, (_, i) => ({
    name: `学生${String(i + 1).padStart(2, '0')}`,
    student_no: `S${String(i + 1).padStart(3, '0')}`,
    gender: i % 2 === 0 ? 'female' : 'male'
  }));
  // 一行与张三同学号（overwrite 应更新而非新增）
  rows.push({ name: '张三改名', student_no: '2026001', gender: 'male' });

  const r1 = await repo.importStudents(rows, sem.id, 'overwrite');
  assert.equal(r1.created, 40);
  assert.equal(r1.updated, 1);
  assert.equal((await repo.listStudents(sem.id)).length, 41);

  // skip 策略：全部已存在
  const r2 = await repo.importStudents(rows.slice(0, 5), sem.id, 'skip');
  assert.equal(r2.skipped, 5);
  assert.equal(r2.created, 0);
  console.log('✓ 批量导入 overwrite/skip 两种策略');

  // 已存在学生导入到新学期 → 挂名册不重复建学生
  const r3 = await repo.importStudents(rows.slice(0, 3), sem2.id, 'skip');
  assert.equal(r3.created, 0);
  assert.equal(r3.skipped, 3);
  assert.equal((await repo.listStudents(sem2.id)).length, 3);
  assert.equal((await repo.listStudents()).length, 41);
  console.log('✓ 跨学期导入挂名册不重复建学生');

  // ---- 设置 ----
  await repo.setSetting('currentSemesterId', '2026-2027-1');
  assert.equal(await repo.getSetting<string>('currentSemesterId'), '2026-2027-1');
  assert.equal(await repo.getSetting('不存在'), null);
  console.log('✓ 设置键值');

  // ---- 考勤：按日保存/查询/全量替换 ----
  const roster = await repo.listStudents(sem.id);
  const dayRows = roster.slice(0, 40).map((s, i) => ({
    student_id: s.id,
    status: (['present', 'late', 'sick', 'personal', 'absent', 'early_leave'] as const)[i % 6],
    ...(i % 6 !== 0 ? { remark: `备注${i}` } : {})
  }));
  await repo.saveAttendanceForDate(sem.id, '2026-09-01', dayRows);

  let dayList = await repo.getAttendanceByDate(sem.id, '2026-09-01');
  assert.equal(dayList.length, 40);
  assert.equal(dayList.filter(r => r.status === 'late').length, 7);

  // 重存同一天 → 全量替换不叠加
  await repo.saveAttendanceForDate(sem.id, '2026-09-01', dayRows.slice(0, 5));
  dayList = await repo.getAttendanceByDate(sem.id, '2026-09-01');
  assert.equal(dayList.length, 5);
  console.log('✓ 考勤按日保存与全量替换');

  // 范围/学生/状态查询
  await repo.saveAttendanceForDate(sem.id, '2026-09-02', dayRows.slice(0, 10));
  await repo.saveAttendanceForDate(sem2.id, '2027-03-01', dayRows.slice(3, 6)); // 另一学期（日期不重叠，避开唯一索引）
  const range = await repo.queryAttendance({ semesterId: sem.id, from: '2026-09-01', to: '2026-09-30' });
  assert.equal(range.length, 15); // 5 + 10，另一学期不算
  const onlyLate = await repo.queryAttendance({ semesterId: sem.id, statuses: ['late'] });
  assert.ok(onlyLate.length > 0 && onlyLate.every(r => r.status === 'late'));
  const oneStudent = await repo.queryAttendance({ semesterId: sem.id, studentId: dayRows[0].student_id });
  assert.equal(oneStudent.length, 2); // 两天各一条
  console.log('✓ 考勤查询：范围/状态/学生/学期隔离');

  // ---- 备份往返（含 attendance）----
  const backup = await repo.exportAll();
  assert.equal(backup.version, 1);
  assert.equal(backup.students.length, 41);
  assert.equal(backup.enrollments.length, 44);
  assert.equal(backup.attendance?.length, 18);

  const repo2 = createRepo(); // 新实例（同库），先清空再导入验证全量替换
  const fresh = await repo2.exportAll();
  assert.equal(fresh.students.length, 41); // 同一 IndexedDB 库，仍是有数据状态
  await repo2.importAll(JSON.parse(JSON.stringify(backup)));
  const restored = await repo2.exportAll();
  assert.deepEqual(restored, { ...backup, exportedAt: restored.exportedAt });
  assert.equal((await repo2.listStudents(sem.id)).length, 41);
  assert.equal((await repo2.getAttendanceByDate(sem.id, '2026-09-02')).length, 10);
  console.log('✓ JSON 全量导出/导入往返一致（含 attendance）');

  // M1 老备份（无 attendance 字段）可导入
  await repo2.importAll({ ...JSON.parse(JSON.stringify(backup)), attendance: undefined });
  assert.equal((await repo2.getAttendanceByDate(sem.id, '2026-09-02')).length, 0);
  console.log('✓ 兼容 M1 老备份（缺 attendance 视为空）');
  // 还原数据
  await repo2.importAll(JSON.parse(JSON.stringify(backup)));

  // ---- 删除学生硬删名册与考勤 ----
  const countsBefore = await repo.countStudentRecords(dayRows[0].student_id);
  assert.equal(countsBefore.attendance, 2);
  const removed = await repo.deleteStudent(dayRows[0].student_id);
  assert.equal(removed.enrollments, 1); // 仅 sem 一条名册（sem2 挂的是 S001-S003）
  assert.equal(removed.attendance, 2); // sem 两天各一条
  assert.equal((await repo.listStudents()).length, 40);
  console.log('✓ 硬删学生连带名册与考勤');

  await assert.rejects(() => repo.importAll({ version: 2 } as never), /不支持的备份版本/);
  console.log('✓ 备份版本校验');

  console.log('\n全部通过 ✔');
}

main().catch(err => {
  console.error('✗ 冒烟测试失败:', err);
  process.exit(1);
});
