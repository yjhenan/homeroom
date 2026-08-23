/**
 * 教学日历：覆盖表存取、老数据归一化、应上课计算（假期/调休补课）
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createRepo } from '@/repo/index';
import { calendarOf, isSchoolDay, nextSchoolDay, schoolDaysSoFar, workdaysBetween } from '@/utils/date';
import type { Calendar } from '@/utils/date';

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

  it('isSchoolDay / schoolDaysSoFar / nextSchoolDay：上课日推导', () => {
    const start = '2026-09-01';
    const end = '2027-01-20';
    expect(isSchoolDay('2026-09-01', start, end)).toBe(true); // 周二开学
    expect(isSchoolDay('2026-09-05', start, end)).toBe(false); // 周六
    expect(isSchoolDay('2026-08-25', start, end)).toBe(false); // 范围外周二
    const cal: Calendar = { '2026-09-03': 'holiday', '2026-09-05': 'school', '2026-08-25': 'school' };
    expect(isSchoolDay('2026-09-03', start, end, cal)).toBe(false);
    expect(isSchoolDay('2026-09-05', start, end, cal)).toBe(true);
    expect(isSchoolDay('2026-08-25', start, end, cal)).toBe(true);

    expect(schoolDaysSoFar(start, end, {}, '2026-09-11')).toBe(9); // 09-01(二)~09-11(五) 共 9 个工作日
    expect(schoolDaysSoFar(start, end, { '2026-09-03': 'holiday' }, '2026-09-11')).toBe(8); // 周四放假
    expect(schoolDaysSoFar(start, end, { '2026-08-25': 'school' }, '2026-09-11')).toBe(10); // 范围外军训计入
    expect(schoolDaysSoFar(start, end, { '2026-08-25': 'school' }, '2026-08-24')).toBe(0); // 尚未发生
    expect(schoolDaysSoFar(start, end, {}, '2026-08-31')).toBe(0); // 开学前恒 0
    expect(schoolDaysSoFar(start, end, { '2026-08-26': 'holiday' }, '2026-09-11')).toBe(9); // 范围外 holiday 无效果

    expect(nextSchoolDay('2026-09-05', start, end)).toBe('2026-09-07'); // 周六 → 周一
    expect(nextSchoolDay('2026-08-23', start, end)).toBe('2026-09-01'); // 开学前 → 首日
    expect(nextSchoolDay('2026-09-05', start, end, { '2026-09-05': 'school' })).toBe('2026-09-05'); // 当天补课
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

  it('考勤只能录上课日（日历是唯一事实：周末/假期/学期外拒绝，补课标记后可录）', async () => {
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

    // 范围外（开学前/结束后）拒绝
    await expect(
      repo.saveAttendanceForDate(sem.id, '2026-08-31', [{ student_id: sid, status: 'late' }])
    ).rejects.toThrow(/不是上课日/);
    await expect(
      repo.saveAttendanceForDate(sem.id, '2027-01-21', [{ student_id: sid, status: 'late' }])
    ).rejects.toThrow(/不是上课日/);
    // 范围内周六，未标记补课 → 非上课日，拒绝
    await expect(
      repo.saveAttendanceForDate(sem.id, '2026-09-12', [{ student_id: sid, status: 'late' }])
    ).rejects.toThrow(/不是上课日/);
    // 标记补课后（周末调休）→ 可录
    await repo.setSemesterCalendar(sem.id, { '2026-09-12': 'school' });
    await repo.saveAttendanceForDate(sem.id, '2026-09-12', [{ student_id: sid, status: 'late' }]);
    expect((await repo.getAttendanceByDate(sem.id, '2026-09-12')).length).toBe(1);
    // 范围外工作日标记补课（开学前军训）→ 也可录
    await repo.setSemesterCalendar(sem.id, { '2026-09-12': 'school', '2026-08-25': 'school' });
    await repo.saveAttendanceForDate(sem.id, '2026-08-25', [{ student_id: sid, status: 'sick' }]);
    expect((await repo.getAttendanceByDate(sem.id, '2026-08-25')).length).toBe(1);
  });
});
