<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { UploadFileInfo } from 'naive-ui';
import * as XLSX from 'xlsx';
import { commonSubjects } from '@/constants/business';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';
import { repo } from '@/repo';
import type { ScoreImportPlan } from '@/utils/score-import';
import { buildScoreImportPlan } from '@/utils/score-import';
import { readSheetMatrix } from '@/utils/excel';

defineOptions({
  name: 'ScoreImportModal'
});

const props = defineProps<{
  show: boolean;
  examId: string;
  /** 该考试已有科目（提示新建/覆盖） */
  existingSubjects: string[];
}>();

const emit = defineEmits<{
  'update:show': [value: boolean];
  /** 导入完成后刷新（考试科目可能新增，总表需重载） */
  refreshed: [];
}>();

const semesterStore = useSemesterStore();
const studentStore = useStudentStore();

type Stage = 'pick' | 'errors' | 'confirm' | 'done';

const stage = ref<Stage>('pick');
const fileName = ref('');
const plan = ref<ScoreImportPlan | null>(null);
const importing = ref(false);
const doneSummary = ref('');

const roster = computed(() =>
  studentStore.students
    .filter(s => s.enrollment?.status === 'active')
    .map(s => ({ id: s.id, student_no: s.student_no, name: s.name }))
);

/** 表中未出现的学生数（导入将保留其库内已有成绩，没有则为缺考） */
const absentFromFile = computed(() => {
  if (!plan.value) return 0;
  const appeared = new Set<string>();
  Object.values(plan.value.scores).forEach(map => Object.keys(map).forEach(id => appeared.add(id)));
  return roster.value.length - appeared.size;
});

const newSubjects = computed(() => plan.value?.subjects.filter(s => !props.existingSubjects.includes(s)) ?? []);

watch(
  () => props.show,
  show => {
    if (!show) return;
    reset();
  }
);

function reset() {
  stage.value = 'pick';
  fileName.value = '';
  plan.value = null;
  importing.value = false;
  doneSummary.value = '';
}

function handleClose() {
  emit('update:show', false);
}

/** 下载模板：学号 + 姓名 + 常用科目，且预填当前名册（在 Excel 里直接填分数即可） */
function downloadTemplate() {
  const headers = ['学号', '姓名', ...commonSubjects.slice(0, 3)];
  const body = roster.value.map(s => [s.student_no, s.name, '', '', '']);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
  ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '成绩表');
  XLSX.writeFile(wb, '成绩表模板.xlsx');
}

async function handleFileChange(options: { fileList: UploadFileInfo[] }) {
  const file = options.fileList[0]?.file;
  if (!file) return;
  reset();
  fileName.value = file.name;

  try {
    if (!studentStore.students.length && semesterStore.activeSemesterId) {
      await studentStore.loadStudents(semesterStore.activeSemesterId);
    }
    const { headers, rows } = await readSheetMatrix(file);
    const result = buildScoreImportPlan(headers, rows, roster.value);
    plan.value = result;
    stage.value = result.errors.length > 0 ? 'errors' : 'confirm';
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '文件读取失败');
    stage.value = 'pick';
  }
}

