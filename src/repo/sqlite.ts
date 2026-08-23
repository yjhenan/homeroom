/**
 * SQLite 实现（M4 桌面阶段）
 *
 * 存储策略：每表 (id TEXT PRIMARY KEY, data TEXT JSON)，data 存整个 DTO 的 JSON。
 * 与 Dexie 的"存对象"模型对称，DTO 零映射损失；查询用 json_extract 走表达式索引。
 * 硬规则与 dexie.ts 相同：组件/store 只见 ClassRepo 接口。
 */
import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { nanoid } from 'nanoid';
import type {
  Attendance,
  AttendanceInput,
  AttendanceQuery,
  BackupFile,
  ClassRepo,
  DisciplineEvent,
  DisciplineFilter,
  DisciplineInput,
  DocumentAttachment,
  DocumentInput,
  DocumentRecord,
  DutyInput,
  DutyRecord,
  CalendarMark,
  Enrollment,
  Exam,
  ExamInput,
  ImportConflictStrategy,
  ImportResult,
  Score,
  ScoreInput,
  Semester,
  SemesterInput,
  Student,
  StudentInput,
  StudentWithEnrollment
} from './types';

function genId(): string {
  return nanoid(12);
}

function nowISO(): string {
  return new Date().toISOString();
}

/** 表定义：id 主键 + data JSON 列 + 查询用表达式索引 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS semesters (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, data TEXT NOT NULL, student_no TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS enrollments (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attendance (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exams (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scores (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS discipline_events (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS duty_records (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE UNIQUE INDEX IF NOT EXISTS idx_enr_sem_stu ON enrollments (json_extract(data,'$.semester_id'), json_extract(data,'$.student_id'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_att_stu_date ON attendance (json_extract(data,'$.student_id'), json_extract(data,'$.date'));
CREATE INDEX IF NOT EXISTS idx_att_sem_date ON attendance (json_extract(data,'$.semester_id'), json_extract(data,'$.date'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_score_exam_stu_sub ON scores (json_extract(data,'$.exam_id'), json_extract(data,'$.student_id'), json_extract(data,'$.subject'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_duty_sem_date_area ON duty_records (json_extract(data,'$.semester_id'), json_extract(data,'$.date'), json_extract(data,'$.area'));
`;

/** DTO → 行 */
function toRow(dto: object): string {
  return JSON.stringify(dto);
}

/** 行 → DTO */
function fromRow<T>(row: { data: string }): T {
  return JSON.parse(row.data) as T;
}

export class SqliteClassRepo implements ClassRepo {
  private db: Database | null = null;
  private dbPath = '';

  private async load(): Promise<Database> {
    if (this.db) return this.db;
    const dir = (await invoke<string>('get_data_dir')).replace(/\\/g, '/');
    this.dbPath = `${dir}/class.db`;
    this.db = await Database.load(`sqlite:${this.dbPath}`);
    await this.db.execute(SCHEMA);
    return this.db;
  }

  // ---- 学期 ----

