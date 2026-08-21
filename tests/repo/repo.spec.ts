/**
 * 由 scripts/smoke-repo.ts 迁移而来（仓储：学期学生名册考勤备份）
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createRepo } from '@/repo/index';
import type { StudentInput } from '@/repo/types';

const repo = createRepo();

describe('仓储：学期学生名册考勤备份', () => {
  it('全流程：学期 → 学生 CRUD → 导入 → 考勤 → 备份往返 → 级联删除', async () => {
    const sem = await repo.createSemester({
      id: '2026-2027-1',
      name: '2026-2027学年 第一学期',
      start_date: '2026-09-01',
      end_date: '2027-01-20',
      is_active: true
    });
    expect(sem.id).toBe('2026-2027-1');

    const sem2 = await repo.createSemester({
      id: '2026-2027-2',
      name: '2026-2027学年 第二学期',
      start_date: '2027-02-20',
      end_date: '2027-06-30'
    });
    expect((await repo.getActiveSemester())?.id).toBe('2026-2027-1');

    await repo.setActiveSemester(sem2.id);
    expect((await repo.getActiveSemester())?.id).toBe('2026-2027-2');

    // ---- 学生 CRUD ----
    const stu = await repo.createStudent(
      { name: '张三', student_no: '2026001', gender: 'male', parent_contact: '13800000000' },
      sem.id
    );
    expect(stu.id.length).toBe(12);

    await expect(
      repo.createStudent({ name: '重复学号', student_no: '2026001', gender: 'unknown' }, sem.id)
    ).rejects.toThrow(/学号已存在/);

    const updated = await repo.updateStudent(stu.id, { notes: '测试备注' });
    expect(updated.notes).toBe('测试备注');
    expect(updated.student_no).toBe('2026001');

    const listed = await repo.listStudents(sem.id);
    expect(listed.length).toBe(1);
    expect(listed[0].enrollment?.status).toBe('active');

    // ---- 删除提示计数 ----
    const counts = await repo.countStudentRecords(stu.id);
    expect(counts.enrollments).toBe(1);

    // ---- 批量导入（40 行，含覆盖/跳过）----
    const rows: StudentInput[] = Array.from({ length: 40 }, (_, i) => ({
      name: `学生${String(i + 1).padStart(2, '0')}`,
      student_no: `S${String(i + 1).padStart(3, '0')}`,
      gender: i % 2 === 0 ? 'female' : 'male'
    }));
    // 一行与张三同学号（overwrite 应更新而非新增）
    rows.push({ name: '张三改名', student_no: '2026001', gender: 'male' });

    const r1 = await repo.importStudents(rows, sem.id, 'overwrite');
    expect(r1.created).toBe(40);
    expect(r1.updated).toBe(1);
    expect((await repo.listStudents(sem.id)).length).toBe(41);

    // skip 策略：全部已存在
    const r2 = await repo.importStudents(rows.slice(0, 5), sem.id, 'skip');
    expect(r2.skipped).toBe(5);
    expect(r2.created).toBe(0);

    // 已存在学生导入到新学期 → 挂名册不重复建学生
    const r3 = await repo.importStudents(rows.slice(0, 3), sem2.id, 'skip');
    expect(r3.created).toBe(0);
    expect(r3.skipped).toBe(3);
    expect((await repo.listStudents(sem2.id)).length).toBe(3);
    expect((await repo.listStudents()).length).toBe(41);

    // ---- 设置 ----
    await repo.setSetting('currentSemesterId', '2026-2027-1');
    expect(await repo.getSetting<string>('currentSemesterId')).toBe('2026-2027-1');
    expect(await repo.getSetting('不存在')).toBe(null);

    // ---- 考勤：按日保存/查询/全量替换 ----
    const roster = await repo.listStudents(sem.id);
    const dayRows = roster.slice(0, 40).map((s, i) => ({
      student_id: s.id,
      status: (['present', 'late', 'sick', 'personal', 'absent', 'early_leave'] as const)[i % 6],
      ...(i % 6 !== 0 ? { remark: `备注${i}` } : {})
    }));
    await repo.saveAttendanceForDate(sem.id, '2026-09-01', dayRows);

    let dayList = await repo.getAttendanceByDate(sem.id, '2026-09-01');
    expect(dayList.length).toBe(40);
    expect(dayList.filter(r => r.status === 'late').length).toBe(7);

    // 重存同一天 → 全量替换不叠加
    await repo.saveAttendanceForDate(sem.id, '2026-09-01', dayRows.slice(0, 5));
    dayList = await repo.getAttendanceByDate(sem.id, '2026-09-01');
    expect(dayList.length).toBe(5);

    // 范围/学生/状态查询
    await repo.saveAttendanceForDate(sem.id, '2026-09-02', dayRows.slice(0, 10));
    await repo.saveAttendanceForDate(sem2.id, '2027-03-01', dayRows.slice(3, 6)); // 另一学期（日期不重叠，避开唯一索引）
    const range = await repo.queryAttendance({ semesterId: sem.id, from: '2026-09-01', to: '2026-09-30' });
    expect(range.length).toBe(15); // 5 + 10，另一学期不算
    const onlyLate = await repo.queryAttendance({ semesterId: sem.id, statuses: ['late'] });
    expect(onlyLate.length > 0 && onlyLate.every(r => r.status === 'late')).toBeTruthy();
    const oneStudent = await repo.queryAttendance({ semesterId: sem.id, studentId: dayRows[0].student_id });
    expect(oneStudent.length).toBe(2); // 两天各一条

    // ---- 备份往返（含 attendance）----
    const backup = await repo.exportAll();
    expect(backup.version).toBe(1);
    expect(backup.students.length).toBe(41);
    expect(backup.enrollments.length).toBe(44);
    expect(backup.attendance?.length).toBe(18);

    const repo2 = createRepo(); // 新实例（同库），先清空再导入验证全量替换
    const fresh = await repo2.exportAll();
    expect(fresh.students.length).toBe(41); // 同一 IndexedDB 库，仍是有数据状态
    await repo2.importAll(JSON.parse(JSON.stringify(backup)));
    const restored = await repo2.exportAll();
    expect(restored).toEqual({ ...backup, exportedAt: restored.exportedAt });
    expect((await repo2.listStudents(sem.id)).length).toBe(41);
    expect((await repo2.getAttendanceByDate(sem.id, '2026-09-02')).length).toBe(10);

    // M1 老备份（无 attendance 字段）可导入
    await repo2.importAll({ ...JSON.parse(JSON.stringify(backup)), attendance: undefined });
    expect((await repo2.getAttendanceByDate(sem.id, '2026-09-02')).length).toBe(0);
    // 还原数据
    await repo2.importAll(JSON.parse(JSON.stringify(backup)));

    // ---- 删除学生硬删名册与考勤 ----
    const countsBefore = await repo.countStudentRecords(dayRows[0].student_id);
    expect(countsBefore.attendance).toBe(2);
    const removed = await repo.deleteStudent(dayRows[0].student_id);
    expect(removed.enrollments).toBe(1); // 仅 sem 一条名册（sem2 挂的是 S001-S003）
    expect(removed.attendance).toBe(2); // sem 两天各一条
    expect((await repo.listStudents()).length).toBe(40);

    await expect(repo.importAll({ version: 2 } as never)).rejects.toThrow(/不支持的备份版本/);

    console.log('\n全部通过 ✔');
  });
});
