/**
 * 日期工具：统一走 dayjs，禁止手写 padStart 拼串
 * 约定：业务日期一律 YYYY-MM-DD 字符串（DTO），时间戳 ISO 字符串
 */
import dayjs from 'dayjs';
import type { CalendarMark, Semester } from '@/repo';

/** Date/时间戳/字符串 → YYYY-MM-DD */
export function toDayStr(d: Date | number | string = new Date()): string {
  return dayjs(d).format('YYYY-MM-DD');
}

/** 今天的 YYYY-MM-DD */
export function todayStr(): string {
  return toDayStr(new Date());
}

/** ISO 时间戳（DTO created_at/updated_at） */
export function nowISOStr(): string {
  return new Date().toISOString();
}

/** 本周一（dayjs 无 isoWeek 插件，手动偏移：周日=0 → 周一=0） */
export function mondayOfStr(d: Date | number | string = new Date()): string {
  const day = dayjs(d);
  const offset = (day.day() + 6) % 7;
  return day.subtract(offset, 'day').format('YYYY-MM-DD');
}

/** 教学日历：周一~五上课、周末休息基线；holiday=工作日放假，school=周末补课 */
export type Calendar = Record<string, CalendarMark>;

/** 学期日历归一化：calendar 优先，老数据的 holidays 列表折算成 holiday 标记 */
export function calendarOf(semester: Pick<Semester, 'calendar' | 'holidays'> | null | undefined): Calendar {
  const legacy: Calendar = {};
  (semester?.holidays ?? []).forEach(d => {
    legacy[d] = 'holiday';
  });
  return { ...legacy, ...semester?.calendar };
}

/** [start, end] 内的应上课天数：周一~五基线，按日历覆盖表加减（holiday 减、school 加） */
export function workdaysBetween(start: string, end: string, calendar: Calendar = {}): number {
  const from = dayjs(start);
  const to = dayjs(end);
  if (to.isBefore(from, 'day')) return 0;
  let days = 0;
  for (let d = from; !d.isAfter(to, 'day'); d = d.add(1, 'day')) {
    const key = d.format('YYYY-MM-DD');
    const mark = calendar[key];
    const dow = d.day();
    if (mark === 'school') {
      days += 1; // 补课（含周末）
    } else if (mark === 'holiday') {
      // 放假，不计
    } else if (dow >= 1 && dow <= 5) {
      days += 1;
    }
  }
  return days;
}

/** 文件名时间戳 YYYYMMDD */
export function dateStampStr(): string {
  return dayjs().format('YYYYMMDD');
}
