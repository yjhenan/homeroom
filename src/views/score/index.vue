<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import type { DataTableColumns } from 'naive-ui';
import { NButton, NTag } from 'naive-ui';
import { commonSubjects, examTypeLabel } from '@/constants/business';
import { useSemesterStore } from '@/store/modules/semester';
import { repo } from '@/repo';
import type { Exam, ExamInput } from '@/repo';
import ExamModal from './modules/exam-modal.vue';
import ScoreEntry from './modules/score-entry.vue';
import ScoreStats from './modules/score-stats.vue';

defineOptions({
  name: 'Score'
});

const semesterStore = useSemesterStore();

const exams = ref<Exam[]>([]);
const selectedExamId = ref<string | null>(null);
const selectedSubject = ref<string | null>(null);
const newSubject = ref('');
const modalShow = ref(false);
const editingExam = ref<Exam | null>(null);
const saving = ref(false);

const isArchived = computed(() => semesterStore.activeSemester?.archived === true);
const selectedExam = computed(() => exams.value.find(e => e.id === selectedExamId.value) ?? null);

/** 科目候选：该考试已录入科目 + 常用科目；可自由输入新增 */
const subjectOptions = computed(() => {
  const set = new Set<string>([...(selectedExam.value?.subjects ?? []), ...commonSubjects]);
  return Array.from(set).map(s => ({ label: s, value: s }));
});

const examColumns: DataTableColumns<Exam> = [
  { title: '名称', key: 'name', width: 160 },
  { title: '日期', key: 'date', width: 110 },
  {
    title: '类型',
    key: 'type',
    width: 100,
    render: row => examTypeLabel[row.type]
  },
  {
    title: '已录科目',
    key: 'subjects',
    render: row => (row.subjects.length ? row.subjects.join('、') : '—')
  },
  {
    title: '操作',
    key: 'actions',
    width: 130,
    align: 'center',
    render: row =>
      h('div', { class: 'flex justify-center gap-8px' }, [
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: 'primary',
            disabled: isArchived.value,
            onClick: () => handleEdit(row)
          },
          { default: () => '编辑' }
        ),
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: 'error',
            disabled: isArchived.value,
            onClick: () => handleDelete(row)
          },
          { default: () => '删除' }
        )
      ])
  }
];

async function loadExams() {
  if (!semesterStore.activeSemesterId) return;
  exams.value = await repo.listExams(semesterStore.activeSemesterId);
}

function handleAdd() {
  editingExam.value = null;
  modalShow.value = true;
}

function handleEdit(row: Exam) {
  editingExam.value = row;
  modalShow.value = true;
}

function handleDelete(row: Exam) {
  window.$dialog?.warning({
    title: '确认删除考试',
    content: `将删除「${row.name}」及其全部科目成绩，不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const r = await repo.deleteExam(row.id);
        window.$message?.success(`已删除（含成绩 ${r.scores} 条）`);
        if (selectedExamId.value === row.id) {
          selectedExamId.value = null;
          selectedSubject.value = null;
        }
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
      window.$message?.success('已新建考试');
    }
    modalShow.value = false;
    await loadExams();
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

/** 新科目：回车直接加入候选并选中 */
function handleSubjectInput(v: string) {
  newSubject.value = v;
}

function commitNewSubject() {
  const t = newSubject.value.trim();
  if (t && selectedSubject.value !== t) {
    selectedSubject.value = t;
  }
}

watch(
  () => semesterStore.activeSemesterId,
  async () => {
    selectedExamId.value = null;
    selectedSubject.value = null;
    await loadExams();
  }
);

onMounted(async () => {
  await semesterStore.initSemesters();
  await loadExams();
});
</script>

<template>
  <NCard :bordered="false" class="card-wrapper">
    <!-- 考试选择与新建 -->
    <div class="mb-16px flex flex-wrap items-center gap-12px">
      <NSelect
        v-model:value="selectedExamId"
        :options="exams.map(e => ({ label: `${e.name}（${e.date}）`, value: e.id }))"
        placeholder="选择考试"
        class="w-260px"
        filterable
      />
      <NButton :disabled="isArchived" @click="handleAdd">新建考试</NButton>
      <NDivider vertical />
      <NSelect
        v-model:value="selectedSubject"
        :options="subjectOptions"
        placeholder="选择/输入科目"
        class="w-170px"
        filterable
        tag
        :disabled="!selectedExamId"
        @update:value="(v: string) => handleSubjectInput(v)"
        @blur="commitNewSubject"
      />
      <NTag v-if="isArchived" type="warning" :bordered="false">学期已归档，只读</NTag>
    </div>

    <NDivider class="!my-8px">
      <NButton size="tiny" quaternary type="primary" @click="loadExams">考试列表（{{ exams.length }}）</NButton>
    </NDivider>
    <NDataTable
      :columns="examColumns"
      :data="exams"
      :row-key="(r: Exam) => r.id"
      :max-height="200"
      size="small"
      class="mb-16px"
    />

    <NTabs type="line" animated>
      <NTabPane name="entry" tab="录入" display-directive="show:lazy">
        <ScoreEntry :exam-id="selectedExamId ?? ''" :subject="selectedSubject ?? ''" />
      </NTabPane>
      <NTabPane name="stats" tab="统计" display-directive="show:lazy">
        <ScoreStats :exam-id="selectedExamId ?? ''" :subject="selectedSubject ?? ''" />
      </NTabPane>
    </NTabs>

    <ExamModal v-model:show="modalShow" :exam="editingExam" :saving="saving" @save="handleSaveExam" />
  </NCard>
</template>

<style scoped></style>
