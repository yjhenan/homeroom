/**
 * 由 scripts/smoke-m3.ts 迁移而来：M3 五表仓储全流程
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createRepo } from '@/repo/index';
import type { DisciplineInput, DutyInput, StudentInput } from '@/repo/types';

describe('M3 仓储：考试/成绩/德育/值日/文档/归档/复制名册', () => {
  it('全流程', async () => {
    const repo = createRepo();

    const sem = await repo.createSemester({
      id: '2026-2027-1',
      name: '2026-2027学年 第一学期',
      start_date: '2026-09-01',
      end_date: '2027-01-20',
      is_active: true
    });
    const sem2 = await repo.createSemester({
      id: '2026-2027-2',
      name: '2026-2027学年 第二学期',
      start_date: '2027-02-20',
      end_date: '2027-06-30'
    });

    // 三个学生
    const roster: StudentInput[] = [
      { name: '甲', student_no: 'S001', gender: 'male' },
      { name: '乙', student_no: 'S002', gender: 'female' },
      { name: '丙', student_no: 'S003', gender: 'unknown' }
    ];
    await repo.importStudents(roster, sem.id, 'skip');
    const students = await repo.listStudents(sem.id);

    // ---- 考试 ----
    const exam = await repo.createExam({ name: '期中考试', date: '2026-11-05', type: 'midterm' }, sem.id);
    expect(exam.subjects.length).toBe(0);
    await repo.updateExam(exam.id, { name: '期中考试（语数英）' });
    expect((await repo.listExams(sem.id))[0].name).toBe('期中考试（语数英）');
    expect((await repo.listExams(sem2.id)).length, '考试按学期隔离').toBe(0);

    // ---- 成绩：按科目全量替换 ----
    await repo.saveScoresForSubject(exam.id, '语文', [
      { student_id: students[0].id, score: 92 },
      { student_id: students[1].id, score: 85 },
      { student_id: students[2].id, score: null } // 缺考
    ]);
    let scores = await repo.getScoresBySubject(exam.id, '语文');
    expect(scores.length).toBe(3);
    expect(
      scores.some(s => s.score === null),
      '缺考应保存为 null'
    ).toBeTruthy();

    // 重存替换（改乙分数 + 去掉丙）
    await repo.saveScoresForSubject(exam.id, '语文', [
      { student_id: students[0].id, score: 95 },
      { student_id: students[1].id, score: 88 }
    ]);
    scores = await repo.getScoresBySubject(exam.id, '语文');
    expect(scores.length, '重存应全量替换').toBe(2);
    expect(scores.find(s => s.student_id === students[0].id)?.score).toBe(95);

    // 第二科目 + subjects 登记
    await repo.saveScoresForSubject(exam.id, '数学', [{ student_id: students[0].id, score: 78 }]);
    const examAfter = (await repo.listExams(sem.id)).find(e => e.id === exam.id)!;
    expect(examAfter.subjects.sort()).toEqual(['数学', '语文']);

    // 学生视角
    const mine = await repo.getScoresByStudent(sem.id, students[0].id);
    expect(mine.length).toBe(2);
    expect((await repo.getScoresByStudent(sem2.id, students[0].id)).length, '成绩按学期隔离').toBe(0);

    // ---- 德育 ----
    const ev: DisciplineInput = {
      student_ids: [students[0].id, students[1].id],
      date: '2026-09-15',
      direction: 'minus',
      category: '纪律',
      points: 2,
      description: '课间打闹'
    };
    const added = await repo.addDisciplineEvents(ev, sem.id);
    expect(added).toBe(2);
    await repo.addDisciplineEvents(
      {
        student_ids: [students[0].id],
        date: '2026-10-01',
        direction: 'plus',
        category: '助人',
        points: 1,
        description: '帮同学补课'
      },
      sem.id
    );

    let events = await repo.listDisciplineEvents(sem.id);
    expect(events.length).toBe(3);
    expect(events[0].date, '应时间倒序').toBe('2026-10-01');
    events = await repo.listDisciplineEvents(sem.id, { studentId: students[1].id });
    expect(events.length).toBe(1);
    events = await repo.listDisciplineEvents(sem.id, { direction: 'plus' });
    expect(events.length).toBe(1);
    expect((await repo.listDisciplineEvents(sem2.id)).length, '德育按学期隔离').toBe(0);
    expect((await repo.getDisciplineByStudent(sem.id, students[0].id)).length).toBe(2);
    await repo.deleteDisciplineEvent(events[0].id);
    expect((await repo.listDisciplineEvents(sem.id)).length).toBe(2);

    // ---- 值日 upsert ----
    const duty: DutyInput = {
      date: '2026-09-14',
      group_name: '第一组',
      student_ids: [students[0].id, students[1].id],
      area: '教室',
      evaluation: 'good'
    };
    await repo.saveDutyRecord(duty, sem.id);
    // 同日同区重存 = 替换
    await repo.saveDutyRecord(
      { ...duty, student_ids: [students[2].id], evaluation: 'poor', remark: '地面不净' },
      sem.id
    );
    let duties = await repo.listDutyRecords(sem.id);
    expect(duties.length, '同 (date,area) 应 upsert').toBe(1);
    expect(duties[0].student_ids.length).toBe(1);
    expect(duties[0].evaluation).toBe('poor');
    // 不同区域共存
    await repo.saveDutyRecord({ ...duty, area: '包干区' }, sem.id);
    duties = await repo.listDutyRecords(sem.id, '2026-09-13', '2026-09-15');
    expect(duties.length, '范围查询应含两条').toBe(2);
    expect((await repo.listDutyRecords(sem2.id)).length, '值日按学期隔离').toBe(0);
    expect((await repo.getDutyByStudent(sem.id, students[2].id)).length).toBe(1);
    await repo.deleteDutyRecord(duties[0].id);
    expect((await repo.listDutyRecords(sem.id)).length).toBe(1);

    // ---- 文档 ----
    const doc = await repo.createDocument(
      {
        title: '秋季运动会通知',
        category: '通知',
        date: '2026-09-20',
        summary: '下周三举行',
        attachment: { name: 'a.txt', mime_type: 'text/plain', data: 'aGVsbG8=' }
      },
      sem.id
    );
    expect(doc.attachment?.data).toBe('aGVsbG8=');
    await repo.updateDocument(doc.id, { title: '秋季运动会通知（修订）', attachment: null });
    const docs = await repo.listDocuments(sem.id);
    expect(docs[0].title).toBe('秋季运动会通知（修订）');
    expect(docs[0].attachment, '附件应可清除').toBe(undefined);
    expect((await repo.listDocuments(sem2.id)).length, '文档按学期隔离').toBe(0);

    // ---- 备份往返（含五表）----
    const backup = await repo.exportAll();
    expect(backup.exams?.length).toBe(1);
    expect(backup.scores?.length).toBe(3);
    expect(backup.discipline_events?.length).toBe(2);
    expect(backup.duty_records?.length).toBe(1);
    await repo.importAll(JSON.parse(JSON.stringify(backup)));
    const restored = await repo.exportAll();
    expect(restored.scores).toEqual(backup.scores);
    expect(restored.duty_records).toEqual(backup.duty_records);
    // 老备份（无 M3 字段）兼容
    const legacy = JSON.parse(JSON.stringify(backup));
    delete legacy.exams;
    delete legacy.scores;
    delete legacy.discipline_events;
    delete legacy.duty_records;
    delete legacy.documents;
    await repo.importAll(legacy);
    expect((await repo.listExams(sem.id)).length).toBe(0);

    // 重建 M3 数据（前面被老备份导入清掉了）
    const exam2 = await repo.createExam({ name: '期中考试', date: '2026-11-05', type: 'midterm' }, sem.id);
    await repo.saveScoresForSubject(exam2.id, '语文', [{ student_id: students[0].id, score: 95 }]);

    // ---- 归档与复制名册 ----
    await expect(repo.setSemesterArchived(sem.id, true)).rejects.toThrow(/当前学期不能归档/);
    await repo.setSemesterArchived(sem2.id, true);
    await expect(repo.createExam({ name: 'x', date: '2027-03-01', type: 'daily' }, sem2.id)).rejects.toThrow(/已归档/);
    await expect(repo.saveDutyRecord(duty, sem2.id)).rejects.toThrow(/已归档/);
    await repo.setSemesterArchived(sem2.id, false);
    await repo.createExam({ name: '恢复后考试', date: '2027-03-02', type: 'daily' }, sem2.id);
    await repo.setSemesterArchived(sem2.id, true);

    // 复制名册：sem → sem2（先取消归档）
    await repo.setSemesterArchived(sem2.id, false);
    const copied = await repo.copyRoster(sem.id, sem2.id);
    expect(copied, '三名在读学生应复制').toBe(3);
    const copiedAgain = await repo.copyRoster(sem.id, sem2.id);
    expect(copiedAgain, '重复复制应跳过已存在').toBe(0);
    expect((await repo.listStudents(sem2.id)).length).toBe(3);
    await expect(repo.copyRoster(sem.id, sem.id)).rejects.toThrow(/相同/);

    // ---- 删除学生级联 M3 ----
    const before = await repo.countStudentRecords(students[0].id);
    expect(before.scores).toBe(1);
    expect(before.discipline).toBe(0); // 前面老备份导入清了德育
    const removed = await repo.deleteStudent(students[0].id);
    expect(removed.scores).toBe(1);
    expect((await repo.listStudents(sem.id)).length).toBe(2);

    console.log('\\n全部通过 ✔');
  });
});
