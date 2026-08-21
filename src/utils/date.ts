/**
 * 日期工具：统一走 dayjs，禁止手写 padStart 拼串
 * 约定：业务日期一律 YYYY-MM-DD 字符串（DTO），时间戳 ISO 字符串
 */
import dayjs from 'dayjs';

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

/** [start, end] 内的工作日数（周一~周五，含两端） */
export function workdaysBetween(start: string, end: string): number {
  const from = dayjs(start);
  const to = dayjs(end);
  if (to.isBefore(from, 'day')) return 0;
  let days = 0;
  for (let d = from; !d.isAfter(to, 'day'); d = d.add(1, 'day')) {
    const dow = d.day();
    if (dow >= 1 && dow <= 5) days += 1;
  }
  return days;
}

/** 文件名时间戳 YYYYMMDD */
export function dateStampStr(): string {
  return dayjs().format('YYYYMMDD');
}
