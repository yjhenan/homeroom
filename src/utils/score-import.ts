/**
 * 成绩表导入：纯逻辑（表格矩阵 + 名册 → 导入计划），UI 与存储分离便于测试
 *
 * 表头约定：必须有「学号」列；「姓名」列可选（用于核对提示）；
 * 其余列视为科目，元数据黑名单列（总分/名次/…）自动忽略。
 */
export interface ScoreImportError {
  row: number;
  message: string;
}

export interface ScoreImportPlan {
  errors: ScoreImportError[];
  warnings: ScoreImportError[];
  /** 学号 → 姓名（匹配成功的行） */
  matchedCount: number;
  /** subject → studentId → score（null=缺考）；未出现在表中的学生不在 map 里（合并时保留库内已有值） */
  scores: Record<string, Record<string, number | null>>;
  /** 自动忽略的元数据列（总分/名次等） */
  ignoredHeaders: string[];
  /** 识别出的科目（列序） */
  subjects: string[];
}

/** 不作为科目导入的元数据列名 */
const META_HEADERS = ['总分', '总评', '平均分', '均分', '名次', '排名', '序号', '等级', '备注', '折算分'];

const NO_HEADERS = ['学号', '学生学号'];
const NAME_HEADERS = ['姓名', '学生姓名', '名字'];

/** 单元格分数解析：空/缺/缺考 → null；数字 → 两位小数；其它 → NaN（非法） */
export function parseScoreCell(raw: string): number | null | typeof NaN {
  const t = raw.trim();
  if (t === '' || t === '缺' || t === '缺考') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export interface RosterItem {
  id: string;
  student_no: string;
  name: string;
}

export function buildScoreImportPlan(headers: string[], rows: string[][], roster: RosterItem[]): ScoreImportPlan {
  const result: ScoreImportPlan = {
    errors: [],
    warnings: [],
    matchedCount: 0,
    scores: {},
    ignoredHeaders: [],
    subjects: []
  };

  const noIdx = headers.findIndex(h => NO_HEADERS.includes(h));
  if (noIdx === -1) {
    result.errors.push({ row: 0, message: '缺少「学号」列（表头必须是：学号）' });
    return result;
  }
  const nameIdx = headers.findIndex(h => NAME_HEADERS.includes(h));

  result.subjects = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => h !== '' && i !== noIdx && i !== nameIdx && !META_HEADERS.includes(h))
    .filter(({ h }) => !NO_HEADERS.includes(h) && !NAME_HEADERS.includes(h))
    .map(({ h }) => h);
  result.ignoredHeaders = headers.filter(h => META_HEADERS.includes(h));

  if (result.subjects.length === 0) {
    result.errors.push({ row: 0, message: '未识别到科目列（学号/姓名/总分 之外的列才是科目）' });
    return result;
  }
  const subjectIdx = result.subjects.map(sub => headers.indexOf(sub));
  result.subjects.forEach(sub => {
    result.scores[sub] = {};
  });

  const byNo = new Map(roster.map(s => [s.student_no, s]));
  const seenNos = new Map<string, number>();

  rows.forEach((cells, idx) => {
    const rowNo = idx + 2; // Excel 行号：表头第 1 行
    const rowText = cells.join('');
    if (!rowText.trim()) return; // 整行空跳过

    const no = (cells[noIdx] ?? '').trim();
    if (!no) {
      result.errors.push({ row: rowNo, message: '学号缺失' });
      return;
    }
    if (seenNos.has(no)) {
      result.errors.push({ row: rowNo, message: `学号 ${no} 与第 ${seenNos.get(no)} 行重复` });
      return;
    }
    seenNos.set(no, rowNo);

    const student = byNo.get(no);
    if (!student) {
      result.errors.push({ row: rowNo, message: `学号 ${no} 不在本学期名册` });
      return;
    }

    // 姓名核对（不阻断）
    if (nameIdx !== -1) {
      const name = (cells[nameIdx] ?? '').trim();
      if (name && name !== student.name) {
        result.warnings.push({
          row: rowNo,
          message: `学号 ${no} 姓名为「${name}」，名册为「${student.name}」，按学号导入`
        });
      }
    }

    result.subjects.forEach((sub, si) => {
      const raw = cells[subjectIdx[si]] ?? '';
      const score = parseScoreCell(raw);
      if (Number.isNaN(score)) {
        result.errors.push({ row: rowNo, message: `「${sub}」成绩「${raw}」无法识别（数字 / 空 / 缺）` });
        return;
      }
      result.scores[sub][student.id] = score;
    });
  });

  result.matchedCount = seenNos.size - result.errors.filter(e => e.message.includes('重复')).length;
  return result;
}
