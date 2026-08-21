/**
 * 假期与应出勤工作日
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createRepo } from '@/repo/index';
import { workdaysBetween } from '@/utils/date';

describe('假期管理', () => {
  it('设置/读取/更新学期假期', async () => {
    const repo = createRepo();
    const sem = await repo.createSemester({
      id: '2026-2027-1',
      name: '2026-2027学年 第一学期',
      start_date: '2026-09-01',
      end_date: '2027-01-20',
      is_active: true
    });

    await repo.setSemesterHolidays(sem.id, ['2026-10-01', '2026-09-30']);
    let list = (await repo.listSemesters()).find(s => s.id === sem.id)!.holidays;
    expect(list).toEqual(['2026-09-30', '2026-10-01'], '应排序保存');

    await repo.setSemesterHolidays(sem.id, []);
    list = (await repo.listSemesters()).find(s => s.id === sem.id)!.holidays;
    expect(list).toEqual([]);

    await expect(repo.setSemesterHolidays('不存在', [])).rejects.toThrow(/学期不存在/);
  });

  it('归档学期仍可改假期（元数据）', async () => {
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
    await repo.setSemesterHolidays(sem.id, ['2026-10-01']);
    expect((await repo.listSemesters()).find(s => s.id === sem.id)!.holidays).toEqual(['2026-10-01']);
  });

  it('workdaysBetween 排除假期', () => {
    // 2026-09-07（周一）~ 09-11（周五）共 5 个工作日
    expect(workdaysBetween('2026-09-07', '2026-09-11')).toBe(5);
    // 排除周三 09-09
    expect(workdaysBetween('2026-09-07', '2026-09-11', ['2026-09-09'])).toBe(4);
    // 周末本来就不算
    expect(workdaysBetween('2026-09-12', '2026-09-13', [])).toBe(0);
    // start > end
    expect(workdaysBetween('2026-09-11', '2026-09-07')).toBe(0);
  });
});
