import Dexie from 'dexie';
import type { Table } from 'dexie';
import { nanoid } from 'nanoid';
import type {
  BackupFile,
  ClassRepo,
  Enrollment,
  ImportConflictStrategy,
  ImportResult,
  Semester,
  SemesterInput,
  Student,
  StudentInput,
  StudentWithEnrollment
} from './types';

/** nanoid(12)，DTO 主键约定 */
function genId(): string {
  return nanoid(12);
}

/** 当前时间 ISO 字符串 */
function nowISO(): string {
  return new Date().toISOString();
}

interface SettingRow {
  key: string;
  value: unknown;
}

/**
 * Dexie(IndexedDB) 实现
 *
 * 硬规则：schema 变更必须升 version 并写 migration，禁止改历史 version 定义
 */
class HomeroomDB extends Dexie {
  semesters!: Table<Semester, string>;
  students!: Table<Student, string>;
  enrollments!: Table<Enrollment, string>;
  settings!: Table<SettingRow, string>;

  constructor() {
    super('homeroom');

    // v1 (M1)：semesters / students / enrollments / settings 四表
    // 注：is_active 不建索引——IndexedDB 布尔键会被规范化为 0/1，学期表很小，直接 filter
    this.version(1).stores({
      semesters: 'id',
      students: 'id, &student_no, name',
      enrollments: 'id, &[semester_id+student_id], semester_id, student_id, status',
      settings: 'key'
    });
  }
}

export class DexieClassRepo implements ClassRepo {
  private db: HomeroomDB;

  constructor() {
    this.db = new HomeroomDB();
  }

  // ---- 学期 ----

  async listSemesters(): Promise<Semester[]> {
    const rows = await this.db.semesters.toArray();
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }

  async getActiveSemester(): Promise<Semester | null> {
    return (await this.db.semesters.filter(s => s.is_active).first()) ?? null;
  }

  async createSemester(input: SemesterInput): Promise<Semester> {
    const semester: Semester = {
      id: input.id,
      name: input.name,
      start_date: input.start_date,
      end_date: input.end_date,
      is_active: Boolean(input.is_active)
    };

    await this.db.transaction('rw', this.db.semesters, async () => {
      if (input.is_active) {
        await this.clearActiveSemesters();
      }
      await this.db.semesters.add(semester);
    });

    return semester;
  }

  async updateSemester(id: string, patch: Partial<Pick<Semester, 'name' | 'start_date' | 'end_date'>>): Promise<void> {
    await this.db.semesters.update(id, patch);
  }

