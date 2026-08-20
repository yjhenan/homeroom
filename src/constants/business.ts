import type { AttendanceStatus, Enrollment, Gender, Student } from '@/repo';

/** 枚举中文标签（UI 文案层；DTO 值本身为英文枚举，便于排序与导出） */

export const genderLabel: Record<Gender, string> = {
  male: '男',
  female: '女',
  unknown: '未知'
};

export const attendanceStatusLabel: Record<AttendanceStatus, string> = {
  present: '出勤',
  late: '迟到',
  sick: '病假',
  personal: '事假',
  absent: '旷课',
  early_leave: '早退'
};

/** 点选循环顺序：出勤 → 病假 → 事假 → 旷课 → 迟到 → 早退 → 出勤（docs/03） */
export const attendanceCycle: AttendanceStatus[] = ['present', 'sick', 'personal', 'absent', 'late', 'early_leave'];

/** 异常状态（非 present） */
export const abnormalStatuses: AttendanceStatus[] = ['late', 'sick', 'personal', 'absent', 'early_leave'];

/** NTag 类型映射：异常标橙红，出勤绿 */
export const attendanceTagType: Record<AttendanceStatus, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
  present: 'success',
  late: 'warning',
  sick: 'info',
  personal: 'default',
  absent: 'error',
  early_leave: 'warning'
};

/** 出勤率口径：到校即出勤（present/late/early_leave 计入分子） */
export const attendedStatuses: AttendanceStatus[] = ['present', 'late', 'early_leave'];

export function nextAttendanceStatus(current: AttendanceStatus): AttendanceStatus {
  const idx = attendanceCycle.indexOf(current);
  return attendanceCycle[(idx + 1) % attendanceCycle.length];
}

export const genderOptions = (Object.keys(genderLabel) as Gender[]).map(value => ({
  label: genderLabel[value],
  value
}));

export const enrollmentStatusLabel: Record<Enrollment['status'], string> = {
  active: '在读',
  transferred_out: '转出'
};

export const enrollmentStatusOptions = (Object.keys(enrollmentStatusLabel) as Enrollment['status'][]).map(value => ({
  label: enrollmentStatusLabel[value],
  value
}));

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
