/**
 * 由 scripts/smoke-excel.ts 迁移而来：Excel 解析行级校验
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseStudentFile } from '@/utils/excel';

describe('Excel 解析', () => {
  it('模板解析与行级校验一次列全', async () => {
    // 构造一份典型名单：40 行有效 + 各类问题行
    const aoa: unknown[][] = [['学号*', '姓名*', '性别', '出生日期', '家长电话', '住址', '备注']];
    for (let i = 1; i <= 40; i++) {
      aoa.push([
        `2026${String(i).padStart(3, '0')}`,
        `学生${i}`,
        i % 2 ? '男' : '女',
        `2010-0${(i % 9) + 1}-15`,
        `1380000${String(i).padStart(4, '0')}`,
        `某市某区${i}号`,
        i % 5 === 0 ? '转学生' : ''
      ]);
    }
    // 问题行（Excel 行号从 2 起，以上 40 行占用 2-41）
    aoa.push([undefined, '没学号', '男', '', '', '', '']); // 42: 学号缺失
    aoa.push(['2026001x', '', '男', '', '', '', '']); // 43: 姓名缺失（学号不重复，因为前缀x）
    aoa.push([`2026${String(1).padStart(3, '0')}`, '重复学号', '男', '', '', '', '']); // 44: 与第2行学号重复
    aoa.push(['2026099', '性别离谱', '外星人', '', '', '', '']); // 45: 性别无法识别
    aoa.push(['2026100', '日期离谱', '男', '大约2008年', '', '', '']); // 46: 日期无法识别
    aoa.push([undefined, undefined, undefined, undefined, undefined, undefined, '只有备注的行']); // 47: 有内容但学号/姓名缺失
    aoa.push([undefined, undefined, undefined, undefined, undefined, undefined, '']); // 48: 整行空 → 跳过，不报错

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // 出生日期写为真实 Date 单元格（cellDates 读取路径）
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '学生名单');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    const file = new File([buf], '名单.xlsx');
    const { rows, errors } = await parseStudentFile(file);

    expect(rows.length).toBe(44); // 40 有效 + 4 行有学号但含错误（43/44/45/46 行；错误路径下 rows 不参与导入）
    const rowNos = errors.map(e => e.row).sort((a, b) => a - b);
    // 行 47 同时缺学号与姓名 → 两条错误
    expect(rowNos).toEqual([42, 43, 44, 45, 46, 47, 47]);
    expect(errors.find(e => e.row === 42)!.message).toMatch(/学号缺失/);
    expect(errors.find(e => e.row === 43)!.message).toMatch(/姓名缺失/);
    expect(errors.find(e => e.row === 44)!.message).toMatch(/与第 2 行重复/);
    expect(errors.find(e => e.row === 45)!.message).toMatch(/性别/);
    expect(errors.find(e => e.row === 46)!.message).toMatch(/出生日期/);

    // 首行数据内容正确
    const first = rows[0];
    expect(first.student_no).toBe('2026001');
    expect(first.name).toBe('学生1');
    expect(first.gender).toBe('male');
    expect(first.birth_date).toBe('2010-02-15');
    expect(first.parent_contact).toBe('13800000001');

    // ---- 日期格式兼容 ----
    const wb2 = XLSX.utils.book_new();
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['学号*', '姓名*', '性别', '出生日期'],
      ['A1', '斜杠格式', '女', '2011/3/5'],
      ['A2', '点格式', '男', '2011.3.6'],
      ['A3', '带时间', '女', '2011-03-07 00:00:00']
    ]);
    XLSX.utils.book_append_sheet(wb2, ws2, '学生名单');
    const buf2 = XLSX.write(wb2, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const r2 = await parseStudentFile(new File([buf2], 'd.xlsx'));
    expect(r2.errors.length).toBe(1); // 带时间的视为无法识别
    expect(r2.rows[0].birth_date).toBe('2011-03-05');
    expect(r2.rows[1].birth_date).toBe('2011-03-06');

    // ---- 性别留空 / 未知 ----
    const wb3 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb3,
      XLSX.utils.aoa_to_sheet([
        ['学号*', '姓名*', '性别'],
        ['B1', '性别留空', ''],
        ['B2', '性别未知', '未知']
      ]),
      '学生名单'
    );
    const buf3 = XLSX.write(wb3, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const r3 = await parseStudentFile(new File([buf3], 'g.xlsx'));
    expect(r3.errors.length).toBe(0);
    expect(r3.rows[0].gender).toBe('unknown');
    expect(r3.rows[1].gender).toBe('unknown');

    console.log('\n全部通过 ✔');
  });
});
