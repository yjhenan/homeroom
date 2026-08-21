/**
 * 成绩表导入纯逻辑
 */
import { describe, expect, it } from 'vitest';
import { buildScoreImportPlan, parseScoreCell } from '@/utils/score-import';

const roster = [
  { id: 's1', student_no: '001', name: '张三' },
  { id: 's2', student_no: '002', name: '李四' },
  { id: 's3', student_no: '003', name: '王五' }
];

describe('parseScoreCell', () => {
  it('空/缺/缺考 → null，数字保留两位小数，非法为 NaN', () => {
    expect(parseScoreCell('')).toBeNull();
    expect(parseScoreCell('缺')).toBeNull();
    expect(parseScoreCell('缺考')).toBeNull();
    expect(parseScoreCell('—')).toBeUndefined();
    expect(parseScoreCell('－')).toBeUndefined();
    expect(parseScoreCell('-')).toBeUndefined();
    expect(parseScoreCell('92')).toBe(92);
    expect(parseScoreCell('92.455')).toBe(92.46);
    expect(Number.isNaN(parseScoreCell('优秀'))).toBe(true);
  });
});

describe('buildScoreImportPlan', () => {
  const headers = ['学号', '姓名', '语文', '数学', '总分', '名次'];

  it('正常：多科目导入，元数据列忽略，缺考为 null', () => {
    const rows = [
      ['001', '张三', '90', '缺', '90', '1'],
      ['002', '李四', '78.5', '66', '', ''],
      ['', '', '', '', '', ''] // 整行空跳过
    ];
    const plan = buildScoreImportPlan(headers, rows, roster);
    expect(plan.errors).toEqual([]);
    expect(plan.subjects).toEqual(['语文', '数学']);
    expect(plan.ignoredHeaders).toEqual(['总分', '名次']);
    expect(plan.scores['语文'].s1).toBe(90);
    expect(plan.scores['语文'].s2).toBe(78.5);
    expect(plan.scores['数学'].s1).toBeNull();
    expect(plan.scores['数学'].s2).toBe(66);
    expect(plan.matchedCount).toBe(2);
    // 表中未出现的学生不在 map（合并时保留库内值）
    expect(plan.scores['语文'].s3).toBeUndefined();
  });

  it('学号缺失 / 不在名册 / 文件内重复 / 非法分数 → 一次列全', () => {
    const rows = [
      ['', '无名', '90', ''], // 2: 学号缺失
      ['009', '外人', '80', ''], // 3: 不在名册
      ['001', '张三', 'abc', ''], // 4: 语文非法
      ['001', '张三', '70', ''] // 5: 与第 4 行重复（第 4 行已有学号，但该行也先记过）
    ];
    const plan = buildScoreImportPlan(headers, rows, roster);
    const msgs = plan.errors.map(e => e.message).join(' | ');
    expect(plan.errors.length).toBeGreaterThanOrEqual(3);
    expect(msgs).toMatch(/学号缺失/);
    expect(msgs).toMatch(/不在本学期名册/);
    expect(msgs).toMatch(/无法识别/);
  });

  it('姓名不符 → 警告不阻断', () => {
    const rows = [['001', '张三丰', '90', '']];
    const plan = buildScoreImportPlan(headers, rows, roster);
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.length).toBe(1);
    expect(plan.warnings[0].message).toMatch(/名册为「张三」/);
    expect(plan.scores['语文'].s1).toBe(90);
  });

  it('往返闭环：导出的成绩单可无损导回（满分后缀表头 / — 占位 / 班级均分行）', () => {
    const exportHeaders = ['学号', '姓名', '语文', '数学(满分120)', '总分', '名次'];
    const exportRows = [
      ['001', '张三', '90', '78', '168', '1'],
      ['002', '李四', '缺', '—', '', ''], // 数学未录入（—），语文缺考
      ['班级均分', '', '90', '78', '168', ''] // 汇总行应跳过
    ];
    const plan = buildScoreImportPlan(exportHeaders, exportRows, roster);
    expect(plan.errors).toEqual([]);
    expect(plan.subjects).toEqual(['语文', '数学']);
    expect(plan.scores['语文'].s1).toBe(90);
    expect(plan.scores['语文'].s2).toBeNull(); // 缺考
    expect(plan.scores['数学'].s1).toBe(78);
    expect(plan.scores['数学'].s2).toBeUndefined(); // — 占位：保留库内已有，不写缺考
    expect(plan.matchedCount).toBe(2);
  });

  it('缺学号列 / 无科目列 → 表头错误', () => {
    const noId = buildScoreImportPlan(['姓名', '语文'], [['张三', '90']], roster);
    expect(noId.errors[0].message).toMatch(/缺少「学号」列/);

    const noSub = buildScoreImportPlan(['学号', '姓名'], [['001', '张三']], roster);
    expect(noSub.errors[0].message).toMatch(/未识别到科目列/);
  });
});