  async setActiveSemester(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.semesters, async () => {
      const target = await this.db.semesters.get(id);
      if (!target) {
        throw new Error(`学期不存在: ${id}`);
      }
      await this.clearActiveSemesters();
      await this.db.semesters.update(id, { is_active: true });
    });
  }

  private async clearActiveSemesters(): Promise<void> {
    await this.db.semesters.toCollection().modify({ is_active: false });
  }

  // ---- 学生 ----

  async listStudents(semesterId?: string): Promise<StudentWithEnrollment[]> {
    if (!semesterId) {
      const students = await this.db.students.toArray();
      return students.sort((a, b) => a.student_no.localeCompare(b.student_no, 'zh-CN'));
    }

    const enrollments = await this.db.enrollments.where('semester_id').equals(semesterId).toArray();
    const studentIds = enrollments.map(e => e.student_id);
    const students = await this.db.students.bulkGet(studentIds);

    const rows: StudentWithEnrollment[] = [];
    enrollments.forEach((enrollment, i) => {
      const student = students[i];
      if (student) {
        rows.push({ ...student, enrollment });
      }
    });

    return rows.sort((a, b) => a.student_no.localeCompare(b.student_no, 'zh-CN'));
  }

  async getStudent(id: string): Promise<Student | null> {
    return (await this.db.students.get(id)) ?? null;
  }

  async createStudent(input: StudentInput, semesterId: string): Promise<Student> {
    const now = nowISO();
    const student: Student = {
      id: genId(),
      created_at: now,
      updated_at: now,
      ...normalizeStudentInput(input)
    };

    await this.assertStudentNoUnique(student.student_no);

    await this.db.transaction('rw', this.db.students, this.db.enrollments, async () => {
      await this.db.students.add(student);
      await this.db.enrollments.add({
        id: genId(),
        semester_id: semesterId,
        student_id: student.id,
        status: 'active'
      });
    });

    return student;
  }

  async updateStudent(id: string, patch: Partial<StudentInput>): Promise<Student> {
    const existing = await this.db.students.get(id);
    if (!existing) {
      throw new Error(`学生不存在: ${id}`);
    }

    if (patch.student_no && patch.student_no !== existing.student_no) {
      await this.assertStudentNoUnique(patch.student_no, id);
    }

    const next: Student = {
      ...existing,
      ...normalizeStudentInput({ ...existing, ...patch }),
      id: existing.id,
      created_at: existing.created_at,
      updated_at: nowISO()
    };

    await this.db.students.put(next);
    return next;
  }

  async deleteStudent(id: string): Promise<number> {
    return this.db.transaction('rw', this.db.students, this.db.enrollments, async () => {
      const removed = await this.db.enrollments.where('student_id').equals(id).delete();
      await this.db.students.delete(id);
      return removed;
    });
  }

  async importStudents(
    rows: StudentInput[],
    semesterId: string,
    strategy: ImportConflictStrategy
  ): Promise<ImportResult> {
    const result: ImportResult = { created: 0, updated: 0, skipped: 0 };

    // 库内按学号索引现有学生
    const existing = await this.db.students.toArray();
    const byNo = new Map(existing.map(s => [s.student_no, s]));

    // 学期内现有名册，避免重复挂名册
    const semesterEnrollments = await this.db.enrollments.where('semester_id').equals(semesterId).toArray();
    const enrolledStudentIds = new Set(semesterEnrollments.map(e => e.student_id));

    const newStudents: Student[] = [];
    const updatedStudents: Student[] = [];
    const newEnrollments: Enrollment[] = [];

    rows.forEach(input => {
      const normalized = normalizeStudentInput(input);
      const prev = byNo.get(normalized.student_no);

      if (!prev) {
        const student: Student = {
          id: genId(),
          created_at: nowISO(),
          updated_at: nowISO(),
          ...normalized
        };
        newStudents.push(student);
        byNo.set(student.student_no, student);
        result.created += 1;
        newEnrollments.push({ id: genId(), semester_id: semesterId, student_id: student.id, status: 'active' });
        return;
      }

      if (strategy === 'skip') {
        result.skipped += 1;
      } else {
        updatedStudents.push({
          ...prev,
          ...normalized,
          id: prev.id,
          created_at: prev.created_at,
          updated_at: nowISO()
        });
        result.updated += 1;
      }

      // 已存在的学生若不在本学期名册，也挂入名册
      if (!enrolledStudentIds.has(prev.id)) {
        newEnrollments.push({ id: genId(), semester_id: semesterId, student_id: prev.id, status: 'active' });
        enrolledStudentIds.add(prev.id);
      }
    });

    await this.db.transaction('rw', this.db.students, this.db.enrollments, async () => {
      await this.db.students.bulkPut([...newStudents, ...updatedStudents]);
      if (newEnrollments.length) {
        await this.db.enrollments.bulkAdd(newEnrollments);
      }
    });

    return result;
  }

  async countStudentRecords(studentId: string): Promise<{ enrollments: number }> {
    return { enrollments: await this.db.enrollments.where('student_id').equals(studentId).count() };
  }

  private async assertStudentNoUnique(studentNo: string, excludeId?: string): Promise<void> {
    const dup = await this.db.students.where('student_no').equals(studentNo).first();
    if (dup && dup.id !== excludeId) {
      throw new Error(`学号已存在: ${studentNo}`);
    }
  }

  // ---- 名册 ----

  async listEnrollments(semesterId: string): Promise<Enrollment[]> {
    return this.db.enrollments.where('semester_id').equals(semesterId).toArray();
  }

  async updateEnrollment(id: string, patch: Partial<Pick<Enrollment, 'seat_no' | 'status'>>): Promise<void> {
    await this.db.enrollments.update(id, patch);
  }

  // ---- 设置 ----

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    const row = await this.db.settings.get(key);
    return (row?.value as T) ?? null;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.settings.put({ key, value });
  }

  // ---- 备份 ----

  async exportAll(): Promise<BackupFile> {
    const [semesters, students, enrollments, settingRows] = await Promise.all([
      this.db.semesters.toArray(),
      this.db.students.toArray(),
      this.db.enrollments.toArray(),
      this.db.settings.toArray()
    ]);

    const settings: Record<string, unknown> = {};
    settingRows.forEach(row => {
      settings[row.key] = row.value;
    });

    return {
      version: 1,
      exportedAt: nowISO(),
      semesters,
      students,
      enrollments,
      settings
    };
  }

  async importAll(data: BackupFile): Promise<void> {
    if (data.version !== 1) {
      throw new Error(`不支持的备份版本: ${data.version}`);
    }

    await this.db.transaction(
      'rw',
      [this.db.semesters, this.db.students, this.db.enrollments, this.db.settings],
      async () => {
        await Promise.all([
          this.db.semesters.clear(),
          this.db.students.clear(),
          this.db.enrollments.clear(),
          this.db.settings.clear()
        ]);
        await this.db.semesters.bulkPut(data.semesters);
        await this.db.students.bulkPut(data.students);
        await this.db.enrollments.bulkPut(data.enrollments);
        await this.db.settings.bulkPut(
          Object.entries(data.settings).map(([key, value]) => ({ key, value }))
        );
      }
    );
  }
}

/** 只保留 DTO 允许的字段，剔除 undefined 避免覆盖 */
function normalizeStudentInput(input: StudentInput): StudentInput {
  const normalized: StudentInput = {
    name: input.name.trim(),
    student_no: input.student_no.trim(),
    gender: input.gender
  };
  if (input.birth_date) normalized.birth_date = input.birth_date;
  if (input.parent_contact) normalized.parent_contact = input.parent_contact;
  if (input.address) normalized.address = input.address;
  if (input.notes) normalized.notes = input.notes;
  return normalized;
}
