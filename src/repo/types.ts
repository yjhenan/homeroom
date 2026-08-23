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

/** 教学日历标记：holiday=工作日放假（节假日）；school=周末补课（调休） */
export type CalendarMark = 'holiday' | 'school';

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
  /** 归档后全模块只读（M3 起存在；老数据视为 false） */
  archived?: boolean;
  /** 假期日期列表（YYYY-MM-DD，非索引字段）；应出勤工作日计算时排除 */
  holidays?: string[];
  /** 教学日历覆盖表（M3+）：周一~五默认上课、周末默认休息；holiday=工作日放假，school=周末补课 */
  calendar?: Record<string, CalendarMark>;
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

/** 考勤状态（全量记录策略：当天每生一行，默认 present） */
export type AttendanceStatus = 'present' | 'late' | 'sick' | 'personal' | 'absent' | 'early_leave';

/** 考勤记录 */
export interface Attendance {
  id: string;
  semester_id: string;
  student_id: string;
  /** YYYY-MM-DD */
  date: string;
  status: AttendanceStatus;
  remark?: string;
}

/** 单生考勤入参（semester/date 由保存动作统一携带） */
export interface AttendanceInput {
  student_id: string;
  status: AttendanceStatus;
  remark?: string;
}

/** 考勤查询条件 */
export interface AttendanceQuery {
  semesterId: string;
  from?: string;
  to?: string;
  studentId?: string;
  statuses?: AttendanceStatus[];
}

// ---- 成绩（M3）----

export type ExamType = 'daily' | 'monthly' | 'midterm' | 'final';

/** 科目满分/及格线（未配置按 100/60 兜底） */
export interface SubjectConf {
  /** 满分（展示与导出用，不做硬校验） */
  full: number;
  /** 及格线（及格率统计用） */
  pass: number;
}

/** 考试 */
export interface Exam {
  id: string;
  semester_id: string;
  name: string;
  date: string;
  type: ExamType;
  /** 该考试已录入的科目（录入页 Tab 用） */
  subjects: string[];
  /** 科目 → 满分/及格线（M3+；老数据视为全空走默认） */
  subject_conf?: Record<string, SubjectConf>;
  created_at: string;
}

export interface ExamInput {
  name: string;
  date: string;
  type: ExamType;
  subjects?: string[];
  subject_conf?: Record<string, SubjectConf>;
}

/** 单科成绩；score null = 缺考 */
export interface Score {
  id: string;
  exam_id: string;
  student_id: string;
  semester_id: string;
  subject: string;
  score: number | null;
  updated_at: string;
}

/** 按科目批量保存的行 */
export interface ScoreInput {
  student_id: string;
  score: number | null;
}

// ---- 德育（M3）----

export type DisciplineDirection = 'plus' | 'minus';

export interface DisciplineEvent {
  id: string;
  semester_id: string;
  student_id: string;
  date: string;
  direction: DisciplineDirection;
  /** 纪律/卫生/文明/助人/其他 */
  category: string;
  /** 分值可不记（只记事） */
  points?: number;
  description: string;
  created_at: string;
}

export interface DisciplineInput {
  student_ids: string[];
  date: string;
  direction: DisciplineDirection;
  category: string;
  points?: number;
  description: string;
}

export interface DisciplineFilter {
  studentId?: string;
  category?: string;
  direction?: DisciplineDirection;
}

// ---- 值日（M3）----

export type DutyEvaluation = 'good' | 'ok' | 'poor';

/** 值日记录：同 (semester, date, area) 一条，排班与评价合一 */
export interface DutyRecord {
  id: string;
  semester_id: string;
  date: string;
  group_name?: string;
  student_ids: string[];
  /** 教室/包干区/其他 */
  area: string;
  evaluation: DutyEvaluation;
  remark?: string;
  updated_at: string;
}

export interface DutyInput {
  date: string;
  group_name?: string;
  student_ids: string[];
  area: string;
  evaluation?: DutyEvaluation;
  remark?: string;
}

// ---- 文档台账（M3）----

/** 附件以 base64 存 DTO（备份/SQLite 可移植）；UI 层限制单文件 ≤10MB */
export interface DocumentAttachment {
  name: string;
  mime_type: string;
  data: string;
}

export interface DocumentRecord {
  id: string;
  semester_id: string;
  title: string;
  /** 通知/计划/总结/其他 */
  category: string;
  date: string;
  summary?: string;
  attachment?: DocumentAttachment;
  created_at: string;
}

export interface DocumentInput {
  title: string;
  category: string;
  date: string;
  summary?: string;
  attachment?: DocumentAttachment;
}

