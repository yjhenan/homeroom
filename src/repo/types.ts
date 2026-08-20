/**
 * ClassRepo 接口与 DTO 定义
 *
 * 硬规则：
 * - 组件与 store 只准 import 本文件与 createRepo 工厂，禁止直接依赖 dexie / @tauri-apps/*
 * - DTO 纯数据：id 为字符串 nanoid(12)；日期 YYYY-MM-DD；时间戳 ISO 字符串；分数 number
 * - 方法 = 一个业务动作，动词开头
 */

/** 学号等唯一键冲突时导入策略 */
export type ImportConflictStrategy = 'overwrite' | 'skip';

/** 性别 */
export type Gender = 'male' | 'female' | 'unknown';

/** 学期 */
export interface Semester {
  /** 如 `2026-2027-1`（学年-学期号） */
  id: string;
  /** 如 `2026-2027学年 第一学期` */
  name: string;
  start_date: string;
  end_date: string;
  /** 全表仅一个 true；「当前学期」由它决定 */
  is_active: boolean;
}

export interface SemesterInput {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active?: boolean;
}

/** 学生（跨学期实体） */
export interface Student {
  id: string;
  name: string;
  /** 全表唯一，必填 */
  student_no: string;
  gender: Gender;
  birth_date?: string;
  parent_contact?: string;
  address?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

/** 新增/编辑学生入参（id 与时间戳由仓库层生成） */
export interface StudentInput {
  name: string;
  student_no: string;
  gender: Gender;
  birth_date?: string;
  parent_contact?: string;
  address?: string;
  notes?: string;
}

/** 名册（学期×学生） */
export interface Enrollment {
  id: string;
  semester_id: string;
  student_id: string;
  seat_no?: number;
  /** 转出不删历史记录 */
  status: 'active' | 'transferred_out';
}

/** 学生 + 其在某学期的名册信息（列表联查结果） */
export interface StudentWithEnrollment extends Student {
  enrollment?: Enrollment;
}

/** 批量导入结果 */
export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
}

/** 全量备份 JSON（web→桌面阶段的迁移桥，顶层 version 只增不改） */
export interface BackupFile {
  version: 1;
  exportedAt: string;
  semesters: Semester[];
  students: Student[];
  enrollments: Enrollment[];
  settings: Record<string, unknown>;
}

/**
 * 仓库接口——两实现（Dexie/SQLite）可互换的唯一契约
 */
export interface ClassRepo {
  // ---- 学期 ----
  listSemesters(): Promise<Semester[]>;
  getActiveSemester(): Promise<Semester | null>;
  createSemester(input: SemesterInput): Promise<Semester>;
  /** 更新学期基础信息（不改 is_active） */
  updateSemester(id: string, patch: Partial<Pick<Semester, 'name' | 'start_date' | 'end_date'>>): Promise<void>;
  /** 切换当前学期（保证全表仅一个 active） */
  setActiveSemester(id: string): Promise<void>;

  // ---- 学生 ----
  /** 不传 semesterId 返回全部学生；传了则只返回该学期在读（含转出，带 enrollment） */
  listStudents(semesterId?: string): Promise<StudentWithEnrollment[]>;
  getStudent(id: string): Promise<Student | null>;
  /** 新增学生并挂到指定学期名册 */
  createStudent(input: StudentInput, semesterId: string): Promise<Student>;
  updateStudent(id: string, patch: Partial<StudentInput>): Promise<Student>;
  /** 硬删：学生 + 其全部名册记录；返回删除的名册条数（供 UI 提示影响范围） */
  deleteStudent(id: string): Promise<number>;
  /** Excel 导入：按学号匹配，冲突时按策略覆盖或跳过；新学生自动挂入指定学期名册 */
  importStudents(rows: StudentInput[], semesterId: string, strategy: ImportConflictStrategy): Promise<ImportResult>;
  /** 删除提示用：统计某学生历史关联记录数（M1 仅名册，M2/M3 扩展考勤/成绩等） */
  countStudentRecords(studentId: string): Promise<{ enrollments: number }>;

  // ---- 名册 ----
  listEnrollments(semesterId: string): Promise<Enrollment[]>;
  updateEnrollment(id: string, patch: Partial<Pick<Enrollment, 'seat_no' | 'status'>>): Promise<void>;

  // ---- 设置（键值，value 为 JSON 可序列化数据） ----
  getSetting<T = unknown>(key: string): Promise<T | null>;
  setSetting(key: string, value: unknown): Promise<void>;

  // ---- 备份 ----
  exportAll(): Promise<BackupFile>;
  /** 全量替换导入（调用方负责先导出一份当前数据） */
  importAll(data: BackupFile): Promise<void>;
}
