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

/** ＋科目 */
async function addSubject(name: string) {
  const t = name.trim();
  const exam = selectedExam.value;
  if (!t || !exam || exam.subjects.includes(t)) {
    addShow.value = false;
    return;
  }
  try {
    await repo.updateExam(exam.id, { subjects: [...exam.subjects, t] });
    await loadExams();
    activeTab.value = `subj:${t}`;
    addShow.value = false;
    newSubject.value = '';
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '添加失败');
  }
}

function handleSaved() {
  dataVersion.value += 1;
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
      <NButton :disabled="isArchived || !selectedExam" @click="handleEdit">编辑</NButton>
      <NButton quaternary type="error" :disabled="isArchived || !selectedExam" @click="handleDelete">删除</NButton>
      <span v-if="selectedExam" class="text-13px opacity-60">{{ examInfo }}</span>
      <NTag v-if="isArchived" type="warning" :bordered="false" class="ml-auto">学期已归档，只读</NTag>
    </div>

    <template v-if="selectedExam">
      <!-- 总表在前 + 科目 Tab；＋科目收进 Tab suffix -->
      <NTabs v-model:value="activeTab" type="line" animated>
        <NTabPane name="__matrix" tab="总表" display-directive="show:lazy">
          <MatrixPanel :exam-id="selectedExamId ?? ''" :subjects="subjects" :roster="roster" :version="dataVersion" />
        </NTabPane>
        <NTabPane v-for="sub in subjects" :key="sub" :name="`subj:${sub}`" :tab="sub" display-directive="show">
          <SubjectPanel
            :exam-id="selectedExamId ?? ''"
            :subject="sub"
            :roster="roster"
            :archived="isArchived"
            @saved="handleSaved"
          />
        </NTabPane>
        <template #suffix>
          <NPopover v-model:show="addShow" trigger="click" placement="bottom">
            <template #trigger>
              <NButton size="small" quaternary type="primary" :disabled="isArchived">＋ 科目</NButton>
            </template>
            <div class="w-280px">
              <div class="mb-8px text-13px opacity-70">输入或点选新增科目</div>
              <NInputGroup>
                <NInput
                  v-model:value="newSubject"
                  placeholder="如 语文"
                  size="small"
                  @keyup.enter="addSubject(newSubject)"
                />
                <NButton type="primary" size="small" @click="addSubject(newSubject)">添加</NButton>
              </NInputGroup>
              <div class="mt-8px flex flex-wrap gap-6px">
                <NTag
                  v-for="s in commonSubjects.filter(x => !subjects.includes(x))"
                  :key="s"
                  size="small"
                  class="cursor-pointer"
                  @click="addSubject(s)"
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
  </NCard>
</template>

<style scoped></style>