async function handleImport() {
  if (!plan.value || !props.examId || importing.value) return;
  importing.value = true;
  try {
    let totalScores = 0;
    for (const sub of plan.value.subjects) {
      // 合并语义：表中未出现的学生保留库内已有成绩
      const existing = await repo.getScoresBySubject(props.examId, sub);
      const existingMap = new Map(existing.map(s => [s.student_id, s.score]));
      const rowsToSave = roster.value.map(s => ({
        student_id: s.id,
        score: plan.value!.scores[sub][s.id] ?? existingMap.get(s.id) ?? null
      }));
      await repo.saveScoresForSubject(props.examId, sub, rowsToSave);
      totalScores += rowsToSave.length;
    }
    doneSummary.value = `已导入 ${plan.value.subjects.length} 个科目（新增 ${newSubjects.value.length} 个），共 ${totalScores} 条成绩`;
    stage.value = 'done';
    emit('refreshed');
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '导入失败');
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    title="导入成绩表"
    class="w-600px"
    :mask-closable="false"
    @update:show="handleClose"
  >
    <!-- 第 1 步：选择文件 -->
    <template v-if="stage === 'pick'">
      <NAlert type="info" :bordered="false" class="mb-12px">
        表头须含「学号」列，其余列（除姓名/总分/名次等元数据）识别为科目；按学号匹配当前学期名。 空 / 缺 / 缺考 =
        缺考；表中未出现的学生保留已有成绩。
      </NAlert>
      <div class="flex items-center gap-12px">
        <NUpload
          accept=".xlsx,.xls"
          :max="1"
          :default-upload="false"
          :show-file-list="false"
          @change="handleFileChange"
        >
          <NButton type="primary">选择 Excel 文件</NButton>
        </NUpload>
        <NButton quaternary type="primary" @click="downloadTemplate">下载模板</NButton>
      </div>
    </template>

    <!-- 第 2 步：错误全量展示 -->
    <template v-else-if="stage === 'errors'">
      <NAlert type="error" :bordered="false" class="mb-12px">
        {{ fileName }} 有 {{ plan?.errors.length }} 处问题，全部列出如下。修正后重新上传。
      </NAlert>
      <div class="max-h-320px overflow-auto rounded-4px bg-[rgba(127,127,127,0.08)] p-8px">
        <div v-for="e in plan?.errors" :key="`${e.row}-${e.message}`" class="py-2px">
          <NTag size="small" type="error" :bordered="false" class="mr-8px">
            {{ e.row === 0 ? '表头' : `第 ${e.row} 行` }}
          </NTag>
          <span>{{ e.message }}</span>
        </div>
      </div>
      <div class="mt-12px flex justify-end">
        <NButton @click="reset">重新选择文件</NButton>
      </div>
    </template>

    <!-- 第 3 步：确认 -->
    <template v-else-if="stage === 'confirm' && plan">
      <div class="mb-12px">
        文件
        <b>{{ fileName }}</b>
        解析完成：匹配
        <b class="text-primary">{{ plan.matchedCount }}</b>
        名学生，识别
        <b>{{ plan.subjects.length }}</b>
        个科目（
        <template v-for="(s, i) in plan.subjects" :key="s">
          {{ s }}{{ i < plan.subjects.length - 1 ? '、' : '' }}
        </template>
        ）。
      </div>
      <div v-if="newSubjects.length" class="mb-8px text-13px">
        将新建科目：
        <NTag v-for="s in newSubjects" :key="s" size="small" class="mr-4px" :bordered="false">{{ s }}</NTag>
      </div>
      <div v-if="plan.ignoredHeaders.length" class="mb-8px text-13px opacity-70">
        已忽略元数据列：{{ plan.ignoredHeaders.join('、') }}
      </div>
      <div v-if="absentFromFile > 0" class="mb-8px text-13px opacity-70">
        名册中 {{ absentFromFile }} 名学生未在表中出现，将保留其已有成绩（无则为缺考）。
      </div>
      <NAlert v-if="plan.warnings.length" type="warning" :bordered="false" class="mb-12px">
        <div v-for="w in plan.warnings" :key="`${w.row}-${w.message}`" class="py-1px">{{ w.message }}</div>
      </NAlert>
      <div class="mt-16px flex justify-end gap-12px">
        <NButton @click="reset">重新选择文件</NButton>
        <NButton type="primary" :loading="importing" @click="handleImport">开始导入</NButton>
      </div>
    </template>

    <!-- 第 4 步：完成 -->
    <template v-else>
      <NResult status="success" title="导入完成" :description="doneSummary" />
      <div class="flex justify-end">
        <NButton type="primary" @click="handleClose">关闭</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped></style>
