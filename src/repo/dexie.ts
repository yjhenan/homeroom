import Dexie from 'dexie';
import type { Table } from 'dexie';
import { nanoid } from 'nanoid';
import { calendarOf, isSchoolDay } from '@/utils/date';
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
  attendance!: Table<Attendance, string>;
  exams!: Table<Exam, string>;
  scores!: Table<Score, string>;
  discipline_events!: Table<DisciplineEvent, string>;
  duty_records!: Table<DutyRecord, string>;
  documents!: Table<DocumentRecord, string>;
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

    // v2 (M2)：attendance 考勤表；&(student_id+date) 唯一（当天每生一行）
    // date 为 YYYY-MM-DD 字符串，字典序即时间序，直接 between 范围查
    this.version(2)
      .stores({
        attendance: 'id, &[student_id+date], [semester_id+date], semester_id, student_id, date, status'
      })
      .upgrade(() => {
        // 新增表无需数据迁移，保留空 upgrade 以显式声明版本意图
        return Promise.resolve();
      });

    // v3 (M3)：成绩/德育/值日/文档五表；semesters 补 archived 字段
    this.version(3)
      .stores({
        exams: 'id, semester_id, date',
        scores: 'id, &[exam_id+student_id+subject], exam_id, student_id, semester_id',
        discipline_events: 'id, semester_id, student_id, date',
        duty_records: 'id, &[semester_id+date+area], semester_id, date',
        documents: 'id, semester_id, date'
      })
      .upgrade(trans => {
        // 老学期行补 archived=false（新表无需迁移）
        return trans
          .table('semesters')
          .toCollection()
          .modify(s => {
            if (s.archived === undefined) {
              s.archived = false;
            }
          });
      });

    // v4：考勤改纯异常存储——出勤由教学日历推导，present 行不再落库，存量清除
    this.version(4).upgrade(trans => {
      return trans
        .table('attendance')
        .filter(r => r.status === 'present')
        .delete();
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

  async setSemesterArchived(id: string, archived: boolean): Promise<void> {
    const target = await this.db.semesters.get(id);
    if (!target) {
      throw new Error(`学期不存在: ${id}`);
    }
    if (archived && target.is_active) {
      throw new Error('当前学期不能归档，请先切换到其他学期');
    }
    await this.db.semesters.update(id, { archived });
  }

  async setSemesterCalendar(id: string, calendar: Record<string, CalendarMark>): Promise<void> {
    const target = await this.db.semesters.get(id);
    if (!target) {
      throw new Error(`学期不存在: ${id}`);
    }
    // 覆盖写：旧 holidays 列表保留兼容但以 calendar 为准
    await this.db.semesters.update(id, { calendar });
  }

  async copyRoster(fromSemesterId: string, toSemesterId: string): Promise<number> {
    if (fromSemesterId === toSemesterId) {
      throw new Error('源学期与目标学期相同');
    }
    return this.db.transaction('rw', this.db.enrollments, async () => {
      const source = await this.db.enrollments.where('semester_id').equals(fromSemesterId).toArray();
      const existing = new Set(
        (await this.db.enrollments.where('semester_id').equals(toSemesterId).toArray()).map(e => e.student_id)
      );
      const toAdd = source
        .filter(e => e.status === 'active' && !existing.has(e.student_id))
        .map(e => ({ id: genId(), semester_id: toSemesterId, student_id: e.student_id, status: 'active' as const }));
      if (toAdd.length) {
        await this.db.enrollments.bulkAdd(toAdd);
      }
      return toAdd.length;
    });
  }

  async deleteSemester(
    id: string
  ): Promise<{
    students: number;
    enrollments: number;
    attendance: number;
    scores: number;
    discipline: number;
    duty: number;
    documents: number;
  }> {
    const target = await this.db.semesters.get(id);
    if (!target) throw new Error(`学期不存在: ${id}`);
    if (target.is_active) throw new Error('当前学期不能删除，请先切换到其他学期');

    // 学生实体仅当全部名册被删后才能删（学生可能跨学期）
    const enrollments = await this.db.enrollments.where('semester_id').equals(id).toArray();
    const enrollmentStudentIds = enrollments.map(e => e.student_id);
    // 该生在其他学期是否还有名册
    const otherEnrollments = await this.db.enrollments.where('student_id').anyOf(enrollmentStudentIds).toArray();
    const stillEnrolledElsewhere = new Set(otherEnrollments.filter(e => e.semester_id !== id).map(e => e.student_id));

    const attendance = await this.db.attendance.where('semester_id').equals(id).toArray();
    const scores = await this.db.scores.where('semester_id').equals(id).toArray();
    const discipline = await this.db.discipline_events.where('semester_id').equals(id).toArray();
    const duty = await this.db.duty_records.where('semester_id').equals(id).toArray();
    const documents = await this.db.documents.where('semester_id').equals(id).toArray();

    // 本学期的考勤/成绩/德育记录按 (semester, student) 删；值日/文档按 semester 删
    await this.db.transaction(
      'rw',
      [
        this.db.semesters,
        this.db.students,
        this.db.enrollments,
        this.db.attendance,
        this.db.scores,
        this.db.discipline_events,
        this.db.duty_records,
        this.db.documents
      ],
      async () => {
        await this.db.enrollments.where('semester_id').equals(id).delete();
        await this.db.attendance.where('semester_id').equals(id).delete();
        await this.db.scores.where('semester_id').equals(id).delete();
        await this.db.discipline_events.where('semester_id').equals(id).delete();
        await this.db.duty_records.where('semester_id').equals(id).delete();
        await this.db.documents.where('semester_id').equals(id).delete();
        await this.db.semesters.delete(id);
        // 仅属于本学期的学生实体也删除（他处无名册）
        const removable = enrollmentStudentIds.filter(sid => !stillEnrolledElsewhere.has(sid));
        await this.db.students.bulkDelete(removable);
      }
    );

    return {
      students: enrollmentStudentIds.filter(sid => !stillEnrolledElsewhere.has(sid)).length,
      enrollments: enrollments.length,
      attendance: attendance.length,
      scores: scores.length,
      discipline: discipline.length,
      duty: duty.length,
      documents: documents.length
    };
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

  async deleteStudent(
    id: string
  ): Promise<{ enrollments: number; attendance: number; scores: number; discipline: number }> {
    return this.db.transaction(
      'rw',
      [
        this.db.students,
        this.db.enrollments,
        this.db.attendance,
        this.db.scores,
        this.db.discipline_events,
        this.db.duty_records
      ],
      async () => {
        const removedEnrollments = await this.db.enrollments.where('student_id').equals(id).delete();
        const removedAttendance = await this.db.attendance.where('student_id').equals(id).delete();
        const removedScores = await this.db.scores.where('student_id').equals(id).delete();
        const removedDiscipline = await this.db.discipline_events.where('student_id').equals(id).delete();
        // 值日记录里移除该学生（保留记录本身）
        const duty = await this.db.duty_records.filter(r => r.student_ids.includes(id)).toArray();
        await Promise.all(
          duty.map(r => this.db.duty_records.update(r.id, { student_ids: r.student_ids.filter(sid => sid !== id) }))
        );
        await this.db.students.delete(id);
        return {
          enrollments: removedEnrollments,
          attendance: removedAttendance,
          scores: removedScores,
          discipline: removedDiscipline
        };
      }
    );
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

  async countStudentRecords(
    studentId: string
  ): Promise<{ enrollments: number; attendance: number; scores: number; discipline: number }> {
    return {
      enrollments: await this.db.enrollments.where('student_id').equals(studentId).count(),
      attendance: await this.db.attendance.where('student_id').equals(studentId).count(),
      scores: await this.db.scores.where('student_id').equals(studentId).count(),
      discipline: await this.db.discipline_events.where('student_id').equals(studentId).count()
    };
  }

  // ---- 考勤 ----

  async getAttendanceByDate(semesterId: string, date: string): Promise<Attendance[]> {
    return this.db.attendance.where('[semester_id+date]').equals([semesterId, date]).toArray();
  }

  async saveAttendanceForDate(semesterId: string, date: string, rows: AttendanceInput[]): Promise<void> {
    await this.db.transaction('rw', [this.db.semesters, this.db.attendance], async () => {
      const sem = await this.db.semesters.get(semesterId);
      if (!sem) {
        throw new Error(`学期不存在: ${semesterId}`);
      }
      // 日历是唯一事实：只有上课日（学期内工作日 / 任何 school 标记，如开学前军训）才能录考勤
      if (!isSchoolDay(date, sem.start_date, sem.end_date, calendarOf(sem))) {
        throw new Error(`日期 ${date} 不是上课日（周末/假期/学期外）；如需录入请先在教学日历标记补课`);
      }
      // 全量替换该 (semester, date) 的异常记录；出勤不落库（由教学日历推导，全勤日存空即可）
      await this.db.attendance.where('[semester_id+date]').equals([semesterId, date]).delete();

      const records: Attendance[] = rows
        .filter(r => r.status !== 'present')
        .map(input => ({
          id: genId(),
          semester_id: semesterId,
          student_id: input.student_id,
          date,
          status: input.status,
          ...(input.remark ? { remark: input.remark } : {})
        }));
      if (records.length) {
        await this.db.attendance.bulkAdd(records);
      }
    });
  }

  async queryAttendance(query: AttendanceQuery): Promise<Attendance[]> {
    const { semesterId, from, to, studentId, statuses } = query;

    let collection;
    if (from && to) {
      collection = this.db.attendance.where('date').between(from, to, true, true);
    } else if (from) {
      collection = this.db.attendance.where('date').aboveOrEqual(from);
    } else if (to) {
      collection = this.db.attendance.where('date').belowOrEqual(to);
    } else {
      collection = this.db.attendance.toCollection();
    }

    let rows = await collection.filter(row => row.semester_id === semesterId).toArray();

    if (studentId) {
      rows = rows.filter(row => row.student_id === studentId);
    }
    if (statuses && statuses.length) {
      rows = rows.filter(row => statuses.includes(row.status));
    }

    return rows.sort((a, b) =>
      a.date === b.date ? a.student_id.localeCompare(b.student_id) : a.date.localeCompare(b.date)
    );
  }

  // ---- 考试与成绩 ----

  async listExams(semesterId: string): Promise<Exam[]> {
    const rows = await this.db.exams.where('semester_id').equals(semesterId).toArray();
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  async createExam(input: ExamInput, semesterId: string): Promise<Exam> {
    await assertSemesterWritable(this.db, semesterId);
    const exam: Exam = {
      id: genId(),
      semester_id: semesterId,
      name: input.name.trim(),
      date: input.date,
      type: input.type,
      subjects: input.subjects ?? [],
      created_at: nowISO()
    };
    await this.db.exams.add(exam);
    return exam;
  }

  async updateExam(id: string, patch: Partial<ExamInput>): Promise<void> {
    const existing = await this.db.exams.get(id);
    if (!existing) {
      throw new Error(`考试不存在: ${id}`);
    }
    await assertSemesterWritable(this.db, existing.semester_id);
    await this.db.exams.update(id, patch);
  }

  async deleteExam(id: string): Promise<{ scores: number }> {
    return this.db.transaction('rw', [this.db.semesters, this.db.exams, this.db.scores], async () => {
      const existing = await this.db.exams.get(id);
      if (existing) {
        await assertSemesterWritable(this.db, existing.semester_id);
      }
      const removed = await this.db.scores.where('exam_id').equals(id).delete();
      await this.db.exams.delete(id);
      return { scores: removed };
    });
  }

  async getScoresBySubject(examId: string, subject: string): Promise<Score[]> {
    const rows = await this.db.scores.where('exam_id').equals(examId).toArray();
    return rows.filter(s => s.subject === subject);
  }

  async saveScoresForSubject(examId: string, subject: string, rows: ScoreInput[]): Promise<void> {
    await this.db.transaction('rw', [this.db.semesters, this.db.exams, this.db.scores], async () => {
      const exam = await this.db.exams.get(examId);
      if (!exam) {
        throw new Error(`考试不存在: ${examId}`);
      }
      await assertSemesterWritable(this.db, exam.semester_id);

      // 全量替换该 (exam, subject)
      const prev = await this.db.scores.where('exam_id').equals(examId).toArray();
      const prevIds = prev.filter(s => s.subject === subject).map(s => s.id);
      if (prevIds.length) {
        await this.db.scores.bulkDelete(prevIds);
      }

      const now = nowISO();
      const records: Score[] = rows.map(r => ({
        id: genId(),
        exam_id: examId,
        student_id: r.student_id,
        semester_id: exam.semester_id,
        subject,
        score: r.score,
        updated_at: now
      }));
      if (records.length) {
        await this.db.scores.bulkAdd(records);
      }

      // 登记科目
      if (!exam.subjects.includes(subject)) {
        await this.db.exams.update(examId, { subjects: [...exam.subjects, subject] });
      }
    });
  }

  async getScoresByExam(examId: string): Promise<Score[]> {
    return this.db.scores.where('exam_id').equals(examId).toArray();
  }

  async deleteScoresBySubject(examId: string, subject: string): Promise<number> {
    return this.db.transaction('rw', [this.db.semesters, this.db.exams, this.db.scores], async () => {
      const exam = await this.db.exams.get(examId);
      if (!exam) {
        throw new Error(`考试不存在: ${examId}`);
      }
      await assertSemesterWritable(this.db, exam.semester_id);

      const prev = await this.db.scores.where('exam_id').equals(examId).toArray();
      const ids = prev.filter(s => s.subject === subject).map(s => s.id);
      if (ids.length) {
        await this.db.scores.bulkDelete(ids);
      }
      await this.db.exams.update(examId, { subjects: exam.subjects.filter(s => s !== subject) });
      return ids.length;
    });
  }

  async getScoresByStudent(semesterId: string, studentId: string): Promise<Score[]> {
    const rows = await this.db.scores
      .where('student_id')
      .equals(studentId)
      .filter(s => s.semester_id === semesterId)
      .toArray();
    return rows.sort((a, b) => a.exam_id.localeCompare(b.exam_id) || a.subject.localeCompare(b.subject));
  }

  // ---- 德育 ----

  async listDisciplineEvents(semesterId: string, filter?: DisciplineFilter): Promise<DisciplineEvent[]> {
    let rows =
      filter?.studentId !== undefined
        ? await this.db.discipline_events
            .where('student_id')
            .equals(filter.studentId)
            .filter(e => e.semester_id === semesterId)
            .toArray()
        : await this.db.discipline_events.where('semester_id').equals(semesterId).toArray();

    if (filter?.category) {
      rows = rows.filter(e => e.category === filter.category);
    }
    if (filter?.direction) {
      rows = rows.filter(e => e.direction === filter.direction);
    }
    // 时间倒序，同日按创建时间倒序
    return rows.sort((a, b) =>
      a.date === b.date ? b.created_at.localeCompare(a.created_at) : b.date.localeCompare(a.date)
    );
  }

  async addDisciplineEvents(input: DisciplineInput, semesterId: string): Promise<number> {
    await assertSemesterWritable(this.db, semesterId);
    const now = nowISO();
    const events: DisciplineEvent[] = input.student_ids.map(sid => ({
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
    if (events.length) {
      await this.db.discipline_events.bulkAdd(events);
    }
    return events.length;
  }

  async deleteDisciplineEvent(id: string): Promise<void> {
    const existing = await this.db.discipline_events.get(id);
    if (existing) {
      await assertSemesterWritable(this.db, existing.semester_id);
    }
    await this.db.discipline_events.delete(id);
  }

  async getDisciplineByStudent(semesterId: string, studentId: string): Promise<DisciplineEvent[]> {
    const rows = await this.db.discipline_events
      .where('student_id')
      .equals(studentId)
      .filter(e => e.semester_id === semesterId)
      .toArray();
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }

  // ---- 值日 ----

  async listDutyRecords(semesterId: string, from?: string, to?: string): Promise<DutyRecord[]> {
    const rows =
      from && to
        ? await this.db.duty_records
            .where('date')
            .between(from, to, true, true)
            .filter(r => r.semester_id === semesterId)
            .toArray()
        : await this.db.duty_records.where('semester_id').equals(semesterId).toArray();
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  async saveDutyRecord(input: DutyInput, semesterId: string): Promise<DutyRecord> {
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

    // &[semester_id+date+area] 唯一：先删旧再插（put 只按主键 upsert，复合唯一索引仍会冲突）
    await this.db.transaction('rw', [this.db.semesters, this.db.duty_records], async () => {
      await assertSemesterWritable(this.db, semesterId);
      await this.db.duty_records.where('[semester_id+date+area]').equals([semesterId, input.date, input.area]).delete();
      await this.db.duty_records.add(record);
    });
    return record;
  }

  async deleteDutyRecord(id: string): Promise<void> {
    const existing = await this.db.duty_records.get(id);
    if (existing) {
      await assertSemesterWritable(this.db, existing.semester_id);
    }
    await this.db.duty_records.delete(id);
  }

  async getDutyByStudent(semesterId: string, studentId: string): Promise<DutyRecord[]> {
    const rows = await this.db.duty_records.where('semester_id').equals(semesterId).toArray();
    return rows.filter(r => r.student_ids.includes(studentId)).sort((a, b) => b.date.localeCompare(a.date));
  }

  // ---- 文档台账 ----

  async listDocuments(semesterId: string): Promise<DocumentRecord[]> {
    const rows = await this.db.documents.where('semester_id').equals(semesterId).toArray();
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }

  async createDocument(input: DocumentInput, semesterId: string): Promise<DocumentRecord> {
    await assertSemesterWritable(this.db, semesterId);
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
    await this.db.documents.add(record);
    return record;
  }

  async updateDocument(
    id: string,
    patch: Partial<Omit<DocumentInput, 'attachment'>> & { attachment?: DocumentAttachment | null }
  ): Promise<void> {
    const existing = await this.db.documents.get(id);
    if (!existing) {
      throw new Error(`文档不存在: ${id}`);
    }
    await assertSemesterWritable(this.db, existing.semester_id);

    const next: Partial<DocumentRecord> = {};
    if (patch.title !== undefined) next.title = patch.title.trim();
    if (patch.category !== undefined) next.category = patch.category;
    if (patch.date !== undefined) next.date = patch.date;
    if (patch.summary !== undefined) next.summary = patch.summary || undefined;
    if (patch.attachment !== undefined) {
      next.attachment = patch.attachment === null ? undefined : patch.attachment;
    }
    await this.db.documents.update(id, next);
  }

  async deleteDocument(id: string): Promise<void> {
    const existing = await this.db.documents.get(id);
    if (existing) {
      await assertSemesterWritable(this.db, existing.semester_id);
    }
    await this.db.documents.delete(id);
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
    const [
      semesters,
      students,
      enrollments,
      attendance,
      exams,
      scores,
      disciplineEvents,
      dutyRecords,
      documents,
      settingRows
    ] = await Promise.all([
      this.db.semesters.toArray(),
      this.db.students.toArray(),
      this.db.enrollments.toArray(),
      this.db.attendance.toArray(),
      this.db.exams.toArray(),
      this.db.scores.toArray(),
      this.db.discipline_events.toArray(),
      this.db.duty_records.toArray(),
      this.db.documents.toArray(),
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
      attendance,
      exams,
      scores,
      discipline_events: disciplineEvents,
      duty_records: dutyRecords,
      documents,
      settings
    };
  }

  async importAll(data: BackupFile): Promise<void> {
    if (data.version !== 1) {
      throw new Error(`不支持的备份版本: ${data.version}`);
    }

    await this.db.transaction(
      'rw',
      [
        this.db.semesters,
        this.db.students,
        this.db.enrollments,
        this.db.attendance,
        this.db.exams,
        this.db.scores,
        this.db.discipline_events,
        this.db.duty_records,
        this.db.documents,
        this.db.settings
      ],
      async () => {
        await Promise.all([
          this.db.semesters.clear(),
          this.db.students.clear(),
          this.db.enrollments.clear(),
          this.db.attendance.clear(),
          this.db.exams.clear(),
          this.db.scores.clear(),
          this.db.discipline_events.clear(),
          this.db.duty_records.clear(),
          this.db.documents.clear(),
          this.db.settings.clear()
        ]);
        await this.db.semesters.bulkPut(data.semesters);
        await this.db.students.bulkPut(data.students);
        await this.db.enrollments.bulkPut(data.enrollments);
        // M1/M2 老备份缺 M3 字段，一律容忍缺失
        if (data.attendance?.length) {
          await this.db.attendance.bulkPut(data.attendance);
        }
        if (data.exams?.length) {
          await this.db.exams.bulkPut(data.exams);
        }
        if (data.scores?.length) {
          await this.db.scores.bulkPut(data.scores);
        }
        if (data.discipline_events?.length) {
          await this.db.discipline_events.bulkPut(data.discipline_events);
        }
        if (data.duty_records?.length) {
          await this.db.duty_records.bulkPut(data.duty_records);
        }
        if (data.documents?.length) {
          await this.db.documents.bulkPut(data.documents);
        }
        await this.db.settings.bulkPut(Object.entries(data.settings).map(([key, value]) => ({ key, value })));
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

/** 归档学期只读校验 */
async function assertSemesterWritable(db: HomeroomDB, semesterId: string): Promise<void> {
  const sem = await db.semesters.get(semesterId);
  if (sem?.archived) {
    throw new Error(`学期已归档，只读：${sem.name}`);
  }
}
