/**
 * SheetJS 封装：学生名单模板 / 导入解析 / 导出
 *
 * 依赖来自 cdn.sheetjs.com 官方源（npm 上的 xlsx 停更于 2022，勿改）
 */
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { genderEnum, genderLabel } from '@/constants/business';
import type { Gender, StudentInput, StudentWithEnrollment } from '@/repo';
import { dateStampStr } from '@/utils/date';

/** 模板列头（与 docs/03 对齐；* 为必填） */
const TEMPLATE_HEADERS = ['学号*', '姓名*', '性别', '出生日期', '家长电话', '住址', '备注'];

/** 性别单元格可接受写法（枚举反查 + 留空） */
const GENDER_CELL_MAP: Record<string, Gender> = { ...genderEnum.value, '': 'unknown' };

/** 行级错误：row 为 Excel 实际行号（表头第 1 行，数据从第 2 行起） */
export interface RowError {
  row: number;
  message: string;
}

export interface ParseResult {
  rows: StudentInput[];
  errors: RowError[];
}

/** 生成并下载学生名单模板（带表头空表） */
export function downloadStudentTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
  ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 24 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '学生名单');
  XLSX.writeFile(wb, '学生名单模板.xlsx');
}

/** 导出当前列表（已含筛选）为 xlsx */
export function exportStudents(students: StudentWithEnrollment[]) {
  const aoa = [TEMPLATE_HEADERS.map(h => h.replace('*', ''))];
  students.forEach(s => {
    aoa.push([
      s.student_no,
      s.name,
      genderLabel[s.gender],
      s.birth_date ?? '',
      s.parent_contact ?? '',
      s.address ?? '',
      s.notes ?? ''
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 24 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '学生名单');
  XLSX.writeFile(wb, `学生名单_${dateStampStr()}.xlsx`);
}

/** 读取首个工作表为「表头 + 行矩阵」（成绩表导入等通用场景） */
export async function readSheetMatrix(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) {
    throw new Error('文件中没有工作表');
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: true });
  const headers = (matrix[0] ?? []).map(c => String(c ?? '').trim());
  const rows = matrix.slice(1).map(r =>
    (r ?? []).map(c => {
      if (c == null) return '';
      if (c instanceof Date) return formatDate(c) ?? '';
      return String(c).trim();
    })
  );
  return { headers, rows };
}

/**
 * 解析导入文件：行级校验，一次列全所有错误
 *
 * - 必填缺失（学号/姓名）→ 错误
 * - 文件内学号重复 → 后出现的行报错
 * - 性别仅接受 男/女/未知/空
 * - 出生日期格式化为 YYYY-MM-DD，非法报错
 */
export async function parseStudentFile(file: File): Promise<ParseResult> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) {
    return { rows: [], errors: [{ row: 0, message: '文件中没有工作表' }] };
  }

  // raw:true + 读取时 cellDates:true → 日期单元格以 Date 对象透传（raw:false 会变成 "2/2/11" 这类格式串）
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: true });
  // 去掉表头行
  const body = matrix.slice(1);

  const rows: StudentInput[] = [];
  const errors: RowError[] = [];
  const seenNos = new Map<string, number>();

  body.forEach((cells, idx) => {
    const rowNo = idx + 2; // Excel 行号：表头占第 1 行
    const get = (col: number): string => {
      const v = cells[col];
      if (v == null) return '';
      if (v instanceof Date) return formatDate(v) ?? '';
      return String(v).trim();
    };

    const student_no = get(0);
    const name = get(1);
    const genderCell = get(2);
    const birthCell = get(3);
    const parent_contact = get(4);
    const address = get(5);
    const notes = get(6);

    // 整行为空跳过
    if (!student_no && !name && !genderCell && !birthCell && !parent_contact && !address && !notes) return;

    if (!student_no) {
      errors.push({ row: rowNo, message: '学号缺失' });
    }
    if (!name) {
      errors.push({ row: rowNo, message: '姓名缺失' });
    }
    if (student_no && seenNos.has(student_no)) {
      errors.push({ row: rowNo, message: `学号 ${student_no} 与第 ${seenNos.get(student_no)} 行重复` });
    }

    let gender: Gender = 'unknown';
    if (genderCell && !(genderCell in GENDER_CELL_MAP)) {
      errors.push({ row: rowNo, message: `性别「${genderCell}」无法识别（仅支持 男/女/未知/留空）` });
    } else {
      gender = GENDER_CELL_MAP[genderCell] ?? 'unknown';
    }

    let birth_date: string | undefined;
    if (birthCell) {
      const normalized = normalizeDateCell(birthCell, cells[3]);
      if (!normalized) {
        errors.push({ row: rowNo, message: `出生日期「${birthCell}」无法识别（请用 YYYY-MM-DD）` });
      } else {
        birth_date = normalized;
      }
    }

    if (student_no) {
      seenNos.set(student_no, rowNo);
      rows.push({
        name,
        student_no,
        gender,
        birth_date,
        parent_contact: parent_contact || undefined,
        address: address || undefined,
        notes: notes || undefined
      });
    }
  });

  return { rows, errors };
}

/** 单元格日期归一化：兼容 Date 对象 / YYYY-MM-DD / YYYY/M/D / YYYY.M.D */
function normalizeDateCell(formatted: string, raw: unknown): string | null {
  if (raw instanceof Date) return formatDate(raw);
  const m = formatted.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function formatDate(d: Date): string | null {
  return d && Number.isFinite(d.getTime()) ? dayjs(d).format('YYYY-MM-DD') : null;
}