/** 全量备份 JSON（web→桌面阶段的迁移桥，顶层 version 只增不改） */
export interface BackupFile {
  version: 1;
  exportedAt: string;
  semesters: Semester[];
  students: Student[];
  enrollments: Enrollment[];
  /** M2 起存在；导入时容忍缺失（M1 老备份） */
  attendance?: Attendance[];
  /** M3 起存在；导入时容忍缺失 */
  exams?: Exam[];
  scores?: Score[];
  discipline_events?: DisciplineEvent[];
  duty_records?: DutyRecord[];
  documents?: DocumentRecord[];
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
  /** 归档/取消归档（归档学期全模块只读） */
  setSemesterArchived(id: string, archived: boolean): Promise<void>;
  /** 设置学期教学日历覆盖表（周一~五上课基线；归档学期也可改，属元数据） */
  setSemesterCalendar(id: string, calendar: Record<string, CalendarMark>): Promise<void>;
  /** 删除学期（连带其全部业务数据；当前学期不可删）；返回删除的数据条数 */
  deleteSemester(id: string): Promise<{
    students: number;
    enrollments: number;
    attendance: number;
    scores: number;
    discipline: number;
    duty: number;
    documents: number;
  }>;
  /** 把源学期在读名册复制到目标学期（已存在的跳过），返回新增条数 */
  copyRoster(fromSemesterId: string, toSemesterId: string): Promise<number>;

  // ---- 学生 ----
  /** 不传 semesterId 返回全部学生；传了则只返回该学期在读（含转出，带 enrollment） */
  listStudents(semesterId?: string): Promise<StudentWithEnrollment[]>;
  getStudent(id: string): Promise<Student | null>;
  /** 新增学生并挂到指定学期名册 */
  createStudent(input: StudentInput, semesterId: string): Promise<Student>;
  updateStudent(id: string, patch: Partial<StudentInput>): Promise<Student>;
  /** 硬删：学生 + 名册/考勤/成绩/德育记录（并移出值日名单）；返回删除条数 */
  deleteStudent(id: string): Promise<{ enrollments: number; attendance: number; scores: number; discipline: number }>;
  /** Excel 导入：按学号匹配，冲突时按策略覆盖或跳过；新学生自动挂入指定学期名册 */
  importStudents(rows: StudentInput[], semesterId: string, strategy: ImportConflictStrategy): Promise<ImportResult>;
  /** 删除提示用：统计某学生历史关联记录数 */
  countStudentRecords(
    studentId: string
  ): Promise<{ enrollments: number; attendance: number; scores: number; discipline: number }>;

  // ---- 考勤 ----
  /** 某学期某天的全部考勤（未录返回空数组） */
  getAttendanceByDate(semesterId: string, date: string): Promise<Attendance[]>;
  /** 保存某天考勤：全量替换该 (semester, date) 的记录 */
  saveAttendanceForDate(semesterId: string, date: string, rows: AttendanceInput[]): Promise<void>;
  /** 按条件查询（日期范围/学生/状态） */
  queryAttendance(query: AttendanceQuery): Promise<Attendance[]>;

  // ---- 考试与成绩 ----
  listExams(semesterId: string): Promise<Exam[]>;
  createExam(input: ExamInput, semesterId: string): Promise<Exam>;
  updateExam(id: string, patch: Partial<ExamInput>): Promise<void>;
  /** 删除考试及其全部成绩，返回删除的成绩条数 */
  deleteExam(id: string): Promise<{ scores: number }>;
  /** 某考试某科目全部成绩 */
  getScoresBySubject(examId: string, subject: string): Promise<Score[]>;
  /** 某考试某科目成绩全量替换（缺考传 null；行不传视为清空该生该科） */
  saveScoresForSubject(examId: string, subject: string, rows: ScoreInput[]): Promise<void>;
  /** 学生全学期成绩（360 趋势用） */
  getScoresByStudent(semesterId: string, studentId: string): Promise<Score[]>;
  /** 某考试全部成绩（总表用） */
  getScoresByExam(examId: string): Promise<Score[]>;
  /** 删除某考试某科目全部成绩并从 exam.subjects 移除，返回删除条数（录错科目清理用） */
  deleteScoresBySubject(examId: string, subject: string): Promise<number>;

  // ---- 德育 ----
  listDisciplineEvents(semesterId: string, filter?: DisciplineFilter): Promise<DisciplineEvent[]>;
  /** 快速新增：一次给多个学生记同一事件，返回新增条数 */
  addDisciplineEvents(input: DisciplineInput, semesterId: string): Promise<number>;
  deleteDisciplineEvent(id: string): Promise<void>;
  /** 学生全学期德育事件（360 用） */
  getDisciplineByStudent(semesterId: string, studentId: string): Promise<DisciplineEvent[]>;

  // ---- 值日 ----
  /** 日期范围（含）内的值日记录 */
  listDutyRecords(semesterId: string, from?: string, to?: string): Promise<DutyRecord[]>;
  /** upsert：同 (semester, date, area) 唯一 */
  saveDutyRecord(input: DutyInput, semesterId: string): Promise<DutyRecord>;
  deleteDutyRecord(id: string): Promise<void>;
  /** 学生参与的值日记录（360 用） */
  getDutyByStudent(semesterId: string, studentId: string): Promise<DutyRecord[]>;

  // ---- 文档台账 ----
  listDocuments(semesterId: string): Promise<DocumentRecord[]>;
  createDocument(input: DocumentInput, semesterId: string): Promise<DocumentRecord>;
  /** 更新条目（attachment 传 undefined 表示不变，传 null 表示删除附件） */
  updateDocument(
    id: string,
    patch: Partial<Omit<DocumentInput, 'attachment'>> & { attachment?: DocumentAttachment | null }
  ): Promise<void>;
  deleteDocument(id: string): Promise<void>;

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
