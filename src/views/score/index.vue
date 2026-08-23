<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { commonSubjects, examTypeLabel } from '@/constants/business';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';
import { repo } from '@/repo';
import type { Exam, ExamInput } from '@/repo';
import ExamModal from './modules/exam-modal.vue';
import SubjectPanel from './modules/subject-panel.vue';
import MatrixPanel from './modules/matrix-panel.vue';
import ScoreImportModal from './modules/import-modal.vue';
import ContextMenu from '@/components/common/context-menu.vue';
import { exportScoreSheet } from '@/utils/excel';

defineOptions({
  name: 'Score'
});

const semesterStore = useSemesterStore();
const studentStore = useStudentStore();

const exams = ref<Exam[]>([]);
const selectedExamId = ref<string | null>(null);
const activeTab = ref<string>('__matrix');
const modalShow = ref(false);
const editingExam = ref<Exam | null>(null);
const saving = ref(false);
/** 任何科目保存后 +1，总表据此重载 */
const dataVersion = ref(0);

/** ＋科目弹层 */
const addShow = ref(false);
const newSubject = ref('');
const newFull = ref(100);
const newPass = ref(60);

/** 成绩表导入 */
const importShow = ref(false);

function handleImportRefreshed() {
  handleSaved(); // 总表重载
  loadExams(); // 科目可能新增
  activeTab.value = '__matrix';
}

const isArchived = computed(() => semesterStore.activeSemester?.archived === true);
const selectedExam = computed(() => exams.value.find(e => e.id === selectedExamId.value) ?? null);
const subjects = computed(() => selectedExam.value?.subjects ?? []);

const roster = computed(() => studentStore.students.filter(s => s.enrollment?.status === 'active'));

const examInfo = computed(() => {
  if (!selectedExam.value) return '';
  const e = selectedExam.value;
  return `${e.date} · ${examTypeLabel[e.type]} · 已建科目 ${e.subjects.length} 个`;
});

async function loadExams() {
  if (!semesterStore.activeSemesterId) return;
  exams.value = await repo.listExams(semesterStore.activeSemesterId);
}

function handleAdd() {
  editingExam.value = null;
  modalShow.value = true;
}

function handleEdit() {
  if (!selectedExam.value) return;
  editingExam.value = selectedExam.value;
  modalShow.value = true;
}

