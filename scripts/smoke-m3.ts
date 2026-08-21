/**
 * M3 仓储冒烟测试：考试/成绩、德育、值日、文档、归档/复制名册、备份扩展
 *
 * 运行：pnpm exec tsx scripts/smoke-m3.ts
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert';
import { createRepo } from '../src/repo/index';
import type { DisciplineInput, DutyInput, StudentInput } from '../src/repo/types';

async function main() {
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
  assert.equal(exam.subjects.length, 0);
  await repo.updateExam(exam.id, { name: '期中考试（语数英）' });
  assert.equal((await repo.listExams(sem.id))[0].name, '期中考试（语数英）');
  assert.equal((await repo.listExams(sem2.id)).length, 0, '考试按学期隔离');
  console.log('✓ 考试 CRUD + 学期隔离');

  // ---- 成绩：按科目全量替换 ----
  await repo.saveScoresForSubject(exam.id, '语文', [
    { student_id: students[0].id, score: 92 },
    { student_id: students[1].id, score: 85 },
    { student_id: students[2].id, score: null } // 缺考
  ]);
  let scores = await repo.getScoresBySubject(exam.id, '语文');
  assert.equal(scores.length, 3);
  assert.ok(
    scores.some(s => s.score === null),
    '缺考应保存为 null'
  );

  // 重存替换（改乙分数 + 去掉丙）
  await repo.saveScoresForSubject(exam.id, '语文', [
    { student_id: students[0].id, score: 95 },
    { student_id: students[1].id, score: 88 }
  ]);
  scores = await repo.getScoresBySubject(exam.id, '语文');
  assert.equal(scores.length, 2, '重存应全量替换');
  assert.equal(scores.find(s => s.student_id === students[0].id)?.score, 95);

  // 第二科目 + subjects 登记
  await repo.saveScoresForSubject(exam.id, '数学', [{ student_id: students[0].id, score: 78 }]);
  const examAfter = (await repo.listExams(sem.id)).find(e => e.id === exam.id)!;
  assert.deepEqual(examAfter.subjects.sort(), ['数学', '语文']);

  // 学生视角
  const mine = await repo.getScoresByStudent(sem.id, students[0].id);
  assert.equal(mine.length, 2);
  assert.equal((await repo.getScoresByStudent(sem2.id, students[0].id)).length, 0, '成绩按学期隔离');
  console.log('✓ 成绩按科目全量替换 + 科目登记 + 学生视角隔离');

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
  assert.equal(added, 2);
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
  assert.equal(events.length, 3);
  assert.equal(events[0].date, '2026-10-01', '应时间倒序');
  events = await repo.listDisciplineEvents(sem.id, { studentId: students[1].id });
  assert.equal(events.length, 1);
  events = await repo.listDisciplineEvents(sem.id, { direction: 'plus' });
  assert.equal(events.length, 1);
  assert.equal((await repo.listDisciplineEvents(sem2.id)).length, 0, '德育按学期隔离');
  assert.equal((await repo.getDisciplineByStudent(sem.id, students[0].id)).length, 2);
  await repo.deleteDisciplineEvent(events[0].id);
  assert.equal((await repo.listDisciplineEvents(sem.id)).length, 2);
  console.log('✓ 德育批量新增 + 筛选/倒序 + 删除 + 隔离');

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
  await repo.saveDutyRecord({ ...duty, student_ids: [students[2].id], evaluation: 'poor', remark: '地面不净' }, sem.id);
  let duties = await repo.listDutyRecords(sem.id);
  assert.equal(duties.length, 1, '同 (date,area) 应 upsert');
  assert.equal(duties[0].student_ids.length, 1);
  assert.equal(duties[0].evaluation, 'poor');
  // 不同区域共存
  await repo.saveDutyRecord({ ...duty, area: '包干区' }, sem.id);
  duties = await repo.listDutyRecords(sem.id, '2026-09-13', '2026-09-15');
  assert.equal(duties.length, 2, '范围查询应含两条');
  assert.equal((await repo.listDutyRecords(sem2.id)).length, 0, '值日按学期隔离');
  assert.equal((await repo.getDutyByStudent(sem.id, students[2].id)).length, 1);
  await repo.deleteDutyRecord(duties[0].id);
  assert.equal((await repo.listDutyRecords(sem.id)).length, 1);
  console.log('✓ 值日 upsert + 范围查询 + 隔离');

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
  assert.equal(doc.attachment?.data, 'aGVsbG8=');
  await repo.updateDocument(doc.id, { title: '秋季运动会通知（修订）', attachment: null });
  const docs = await repo.listDocuments(sem.id);
  assert.equal(docs[0].title, '秋季运动会通知（修订）');
  assert.equal(docs[0].attachment, undefined, '附件应可清除');
  assert.equal((await repo.listDocuments(sem2.id)).length, 0, '文档按学期隔离');
  console.log('✓ 文档 CRUD + 附件增删 + 隔离');

  // ---- 备份往返（含五表）----
  const backup = await repo.exportAll();
  assert.equal(backup.exams?.length, 1);
  assert.equal(backup.scores?.length, 3);
  assert.equal(backup.discipline_events?.length, 2);
  assert.equal(backup.duty_records?.length, 1);
  await repo.importAll(JSON.parse(JSON.stringify(backup)));
  const restored = await repo.exportAll();
  assert.deepEqual(restored.scores, backup.scores);
  assert.deepEqual(restored.duty_records, backup.duty_records);
  // 老备份（无 M3 字段）兼容
  const legacy = JSON.parse(JSON.stringify(backup));
  delete legacy.exams;
  delete legacy.scores;
  delete legacy.discipline_events;
  delete legacy.duty_records;
  delete legacy.documents;
  await repo.importAll(legacy);
  assert.equal((await repo.listExams(sem.id)).length, 0);
  console.log('✓ 备份含五表往返 + 老备份兼容');

  // 重建 M3 数据（前面被老备份导入清掉了）
  const exam2 = await repo.createExam({ name: '期中考试', date: '2026-11-05', type: 'midterm' }, sem.id);
  await repo.saveScoresForSubject(exam2.id, '语文', [{ student_id: students[0].id, score: 95 }]);

  // ---- 归档与复制名册 ----
  await assert.rejects(() => repo.setSemesterArchived(sem.id, true), /当前学期不能归档/, 'active 学期不可归档');
  await repo.setSemesterArchived(sem2.id, true);
  await assert.rejects(
    () => repo.createExam({ name: 'x', date: '2027-03-01', type: 'daily' }, sem2.id),
    /已归档/,
    '归档学期应拒绝写入'
  );
  await assert.rejects(() => repo.saveDutyRecord(duty, sem2.id), /已归档/);
  await repo.setSemesterArchived(sem2.id, false);
  await repo.createExam({ name: '恢复后考试', date: '2027-03-02', type: 'daily' }, sem2.id);
  await repo.setSemesterArchived(sem2.id, true);
  console.log('✓ 归档只读（考试/值日写入被拒）+ 取消归档恢复');

  // 复制名册：sem → sem2（先取消归档）
  await repo.setSemesterArchived(sem2.id, false);
  const copied = await repo.copyRoster(sem.id, sem2.id);
  assert.equal(copied, 3, '三名在读学生应复制');
  const copiedAgain = await repo.copyRoster(sem.id, sem2.id);
  assert.equal(copiedAgain, 0, '重复复制应跳过已存在');
  assert.equal((await repo.listStudents(sem2.id)).length, 3);
  await assert.rejects(() => repo.copyRoster(sem.id, sem.id), /相同/);
  console.log('✓ 复制名册（跳过已存在）');

  // ---- 删除学生级联 M3 ----
  const before = await repo.countStudentRecords(students[0].id);
  assert.equal(before.scores, 1);
  assert.equal(before.discipline, 0); // 前面老备份导入清了德育
  const removed = await repo.deleteStudent(students[0].id);
  assert.equal(removed.scores, 1);
  assert.equal((await repo.listStudents(sem.id)).length, 2);
  console.log('✓ 删除学生级联成绩');

  console.log('\\n全部通过 ✔');
}

main().catch(err => {
  console.error('✗ 冒烟测试失败:', err);
  process.exit(1);
});
