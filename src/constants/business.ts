import type { Enrollment, Gender, Student } from '@/repo';

/** 枚举中文标签（UI 文案层；DTO 值本身为英文枚举，便于排序与导出） */

export const genderLabel: Record<Gender, string> = {
  male: '男',
  female: '女',
  unknown: '未知'
};

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