function handleDelete() {
  const exam = selectedExam.value;
  if (!exam) return;
  window.$dialog?.warning({
    title: '确认删除考试',
    content: `将删除「${exam.name}」及其全部科目成绩，不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const r = await repo.deleteExam(exam.id);
        window.$message?.success(`已删除（含成绩 ${r.scores} 条）`);
        selectedExamId.value = null;
        activeTab.value = '__matrix';
        await loadExams();
      } catch (err) {
        window.$message?.error(err instanceof Error ? err.message : '删除失败');
      }
    }
  });
}

async function handleSaveExam(input: ExamInput) {
  saving.value = true;
  try {
    if (editingExam.value) {
      await repo.updateExam(editingExam.value.id, input);
      window.$message?.success('已保存');
    } else {
      if (!semesterStore.activeSemesterId) return;
      const created = await repo.createExam(input, semesterStore.activeSemesterId);
      selectedExamId.value = created.id;
      activeTab.value = '__matrix';
      window.$message?.success('已新建考试，点「＋ 科目」开始录入');
    }
    modalShow.value = false;
    await loadExams();
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

/** ＋科目（可带满分/及格线） */
async function addSubject(name: string, full: number, pass: number) {
  const t = name.trim();
  const exam = selectedExam.value;
  if (!t || !exam || exam.subjects.includes(t)) {
    addShow.value = false;
    return;
  }
  try {
    const conf = { ...exam.subject_conf, [t]: { full, pass } };
    await repo.updateExam(exam.id, { subjects: [...exam.subjects, t], subject_conf: conf });
    await loadExams();
    activeTab.value = `subj:${t}`;
    addShow.value = false;
    newSubject.value = '';
    newFull.value = 100;
    newPass.value = 60;
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '添加失败');
  }
}

function handleSaved() {
  dataVersion.value += 1;
}

/** 科目 Tab 右键菜单 */
const subjectMenuOptions = [
  { label: '满分/及格设置', key: 'conf' },
  { label: '删除科目', key: 'delete' }
];

async function onSubjectMenu(key: string | number, subject: string) {
  if (key === 'delete') {
    window.$dialog?.warning({
      title: '删除科目',
      content: `将删除「${subject}」科目及其全部成绩（含缺考记录），不可恢复。确认删除？`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          const r = await repo.deleteScoresBySubject(selectedExamId.value ?? '', subject);
          window.$message?.success(`已删除「${subject}」（含成绩 ${r} 条）`);
          handleSaved();
          activeTab.value = '__matrix';
          await loadExams();
        } catch (err) {
          window.$message?.error(err instanceof Error ? err.message : '删除失败');
        }
      }
    });
  } else if (key === 'conf') {
    const cur = selectedExam.value?.subject_conf?.[subject];
    confSubject.value = subject;
    confFull.value = cur?.full ?? 100;
    confPass.value = cur?.pass ?? 60;
    confShow.value = true;
  }
}

/** 满分/及格设置弹窗 */
const confShow = ref(false);
const confSubject = ref('');
const confFull = ref(100);
const confPass = ref(60);

async function handleSaveConf() {
  const exam = selectedExam.value;
  if (!exam || !confSubject.value) return;
  try {
    const conf = { ...exam.subject_conf, [confSubject.value]: { full: confFull.value, pass: confPass.value } };
    await repo.updateExam(exam.id, { subject_conf: conf });
    await loadExams();
    confShow.value = false;
    window.$message?.success(`已设置「${confSubject.value}」满分 ${confFull.value} / 及格 ${confPass.value}`);
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '保存失败');
  }
}

/** 科目及格线（面板统计用） */
function passLineOf(subject: string): number {
  return selectedExam.value?.subject_conf?.[subject]?.pass ?? 60;
}

/** 导出成绩单 */
async function handleExportSheet() {
  const exam = selectedExam.value;
  if (!exam || !semesterStore.activeSemesterId) return;
  try {
    const scores = await repo.getScoresByExam(exam.id);
    exportScoreSheet({
      examName: exam.name,
      date: exam.date,
      subjects: exam.subjects.map(s => ({ name: s, full: exam.subject_conf?.[s]?.full })),
      roster: roster.value,
      scores
    });
    window.$message?.success(`已导出「${exam.name}」成绩单（${exam.subjects.length} 科）`);
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '导出失败');
  }
}

watch(
  () => semesterStore.activeSemesterId,
  async () => {
    selectedExamId.value = null;
    activeTab.value = '__matrix';
    await loadExams();
  }
);

onMounted(async () => {
  await semesterStore.initSemesters();
  if (semesterStore.activeSemesterId) {
    await studentStore.loadStudents(semesterStore.activeSemesterId);
  }
  await loadExams();
});
</script>

<template>
  <NCard :bordered="false" class="card-wrapper">
    <!-- 考试工具栏 -->
    <div class="mb-12px flex flex-wrap items-center gap-12px">
      <NSelect
        v-model:value="selectedExamId"
        :options="exams.map(e => ({ label: `${e.name}（${e.date}）`, value: e.id }))"
        placeholder="选择考试"
        class="w-260px"
        filterable
      />
      <NButton type="primary" :disabled="isArchived" @click="handleAdd">新建考试</NButton>
      <NButton :disabled="isArchived || !selectedExam" @click="importShow = true">导入成绩表</NButton>
      <NButton :disabled="!selectedExam" @click="handleExportSheet">导出成绩单</NButton>
      <NButton :disabled="isArchived || !selectedExam" @click="handleEdit">编辑</NButton>
      <NButton quaternary type="error" :disabled="isArchived || !selectedExam" @click="handleDelete">删除</NButton>
      <span v-if="selectedExam" class="text-13px opacity-60">{{ examInfo }}</span>
      <NTag v-if="isArchived" type="warning" :bordered="false" class="ml-auto">学期已归档，只读</NTag>
    </div>

    <template v-if="selectedExam">
      <!-- 总表在前 + 科目 Tab（右键设置/删除）；＋科目收进 Tab suffix -->
      <NTabs v-model:value="activeTab" type="line" animated>
        <NTabPane name="__matrix" tab="总表" display-directive="show:lazy">
          <MatrixPanel
            :exam-id="selectedExamId ?? ''"
            :exam-name="selectedExam?.name ?? ''"
            :subjects="subjects"
            :roster="roster"
            :version="dataVersion"
          />
        </NTabPane>
        <NTabPane v-for="sub in subjects" :key="sub" :name="`subj:${sub}`" display-directive="show">
          <template #tab>
            <ContextMenu :options="subjectMenuOptions" @select="(k: string | number) => onSubjectMenu(k, sub)">
              <span>{{ sub }}</span>
            </ContextMenu>
          </template>
          <SubjectPanel
            :exam-id="selectedExamId ?? ''"
            :subject="sub"
            :roster="roster"
            :archived="isArchived"
            :pass-line="passLineOf(sub)"
            @saved="handleSaved"
          />
        </NTabPane>
        <template #suffix>
          <NPopover v-model:show="addShow" trigger="click" placement="bottom">
            <template #trigger>
              <NButton size="small" quaternary type="primary" :disabled="isArchived">＋ 科目</NButton>
            </template>
            <div class="w-300px">
              <div class="mb-8px text-13px opacity-70">输入或点选新增科目</div>
              <NInputGroup>
                <NInput
                  v-model:value="newSubject"
                  placeholder="如 语文"
                  size="small"
                  @keyup.enter="addSubject(newSubject, newFull, newPass)"
                />
                <NButton type="primary" size="small" @click="addSubject(newSubject, newFull, newPass)">添加</NButton>
              </NInputGroup>
              <div class="mt-8px flex items-center gap-8px">
                <span class="text-13px opacity-70">满分</span>
                <NInputNumber v-model:value="newFull" size="small" :min="1" class="w-90px" />
                <span class="text-13px opacity-70">及格</span>
                <NInputNumber v-model:value="newPass" size="small" :min="1" class="w-90px" />
              </div>
              <div class="mt-8px flex flex-wrap gap-6px">
                <NTag
                  v-for="s in commonSubjects.filter(x => !subjects.includes(x))"
                  :key="s"
                  size="small"
                  class="cursor-pointer"
                  @click="addSubject(s, newFull, newPass)"
                >
                  {{ s }}
                </NTag>
              </div>
            </div>
          </NPopover>
        </template>
      </NTabs>
    </template>

    <NEmpty v-else description="先新建或选择一场考试，再添加科目录入成绩" class="py-48px" />

    <ExamModal v-model:show="modalShow" :exam="editingExam" :saving="saving" @save="handleSaveExam" />
    <ScoreImportModal
      v-model:show="importShow"
      :exam-id="selectedExamId ?? ''"
      :existing-subjects="subjects"
      @refreshed="handleImportRefreshed"
    />

    <!-- 满分/及格设置 -->
    <NModal
      v-model:show="confShow"
      preset="card"
      :title="`科目设置：${confSubject}`"
      class="w-360px"
      :mask-closable="false"
    >
      <NForm label-placement="left" label-width="64">
        <NFormItem label="满分">
          <NInputNumber v-model:value="confFull" :min="1" class="w-full" />
        </NFormItem>
        <NFormItem label="及格线">
          <NInputNumber v-model:value="confPass" :min="1" class="w-full" />
        </NFormItem>
      </NForm>
      <div class="text-13px opacity-60">
        及格线用于及格率统计；满分仅展示与导出用，录入不做硬校验。右键科目 Tab 可重新打开。
      </div>
      <template #footer>
        <div class="flex justify-end gap-12px">
          <NButton @click="confShow = false">取消</NButton>
          <NButton type="primary" @click="handleSaveConf">保存</NButton>
        </div>
      </template>
    </NModal>
  </NCard>
</template>

<style scoped></style>
