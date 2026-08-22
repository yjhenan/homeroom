/**
 * 教学日历：覆盖表存取、老数据归一化、应上课计算（假期/调休补课）
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createRepo } from '@/repo/index';
import { calendarOf, workdaysBetween } from '@/utils/date';

describe('教学日历', () => {
  it('设置/读取学期日历覆盖表', async () => {
    const repo = createRepo();
    const sem = await repo.createSemester({
      id: '2026-2027-1',
      name: '2026-2027学年 第一学期',
      start_date: '2026-09-01',
      end_date: '2027-01-20',
      is_active: true
    });

    await repo.setSemesterCalendar(sem.id, {
      '2026-10-01': 'holiday',
      '2026-10-03': 'holiday',
      '2026-09-26': 'school'
    });
    const stored = (await repo.listSemesters()).find(s => s.id === sem.id)!.calendar;
    expect(stored).toEqual({ '2026-10-01': 'holiday', '2026-10-03': 'holiday', '2026-09-26': 'school' });

    await repo.setSemesterCalendar(sem.id, {});
    expect((await repo.listSemesters()).find(s => s.id === sem.id)!.calendar).toEqual({});

    await expect(repo.setSemesterCalendar('不存在', {})).rejects.toThrow(/学期不存在/);
  });

  it('归档学期仍可改日历（元数据）', async () => {
    const repo = createRepo();
    const sem = await repo.createSemester({
      id: '2098-2099-1',
      name: '学期',
      start_date: '2026-09-01',
      end_date: '2027-01-20',
      is_active: true
    });
    const sem2 = await repo.createSemester({
      id: '2098-2099-2',
      name: '学期二',
      start_date: '2027-02-20',
      end_date: '2027-06-30'
    });
    await repo.setSemesterArchived(sem2.id, true);
    await repo.setSemesterCalendar(sem.id, { '2026-10-01': 'holiday' });
    expect((await repo.listSemesters()).find(s => s.id === sem.id)!.calendar).toEqual({ '2026-10-01': 'holiday' });
  });

  it('calendarOf：老 holidays 列表归一化为 holiday 标记，calendar 优先', () => {
    expect(calendarOf({ holidays: ['2026-10-01'], calendar: { '2026-10-02': 'holiday' } })).toEqual({
      '2026-10-01': 'holiday',
      '2026-10-02': 'holiday'
    });
    // 同日冲突时 calendar 覆盖
    expect(calendarOf({ holidays: ['2026-10-01'], calendar: { '2026-10-01': 'school' } })).toEqual({
      '2026-10-01': 'school'
    });
    expect(calendarOf(null)).toEqual({});
  });

  it('workdaysBetween：假期减、补课加', () => {
    // 2026-09-07（周一）~ 09-11（周五）共 5 个工作日
    expect(workdaysBetween('2026-09-07', '2026-09-11')).toBe(5);
    // 周三放假 → 4
    expect(workdaysBetween('2026-09-07', '2026-09-11', { '2026-09-09': 'holiday' })).toBe(4);
    // 09-12/13 是周六日；把周六标为补课 → 09-07~09-12 共 6
    expect(workdaysBetween('2026-09-07', '2026-09-12', { '2026-09-12': 'school' })).toBe(6);
    // 周末默认不计
    expect(workdaysBetween('2026-09-12', '2026-09-13')).toBe(0);
    // start > end
    expect(workdaysBetween('2026-09-11', '2026-09-07')).toBe(0);
  });

  it('考勤日期必须在学期范围内（范围外拒绝，含周末调休在内均可录）', async () => {
    const repo = createRepo();
    const sem = await repo.createSemester({
      id: '2097-2098-1',
      name: '学期',
      start_date: '2026-09-01',
      end_date: '2027-01-20',
      is_active: true
    });
    await repo.importStudents([{ name: '甲', student_no: 'R001', gender: 'male' }], sem.id, 'skip');
    const sid = (await repo.listStudents(sem.id))[0].id;

    await expect(
      repo.saveAttendanceForDate(sem.id, '2026-08-31', [{ student_id: sid, status: 'present' }])
    ).rejects.toThrow(/不在本学期范围内/);
    await expect(
      repo.saveAttendanceForDate(sem.id, '2027-01-21', [{ student_id: sid, status: 'present' }])
    ).rejects.toThrow(/不在本学期范围内/);
    // 周末（2026-09-12 周六）在范围内：可录（校历补课场景）；present 不落库，用 late 验证
    await repo.saveAttendanceForDate(sem.id, '2026-09-12', [{ student_id: sid, status: 'late' }]);
    expect((await repo.getAttendanceByDate(sem.id, '2026-09-12')).length).toBe(1);
  });
});
