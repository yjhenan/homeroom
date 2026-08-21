import type {
  AttendanceStatus,
  DisciplineDirection,
  DutyEvaluation,
  Enrollment,
  ExamType,
  Gender,
  Student
} from '@/repo';

/**
 * 枚举统一定义：一处声明，三向派生
 * - `xxxEnum.label`  值 → 中文（显示）
 * - `xxxEnum.value`  中文 → 值（Excel 导入等反查）
 * - `xxxEnum.options`   NSelect/NRadio 选项
 */

export interface EnumDef<T extends string> {
  /** 值 → 中文 */
  label: Record<T, string>;
  /** 中文 → 值 */
  value: Record<string, T>;
  /** 下拉/单选选项 */
  options: { label: string; value: T }[];
  /** 全部值（声明序） */
  values: T[];
}

export function defineEnum<T extends string>(defs: [T, string][]): EnumDef<T> {
  const label = {} as Record<T, string>;
  const value: Record<string, T> = {};
  defs.forEach(([v, l]) => {
    label[v] = l;
    value[l] = v;
  });
  return {
    label,
    value,
    options: defs.map(([value1, label1]) => ({ value: value1, label: label1 })),
    values: defs.map(([v]) => v)
  };
}

// ---- 性别 ----
export const genderEnum = defineEnum<Gender>([
  ['male', '男'],
  ['female', '女'],
  ['unknown', '未知']
]);
export const genderLabel = genderEnum.label;
export const genderOptions = genderEnum.options;

// ---- 名册状态 ----
export const enrollmentStatusEnum = defineEnum<Enrollment['status']>([
  ['active', '在读'],
  ['transferred_out', '转出']
]);
export const enrollmentStatusLabel = enrollmentStatusEnum.label;
export const enrollmentStatusOptions = enrollmentStatusEnum.options;

// ---- 考勤状态 ----
export const attendanceStatusEnum = defineEnum<AttendanceStatus>([
  ['present', '出勤'],
  ['late', '迟到'],
  ['sick', '病假'],
  ['personal', '事假'],
  ['absent', '旷课'],
  ['early_leave', '早退']
]);
export const attendanceStatusLabel = attendanceStatusEnum.label;
export const attendanceTagType: Record<AttendanceStatus, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
  present: 'success',
  late: 'warning',
  sick: 'info',
  personal: 'default',
  absent: 'error',
  early_leave: 'warning'
};

/** 点选循环顺序：出勤 → 病假 → 事假 → 旷课 → 迟到 → 早退 → 出勤（docs/03） */
export const attendanceCycle: AttendanceStatus[] = ['present', 'sick', 'personal', 'absent', 'late', 'early_leave'];

/** 异常状态（非 present） */
export const abnormalStatuses: AttendanceStatus[] = attendanceStatusEnum.values.filter(s => s !== 'present');

/** 出勤率口径：到校即出勤（present/late/early_leave 计入分子） */
export const attendedStatuses: AttendanceStatus[] = ['present', 'late', 'early_leave'];

export function nextAttendanceStatus(current: AttendanceStatus): AttendanceStatus {
  const idx = attendanceCycle.indexOf(current);
  return attendanceCycle[(idx + 1) % attendanceCycle.length];
}

// ---- 考试类型 ----
export const examTypeEnum = defineEnum<ExamType>([
  ['daily', '随堂练习'],
  ['monthly', '月考'],
  ['midterm', '期中考试'],
  ['final', '期末考试']
]);
export const examTypeLabel = examTypeEnum.label;
export const examTypeOptions = examTypeEnum.options;

/** 常用科目（录入页可自由输入其它） */
export const commonSubjects = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'];

// ---- 德育 ----
export const disciplineDirectionEnum = defineEnum<DisciplineDirection>([
  ['plus', '加分'],
  ['minus', '扣分']
]);
export const disciplineDirectionLabel = disciplineDirectionEnum.label;
export const disciplineCategoryOptions = ['纪律', '卫生', '文明', '助人', '其他'].map(v => ({ label: v, value: v }));

// ---- 值日 ----
export const dutyAreaOptions = ['教室', '包干区', '其他'].map(v => ({ label: v, value: v }));
export const dutyEvaluationEnum = defineEnum<DutyEvaluation>([
  ['good', '好'],
  ['ok', '一般'],
  ['poor', '差']
]);
export const dutyEvaluationLabel = dutyEvaluationEnum.label;
export const dutyEvaluationTagType: Record<DutyEvaluation, 'success' | 'warning' | 'error'> = {
  good: 'success',
  ok: 'warning',
  poor: 'error'
};

/** 表格/表单通用的学生字段中文名 */
export const studentFieldLabel: Record<keyof Student, string> = {
  id: 'ID',
  name: '姓名',
  student_no: '学号',
  gender: '性别',
  birth_date: '出生日期',
  parent_contact: '家长电话',
  address: '住址',
  notes: '备注',
  created_at: '创建时间',
  updated_at: '更新时间'
};