  async listSemesters(): Promise<Semester[]> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM semesters');
    return rows.map(fromRow<Semester>).sort((a, b) => a.id.localeCompare(b.id));
  }

  async getActiveSemester(): Promise<Semester | null> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>(
      "SELECT data FROM semesters WHERE json_extract(data,'$.is_active') = 1"
    );
    return rows[0] ? fromRow<Semester>(rows[0]) : null;
  }

  async createSemester(input: SemesterInput): Promise<Semester> {
    const db = await this.load();
    const semester: Semester = {
      id: input.id,
      name: input.name,
      start_date: input.start_date,
      end_date: input.end_date,
      is_active: Boolean(input.is_active)
    };
    if (input.is_active) {
      await db.execute("UPDATE semesters SET data = json_set(data, '$.is_active', json('false'))");
    }
    await db.execute('INSERT INTO semesters (id, data) VALUES ($1, $2)', [semester.id, toRow(semester)]);
    return semester;
  }

  async updateSemester(id: string, patch: Partial<Pick<Semester, 'name' | 'start_date' | 'end_date'>>): Promise<void> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM semesters WHERE id = $1', [id]);
    if (!rows[0]) return;
    const next = { ...fromRow<Semester>(rows[0]), ...patch };
    await db.execute('UPDATE semesters SET data = $1 WHERE id = $2', [toRow(next), id]);
  }

  async setActiveSemester(id: string): Promise<void> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM semesters WHERE id = $1', [id]);
    if (!rows[0]) throw new Error(`学期不存在: ${id}`);
    await db.execute("UPDATE semesters SET data = json_set(data, '$.is_active', json('false'))");
    await db.execute("UPDATE semesters SET data = json_set(data, '$.is_active', json('true')) WHERE id = $1", [id]);
  }

  async setSemesterArchived(id: string, archived: boolean): Promise<void> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM semesters WHERE id = $1', [id]);
    if (!rows[0]) throw new Error(`学期不存在: ${id}`);
    const sem = fromRow<Semester>(rows[0]);
    if (archived && sem.is_active) throw new Error('当前学期不能归档，请先切换到其他学期');
    await db.execute('UPDATE semesters SET data = $1 WHERE id = $2', [toRow({ ...sem, archived }), id]);
  }

  async setSemesterCalendar(id: string, calendar: Record<string, CalendarMark>): Promise<void> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM semesters WHERE id = $1', [id]);
    if (!rows[0]) throw new Error(`学期不存在: ${id}`);
    const sem = fromRow<Semester>(rows[0]);
    await db.execute('UPDATE semesters SET data = $1 WHERE id = $2', [toRow({ ...sem, calendar }), id]);
  }

  async copyRoster(fromSemesterId: string, toSemesterId: string): Promise<number> {
    if (fromSemesterId === toSemesterId) throw new Error('源学期与目标学期相同');
    const db = await this.load();
    await db.execute('BEGIN');
    try {
      const source = (
        await db.select<{ data: string }[]>(
          "SELECT data FROM enrollments WHERE json_extract(data,'$.semester_id') = $1",
          [fromSemesterId]
        )
      ).map(fromRow<Enrollment>);
      const existing = new Set(
        (
          await db.select<{ data: string }[]>(
            "SELECT data FROM enrollments WHERE json_extract(data,'$.semester_id') = $1",
            [toSemesterId]
          )
        )
          .map(fromRow<Enrollment>)
          .map(e => e.student_id)
      );
      const toAdd = source
        .filter(e => e.status === 'active' && !existing.has(e.student_id))
        .map(e => ({ id: genId(), semester_id: toSemesterId, student_id: e.student_id, status: 'active' as const }));
      for (const e of toAdd) {
        await db.execute('INSERT INTO enrollments (id, data) VALUES ($1, $2)', [e.id, toRow(e)]);
      }
      await db.execute('COMMIT');
      return toAdd.length;
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }
  }

  // ---- 学生 ----

  async listStudents(semesterId?: string): Promise<StudentWithEnrollment[]> {
    const db = await this.load();
    if (!semesterId) {
      const rows = await db.select<{ data: string }[]>('SELECT data FROM students');
      return rows.map(fromRow<Student>).sort((a, b) => a.student_no.localeCompare(b.student_no, 'zh-CN'));
    }
    const enrollments = (
      await db.select<{ data: string }[]>(
        "SELECT data FROM enrollments WHERE json_extract(data,'$.semester_id') = $1",
        [semesterId]
      )
    ).map(fromRow<Enrollment>);
    const rows: StudentWithEnrollment[] = [];
    for (const enrollment of enrollments) {
      const st = await db.select<{ data: string }[]>('SELECT data FROM students WHERE id = $1', [
        enrollment.student_id
      ]);
      if (st[0]) rows.push({ ...fromRow<Student>(st[0]), enrollment });
    }
    return rows.sort((a, b) => a.student_no.localeCompare(b.student_no, 'zh-CN'));
  }

  async getStudent(id: string): Promise<Student | null> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM students WHERE id = $1', [id]);
    return rows[0] ? fromRow<Student>(rows[0]) : null;
  }

  async createStudent(input: StudentInput, semesterId: string): Promise<Student> {
    const db = await this.load();
    const now = nowISO();
    const student: Student = { id: genId(), created_at: now, updated_at: now, ...normalizeStudentInput(input) };
    await this.assertStudentNoUnique(student.student_no);
    await db.execute('BEGIN');
    try {
      await db.execute('INSERT INTO students (id, data, student_no) VALUES ($1, $2, $3)', [
        student.id,
        toRow(student),
        student.student_no
      ]);
      await db.execute('INSERT INTO enrollments (id, data) VALUES ($1, $2)', [
        genId(),
        toRow({ id: genId(), semester_id: semesterId, student_id: student.id, status: 'active' })
      ]);
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }
    return student;
  }

  async updateStudent(id: string, patch: Partial<StudentInput>): Promise<Student> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM students WHERE id = $1', [id]);
    if (!rows[0]) throw new Error(`学生不存在: ${id}`);
    const existing = fromRow<Student>(rows[0]);
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
    await db.execute('UPDATE students SET data = $1, student_no = $2 WHERE id = $3', [
      toRow(next),
      next.student_no,
      id
    ]);
    return next;
  }

  async deleteStudent(
    id: string
  ): Promise<{ enrollments: number; attendance: number; scores: number; discipline: number }> {
    const db = await this.load();
    const enr = await db.select<{ data: string }[]>(
      "SELECT data FROM enrollments WHERE json_extract(data,'$.student_id') = $1",
      [id]
    );
    const att = await db.select<{ data: string }[]>(
      "SELECT data FROM attendance WHERE json_extract(data,'$.student_id') = $1",
      [id]
    );
    const sco = await db.select<{ data: string }[]>(
      "SELECT data FROM scores WHERE json_extract(data,'$.student_id') = $1",
      [id]
    );
    const dis = await db.select<{ data: string }[]>(
      "SELECT data FROM discipline_events WHERE json_extract(data,'$.student_id') = $1",
      [id]
    );
    // 值日记录里移除该学生
    const duty = (
      await db.select<{ data: string }[]>(
        "SELECT data FROM duty_records WHERE json_extract(data,'$.student_ids') LIKE $1",
        [`%"${id}"%`]
      )
    ).map(fromRow<DutyRecord>);
    await db.execute('BEGIN');
    try {
      await db.execute('DELETE FROM students WHERE id = $1', [id]);
      await db.execute("DELETE FROM enrollments WHERE json_extract(data,'$.student_id') = $1", [id]);
      await db.execute("DELETE FROM attendance WHERE json_extract(data,'$.student_id') = $1", [id]);
      await db.execute("DELETE FROM scores WHERE json_extract(data,'$.student_id') = $1", [id]);
      await db.execute("DELETE FROM discipline_events WHERE json_extract(data,'$.student_id') = $1", [id]);
      for (const d of duty) {
        if (d.student_ids.includes(id)) {
          await db.execute('UPDATE duty_records SET data = $1 WHERE id = $2', [
            toRow({ ...d, student_ids: d.student_ids.filter(s => s !== id) }),
            d.id
          ]);
        }
      }
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }
    return { enrollments: enr.length, attendance: att.length, scores: sco.length, discipline: dis.length };
  }

  async importStudents(
    rows: StudentInput[],
    semesterId: string,
    strategy: ImportConflictStrategy
  ): Promise<ImportResult> {
    const db = await this.load();
    const result: ImportResult = { created: 0, updated: 0, skipped: 0 };
    const existing = (
      await db.select<{ data: string; student_no: string }[]>('SELECT data, student_no FROM students')
    ).map(r => fromRow<Student>(r));
    const byNo = new Map(existing.map(s => [s.student_no, s]));
    const semesterEnrollments = (
      await db.select<{ data: string }[]>(
        "SELECT data FROM enrollments WHERE json_extract(data,'$.semester_id') = $1",
        [semesterId]
      )
    ).map(fromRow<Enrollment>);
    const enrolledStudentIds = new Set(semesterEnrollments.map(e => e.student_id));

    await db.execute('BEGIN');
    try {
      for (const input of rows) {
        const normalized = normalizeStudentInput(input);
        const prev = byNo.get(normalized.student_no);
        if (!prev) {
          const student: Student = { id: genId(), created_at: nowISO(), updated_at: nowISO(), ...normalized };
          await db.execute('INSERT INTO students (id, data, student_no) VALUES ($1, $2, $3)', [
            student.id,
            toRow(student),
            student.student_no
          ]);
          byNo.set(student.student_no, student);
          result.created += 1;
          await db.execute('INSERT INTO enrollments (id, data) VALUES ($1, $2)', [
            genId(),
            toRow({ id: genId(), semester_id: semesterId, student_id: student.id, status: 'active' })
          ]);
          continue;
        }
        if (strategy === 'skip') {
          result.skipped += 1;
        } else {
          const next = { ...prev, ...normalized, id: prev.id, created_at: prev.created_at, updated_at: nowISO() };
          await db.execute('UPDATE students SET data = $1, student_no = $2 WHERE id = $3', [
            toRow(next),
            next.student_no,
            prev.id
          ]);
          result.updated += 1;
        }
        if (!enrolledStudentIds.has(prev.id)) {
          await db.execute('INSERT INTO enrollments (id, data) VALUES ($1, $2)', [
            genId(),
            toRow({ id: genId(), semester_id: semesterId, student_id: prev.id, status: 'active' })
          ]);
          enrolledStudentIds.add(prev.id);
        }
      }
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }
    return result;
  }

  async countStudentRecords(
    studentId: string
  ): Promise<{ enrollments: number; attendance: number; scores: number; discipline: number }> {
    const db = await this.load();
    const count = async (table: string) => {
      const r = await db.select<{ n: number }[]>(
        `SELECT COUNT(*) as n FROM ${table} WHERE json_extract(data,'$.student_id') = $1`,
        [studentId]
      );
      return r[0]?.n ?? 0;
    };
    return {
      enrollments: await count('enrollments'),
      attendance: await count('attendance'),
      scores: await count('scores'),
      discipline: await count('discipline_events')
    };
  }

  private async assertStudentNoUnique(studentNo: string, excludeId?: string): Promise<void> {
    const db = await this.load();
    const rows = await db.select<{ id: string; data: string }[]>(
      'SELECT id, data FROM students WHERE student_no = $1',
      [studentNo]
    );
    const dup = rows.find(r => r.id !== excludeId);
    if (dup) throw new Error(`学号已存在: ${studentNo}`);
  }

  async listEnrollments(semesterId: string): Promise<Enrollment[]> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>(
      "SELECT data FROM enrollments WHERE json_extract(data,'$.semester_id') = $1",
      [semesterId]
    );
    return rows.map(fromRow<Enrollment>);
  }

  async updateEnrollment(id: string, patch: Partial<Pick<Enrollment, 'seat_no' | 'status'>>): Promise<void> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM enrollments WHERE id = $1', [id]);
    if (!rows[0]) return;
    const next = { ...fromRow<Enrollment>(rows[0]), ...patch };
    await db.execute('UPDATE enrollments SET data = $1 WHERE id = $2', [toRow(next), id]);
  }

  // ---- 考勤 ----

  async getAttendanceByDate(semesterId: string, date: string): Promise<Attendance[]> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>(
      "SELECT data FROM attendance WHERE json_extract(data,'$.semester_id') = $1 AND json_extract(data,'$.date') = $2",
      [semesterId, date]
    );
    return rows.map(fromRow<Attendance>);
  }

  async saveAttendanceForDate(semesterId: string, date: string, rows: AttendanceInput[]): Promise<void> {
    const db = await this.load();
    const semRows = await db.select<{ data: string }[]>('SELECT data FROM semesters WHERE id = $1', [semesterId]);
    if (!semRows[0]) throw new Error(`学期不存在: ${semesterId}`);
    // 上课日校验在 UI 层完成（依赖教学日历推导）；此处信任调用方
    await db.execute('BEGIN');
    try {
      await db.execute(
        "DELETE FROM attendance WHERE json_extract(data,'$.semester_id') = $1 AND json_extract(data,'$.date') = $2",
        [semesterId, date]
      );
      const records = rows
        .filter(r => r.status !== 'present')
        .map(input => ({
          id: genId(),
          semester_id: semesterId,
          student_id: input.student_id,
          date,
          status: input.status,
          ...(input.remark ? { remark: input.remark } : {})
        }));
      for (const r of records) {
        await db.execute('INSERT INTO attendance (id, data) VALUES ($1, $2)', [r.id, toRow(r)]);
      }
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }
  }

  async queryAttendance(query: AttendanceQuery): Promise<Attendance[]> {
    const db = await this.load();
    let sql = "SELECT data FROM attendance WHERE json_extract(data,'$.semester_id') = $1";
    const params: unknown[] = [query.semesterId];
    if (query.from && query.to) {
      sql += " AND json_extract(data,'$.date') BETWEEN $2 AND $3";
      params.push(query.from, query.to);
    } else if (query.from) {
      sql += " AND json_extract(data,'$.date') >= $2";
      params.push(query.from);
    } else if (query.to) {
      sql += " AND json_extract(data,'$.date') <= $2";
      params.push(query.to);
    }
    if (query.studentId) {
      sql += ` AND json_extract(data,'$.student_id') = $${params.length + 1}`;
      params.push(query.studentId);
    }
    const rows = await db.select<{ data: string }[]>(sql, params);
    let list = rows.map(fromRow<Attendance>);
    if (query.statuses && query.statuses.length) {
      list = list.filter(r => query.statuses!.includes(r.status));
    }
    return list.sort((a, b) =>
      a.date === b.date ? a.student_id.localeCompare(b.student_id) : a.date.localeCompare(b.date)
    );
  }

  // ---- 考试与成绩 ----

  async listExams(semesterId: string): Promise<Exam[]> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>(
      "SELECT data FROM exams WHERE json_extract(data,'$.semester_id') = $1",
      [semesterId]
    );
    return rows.map(fromRow<Exam>).sort((a, b) => a.date.localeCompare(b.date));
  }

  async createExam(input: ExamInput, semesterId: string): Promise<Exam> {
    const db = await this.load();
    const exam: Exam = {
      id: genId(),
      semester_id: semesterId,
      name: input.name.trim(),
      date: input.date,
      type: input.type,
      subjects: input.subjects ?? [],
      ...(input.subject_conf ? { subject_conf: input.subject_conf } : {}),
      created_at: nowISO()
    };
    await this.assertWritable(db, semesterId);
    await db.execute('INSERT INTO exams (id, data) VALUES ($1, $2)', [exam.id, toRow(exam)]);
    return exam;
  }

  async updateExam(id: string, patch: Partial<ExamInput>): Promise<void> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM exams WHERE id = $1', [id]);
    if (!rows[0]) throw new Error(`考试不存在: ${id}`);
    const prev = fromRow<Exam>(rows[0]);
    await this.assertWritable(db, prev.semester_id);
    const next = { ...prev, ...patch, id, semester_id: prev.semester_id, created_at: prev.created_at };
    await db.execute('UPDATE exams SET data = $1 WHERE id = $2', [toRow(next), id]);
  }

  async deleteExam(id: string): Promise<{ scores: number }> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM exams WHERE id = $1', [id]);
    if (rows[0]) {
      await this.assertWritable(db, fromRow<Exam>(rows[0]).semester_id);
    }
    const sco = await db.select<{ data: string }[]>(
      "SELECT data FROM scores WHERE json_extract(data,'$.exam_id') = $1",
      [id]
    );
    await db.execute('BEGIN');
    try {
      await db.execute("DELETE FROM scores WHERE json_extract(data,'$.exam_id') = $1", [id]);
      await db.execute('DELETE FROM exams WHERE id = $1', [id]);
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }
    return { scores: sco.length };
  }

  async getScoresBySubject(examId: string, subject: string): Promise<Score[]> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>(
      "SELECT data FROM scores WHERE json_extract(data,'$.exam_id') = $1 AND json_extract(data,'$.subject') = $2",
      [examId, subject]
    );
    return rows.map(fromRow<Score>);
  }

  async saveScoresForSubject(examId: string, subject: string, rows: ScoreInput[]): Promise<void> {
    const db = await this.load();
    const examRows = await db.select<{ data: string }[]>('SELECT data FROM exams WHERE id = $1', [examId]);
    if (!examRows[0]) throw new Error(`考试不存在: ${examId}`);
    const exam = fromRow<Exam>(examRows[0]);
    await this.assertWritable(db, exam.semester_id);
    await db.execute('BEGIN');
    try {
      await db.execute(
        "DELETE FROM scores WHERE json_extract(data,'$.exam_id') = $1 AND json_extract(data,'$.subject') = $2",
        [examId, subject]
      );
      const now = nowISO();
      for (const r of rows) {
        const score: Score = {
          id: genId(),
          exam_id: examId,
          student_id: r.student_id,
          semester_id: exam.semester_id,
          subject,
          score: r.score,
          updated_at: now
        };
        await db.execute('INSERT INTO scores (id, data) VALUES ($1, $2)', [score.id, toRow(score)]);
      }
      if (!exam.subjects.includes(subject)) {
        await db.execute('UPDATE exams SET data = $1 WHERE id = $2', [
          toRow({ ...exam, subjects: [...exam.subjects, subject] }),
          examId
        ]);
      }
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }
  }

  async getScoresByExam(examId: string): Promise<Score[]> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>(
      "SELECT data FROM scores WHERE json_extract(data,'$.exam_id') = $1",
      [examId]
    );
    return rows.map(fromRow<Score>);
  }

  async getScoresByStudent(semesterId: string, studentId: string): Promise<Score[]> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>(
      "SELECT data FROM scores WHERE json_extract(data,'$.semester_id') = $1 AND json_extract(data,'$.student_id') = $2",
      [semesterId, studentId]
    );
    return rows.map(fromRow<Score>);
  }

  async deleteScoresBySubject(examId: string, subject: string): Promise<number> {
    const db = await this.load();
    const examRows = await db.select<{ data: string }[]>('SELECT data FROM exams WHERE id = $1', [examId]);
    if (!examRows[0]) throw new Error(`考试不存在: ${examId}`);
    const exam = fromRow<Exam>(examRows[0]);
    await this.assertWritable(db, exam.semester_id);
    const prev = await this.getScoresBySubject(examId, subject);
    await db.execute('BEGIN');
    try {
      await db.execute(
        "DELETE FROM scores WHERE json_extract(data,'$.exam_id') = $1 AND json_extract(data,'$.subject') = $2",
        [examId, subject]
      );
      await db.execute('UPDATE exams SET data = $1 WHERE id = $2', [
        toRow({ ...exam, subjects: exam.subjects.filter(s => s !== subject) }),
        examId
      ]);
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }
    return prev.length;
  }

  // ---- 德育 ----

  async listDisciplineEvents(semesterId: string, filter?: DisciplineFilter): Promise<DisciplineEvent[]> {
    const db = await this.load();
    let sql = "SELECT data FROM discipline_events WHERE json_extract(data,'$.semester_id') = $1";
    const params: unknown[] = [semesterId];
    if (filter?.studentId) {
      sql += ` AND json_extract(data,'$.student_id') = $${params.length + 1}`;
      params.push(filter.studentId);
    }
    const rows = await db.select<{ data: string }[]>(sql, params);
    let list = rows.map(fromRow<DisciplineEvent>);
    if (filter?.category) list = list.filter(e => e.category === filter.category);
    if (filter?.direction) list = list.filter(e => e.direction === filter.direction);
    return list.sort((a, b) =>
      a.date === b.date ? b.created_at.localeCompare(a.created_at) : b.date.localeCompare(a.date)
    );
  }

  async addDisciplineEvents(input: DisciplineInput, semesterId: string): Promise<number> {
    const db = await this.load();
    await this.assertWritable(db, semesterId);
    const now = nowISO();
    const events = input.student_ids.map(sid => ({
      id: genId(),
      semester_id: semesterId,
      student_id: sid,
      date: input.date,
      direction: input.direction,
      category: input.category,
      ...(input.points !== undefined ? { points: input.points } : {}),
      description: input.description.trim(),
      created_at: now
    }));
    await db.execute('BEGIN');
    try {
      for (const e of events) {
        await db.execute('INSERT INTO discipline_events (id, data) VALUES ($1, $2)', [e.id, toRow(e)]);
      }
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }
    return events.length;
  }

  async deleteDisciplineEvent(id: string): Promise<void> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM discipline_events WHERE id = $1', [id]);
    if (rows[0]) {
      await this.assertWritable(db, fromRow<DisciplineEvent>(rows[0]).semester_id);
    }
    await db.execute('DELETE FROM discipline_events WHERE id = $1', [id]);
  }

  async getDisciplineByStudent(semesterId: string, studentId: string): Promise<DisciplineEvent[]> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>(
      "SELECT data FROM discipline_events WHERE json_extract(data,'$.semester_id') = $1 AND json_extract(data,'$.student_id') = $2",
      [semesterId, studentId]
    );
    return rows.map(fromRow<DisciplineEvent>).sort((a, b) => b.date.localeCompare(a.date));
  }

  // ---- 值日 ----

  async listDutyRecords(semesterId: string, from?: string, to?: string): Promise<DutyRecord[]> {
    const db = await this.load();
    let sql = "SELECT data FROM duty_records WHERE json_extract(data,'$.semester_id') = $1";
    const params: unknown[] = [semesterId];
    if (from && to) {
      sql += " AND json_extract(data,'$.date') BETWEEN $2 AND $3";
      params.push(from, to);
    }
    const rows = await db.select<{ data: string }[]>(sql, params);
    return rows.map(fromRow<DutyRecord>).sort((a, b) => a.date.localeCompare(b.date));
  }

  async saveDutyRecord(input: DutyInput, semesterId: string): Promise<DutyRecord> {
    const db = await this.load();
    const record: DutyRecord = {
      id: genId(),
      semester_id: semesterId,
      date: input.date,
      student_ids: [...input.student_ids],
      area: input.area,
      evaluation: input.evaluation ?? 'ok',
      updated_at: nowISO(),
      ...(input.group_name ? { group_name: input.group_name } : {}),
      ...(input.remark ? { remark: input.remark } : {})
    };
    await db.execute('BEGIN');
    try {
      await db.execute(
        "DELETE FROM duty_records WHERE json_extract(data,'$.semester_id') = $1 AND json_extract(data,'$.date') = $2 AND json_extract(data,'$.area') = $3",
        [semesterId, input.date, input.area]
      );
      await db.execute('INSERT INTO duty_records (id, data) VALUES ($1, $2)', [record.id, toRow(record)]);
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }
    return record;
  }

  async deleteDutyRecord(id: string): Promise<void> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM duty_records WHERE id = $1', [id]);
    if (rows[0]) {
      await this.assertWritable(db, fromRow<DutyRecord>(rows[0]).semester_id);
    }
    await db.execute('DELETE FROM duty_records WHERE id = $1', [id]);
  }

  async getDutyByStudent(semesterId: string, studentId: string): Promise<DutyRecord[]> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>(
      "SELECT data FROM duty_records WHERE json_extract(data,'$.semester_id') = $1",
      [semesterId]
    );
    return rows
      .map(fromRow<DutyRecord>)
      .filter(r => r.student_ids.includes(studentId))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  // ---- 文档 ----

  async listDocuments(semesterId: string): Promise<DocumentRecord[]> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>(
      "SELECT data FROM documents WHERE json_extract(data,'$.semester_id') = $1",
      [semesterId]
    );
    return rows.map(fromRow<DocumentRecord>).sort((a, b) => b.date.localeCompare(a.date));
  }

  async createDocument(input: DocumentInput, semesterId: string): Promise<DocumentRecord> {
    const db = await this.load();
    await this.assertWritable(db, semesterId);
    const record: DocumentRecord = {
      id: genId(),
      semester_id: semesterId,
      title: input.title.trim(),
      category: input.category,
      date: input.date,
      created_at: nowISO(),
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.attachment ? { attachment: input.attachment } : {})
    };
    await db.execute('INSERT INTO documents (id, data) VALUES ($1, $2)', [record.id, toRow(record)]);
    return record;
  }

  async updateDocument(
    id: string,
    patch: Partial<Omit<DocumentInput, 'attachment'>> & { attachment?: DocumentAttachment | null }
  ): Promise<void> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM documents WHERE id = $1', [id]);
    if (!rows[0]) throw new Error(`文档不存在: ${id}`);
    const existing = fromRow<DocumentRecord>(rows[0]);
    await this.assertWritable(db, existing.semester_id);
    const next: DocumentRecord = { ...existing };
    if (patch.title !== undefined) next.title = patch.title.trim();
    if (patch.category !== undefined) next.category = patch.category;
    if (patch.date !== undefined) next.date = patch.date;
    if (patch.summary !== undefined) next.summary = patch.summary || undefined;
    if (patch.attachment !== undefined) {
      next.attachment = patch.attachment === null ? undefined : patch.attachment;
    }
    await db.execute('UPDATE documents SET data = $1 WHERE id = $2', [toRow(next), id]);
  }

  async deleteDocument(id: string): Promise<void> {
    const db = await this.load();
    const rows = await db.select<{ data: string }[]>('SELECT data FROM documents WHERE id = $1', [id]);
    if (rows[0]) {
      await this.assertWritable(db, fromRow<DocumentRecord>(rows[0]).semester_id);
    }
    await db.execute('DELETE FROM documents WHERE id = $1', [id]);
  }

  // ---- 设置 ----

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    const db = await this.load();
    const rows = await db.select<{ value: string }[]>('SELECT value FROM settings WHERE key = $1', [key]);
    return rows[0] ? (JSON.parse(rows[0].value) as T) : null;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    const db = await this.load();
    await db.execute('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2', [
      key,
      JSON.stringify(value)
    ]);
  }

  // ---- 备份 ----

  async exportAll(): Promise<BackupFile> {
    const db = await this.load();
    const grab = async <T>(table: string): Promise<T[]> => {
      const rows = await db.select<{ data: string }[]>(`SELECT data FROM ${table}`);
      return rows.map(fromRow<T>);
    };
    const settingRows = await db.select<{ key: string; value: string }[]>('SELECT key, value FROM settings');
    const settings: Record<string, unknown> = {};
    settingRows.forEach(r => {
      settings[r.key] = JSON.parse(r.value);
    });
    return {
      version: 1,
      exportedAt: nowISO(),
      semesters: await grab<Semester>('semesters'),
      students: await grab<Student>('students'),
      enrollments: await grab<Enrollment>('enrollments'),
      attendance: await grab<Attendance>('attendance'),
      exams: await grab<Exam>('exams'),
      scores: await grab<Score>('scores'),
      discipline_events: await grab<DisciplineEvent>('discipline_events'),
      duty_records: await grab<DutyRecord>('duty_records'),
      documents: await grab<DocumentRecord>('documents'),
      settings
    };
  }

  async importAll(data: BackupFile): Promise<void> {
    if (data.version !== 1) throw new Error(`不支持的备份版本: ${data.version}`);
    const db = await this.load();
    const put = async (table: string, items: object[] | undefined) => {
      if (!items) return;
      for (const item of items) {
        await db.execute(`INSERT OR REPLACE INTO ${table} (id, data) VALUES ($1, $2)`, [
          (item as { id: string }).id,
          toRow(item)
        ]);
      }
    };
    await db.execute('BEGIN');
    try {
      for (const t of [
        'semesters',
        'students',
        'enrollments',
        'attendance',
        'exams',
        'scores',
        'discipline_events',
        'duty_records',
        'documents',
        'settings'
      ]) {
        await db.execute(`DELETE FROM ${t}`);
      }
      await put('semesters', data.semesters);
      await put('students', data.students);
      await put('enrollments', data.enrollments);
      await put('attendance', data.attendance);
      await put('exams', data.exams);
      await put('scores', data.scores);
      await put('discipline_events', data.discipline_events);
      await put('duty_records', data.duty_records);
      await put('documents', data.documents);
      for (const [key, value] of Object.entries(data.settings)) {
        await db.execute(
          'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2',
          [key, JSON.stringify(value)]
        );
      }
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }
  }

  /** 归档学期只读校验 */
  private async assertWritable(db: Database, semesterId: string): Promise<void> {
    const rows = await db.select<{ data: string }[]>('SELECT data FROM semesters WHERE id = $1', [semesterId]);
    if (rows[0]) {
      const sem = fromRow<Semester>(rows[0]);
      if (sem.archived) throw new Error(`学期已归档，只读：${sem.name}`);
    }
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
