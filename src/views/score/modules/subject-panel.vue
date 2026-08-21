<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import type { DataTableColumns } from 'naive-ui';
import { useSemesterStore } from '@/store/modules/semester';
import { repo } from '@/repo';
import type { Score, StudentWithEnrollment } from '@/repo';
import PasteModal from './paste-modal.vue';

defineOptions({
  name: 'ScoreSubjectPanel'
});

const props = defineProps<{
  examId: string;
  subject: string;
  roster: StudentWithEnrollment[];
  archived: boolean;
}>();

const emit = defineEmits<{
  saved: [];
  /** 科目被删除（父级刷新考试列表并退出该 Tab） */
  removed: [];
}>();

/** 编辑态：student_id -> 文本（空/缺 = 缺考） */
const inputs = ref<Record<string, string>>({});
const snapshot = ref('');
const loading = ref(false);
const saving = ref(false);
const pasteShow = ref(false);

const isDirty = computed(() => JSON.stringify(inputs.value) !== snapshot.value);

/** 归一化：空/缺/缺考 → null；数字保留两位小数；非法 → null */
function normalize(v: string | undefined): number | null {
  const t = (v ?? '').trim();
  if (t === '' || t === '缺' || t === '缺考') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** 实时统计（含未保存的输入） */
const strip = computed(() => {
  let validSum = 0;
  let validN = 0;
  let max = -Infinity;
  let min = Infinity;
  let pass = 0;
  props.roster.forEach(s => {
    const v = normalize(inputs.value[s.id]);
    if (v === null) return;
    validN += 1;
    validSum += v;
    if (v > max) max = v;
    if (v < min) min = v;
    if (v >= 60) pass += 1;
  });
  return {
    entered: validN,
    absent: props.roster.length - validN,
    avg: validN ? Math.round((validSum / validN) * 100) / 100 : null,
    passRate: validN ? Math.round((pass / validN) * 1000) / 10 : null,
    max: validN ? max : null,
    min: validN ? min : null
  };
});

/** 名次（并列取最小，实时） */
function rankOf(studentId: string): number | null {
  const mine = normalize(inputs.value[studentId]);
  if (mine === null) return null;
  let greater = 0;
  props.roster.forEach(s => {
    const v = normalize(inputs.value[s.id]);
    if (v !== null && v > mine) greater += 1;
  });
  return greater + 1;
}

interface Row {
  student: StudentWithEnrollment;
  idx: number;
}

const columns = computed<DataTableColumns<Row>>(() => [
  { title: '#', key: 'idx', width: 56, render: r => r.idx + 1 },
  { title: '学号', key: 'no', width: 110, render: r => r.student.student_no },
  { title: '姓名', key: 'name', render: r => r.student.name },
  {
    title: `${props.subject} 成绩`,
    key: 'score',
    width: 150,
    render: r =>
      h('input', {
        value: inputs.value[r.student.id] ?? '',
        disabled: props.archived,
        placeholder: '缺',
        class:
          'w-110px rounded-4px border border-[rgba(127,127,127,0.35)] bg-transparent px-8px py-4px text-14px outline-none focus:border-primary ' +
          cellClass(inputs.value[r.student.id]),
        onInput: (e: Event) => {
          inputs.value = { ...inputs.value, [r.student.id]: (e.target as HTMLInputElement).value };
        }
      })
  },
  {
    title: '名次',
    key: 'rank',
    width: 80,
    render: r => {
      const rk = rankOf(r.student.id);
      return rk ?? '—';
    }
  }
]);

function cellClass(v: string | undefined): string {
  const t = (v ?? '').trim();
  if (t === '缺' || t === '缺考') return 'text-warning';
  if (t === '') return '';
  return Number.isFinite(Number(t)) ? '' : 'text-error';
}

const rows = computed<Row[]>(() => props.roster.map((student, idx) => ({ student, idx })));

async function load() {
  if (!props.examId || !props.subject) return;
  loading.value = true;
  try {
    const scores: Score[] = await repo.getScoresBySubject(props.examId, props.subject);
    const map: Record<string, string> = {};
    scores.forEach(s => {
      map[s.student_id] = s.score === null ? '缺' : String(s.score);
    });
    inputs.value = map;
    snapshot.value = JSON.stringify(map);
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  if (!props.examId || !props.subject || saving.value) return;
  saving.value = true;
  try {
    const rowsToSave = props.roster.map(s => ({ student_id: s.id, score: normalize(inputs.value[s.id]) }));
    await repo.saveScoresForSubject(props.examId, props.subject, rowsToSave);
    snapshot.value = JSON.stringify(inputs.value);
    window.$message?.success(`已保存「${props.subject}」成绩 ${rowsToSave.length} 条`);
    emit('saved');
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

/** 粘贴整列：与名册同序覆盖 */
function handlePasteApply(values: (number | null)[]) {
  const map: Record<string, string> = {};
  props.roster.forEach((s, i) => {
    if (i < values.length) {
      map[s.id] = values[i] === null ? '缺' : String(values[i]);
    }
  });
  inputs.value = map;
  pasteShow.value = false;
}

/** 删除本科目（含全部成绩） */
function handleRemoveSubject() {
  window.$dialog?.warning({
    title: '删除科目',
    content: `将删除「${props.subject}」科目及其全部成绩（含缺考记录），不可恢复。确认删除？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const r = await repo.deleteScoresBySubject(props.examId, props.subject);
        window.$message?.success(`已删除「${props.subject}」（含成绩 ${r} 条）`);
        emit('removed');
      } catch (err) {
        window.$message?.error(err instanceof Error ? err.message : '删除失败');
      }
    }
  });
}

watch(
  () => [props.examId, props.subject],
  () => load()
);
onMounted(() => load());
</script>

<template>
  <div>
    <!-- 实时统计条 -->
    <div
      class="mb-12px flex flex-wrap items-center gap-20px rounded-6px bg-[rgba(127,127,127,0.08)] px-16px py-8px text-14px"
    >
      <span>
        已录
        <b class="text-primary">{{ strip.entered }}</b>
      </span>
      <span>
        缺考
        <b class="text-warning">{{ strip.absent }}</b>
      </span>
      <span v-if="strip.avg !== null">
        均分
        <b>{{ strip.avg }}</b>
      </span>
      <span v-if="strip.passRate !== null">
        及格率
        <b>{{ strip.passRate }}%</b>
      </span>
      <span v-if="strip.max !== null">
        最高
        <b>{{ strip.max }}</b>
        / 最低
        <b>{{ strip.min }}</b>
      </span>
      <NTag v-if="isDirty" size="small" type="warning" :bordered="false">未保存</NTag>
      <div class="ml-auto flex items-center gap-12px">
        <span class="text-13px opacity-60">空或「缺」= 缺考；Tab 切换到下一行</span>
        <NButton v-if="!archived" size="small" quaternary type="error" @click="handleRemoveSubject">删除科目</NButton>
        <NButton size="small" :disabled="archived || !examId" @click="pasteShow = true">粘贴成绩列</NButton>
        <NButton
          size="small"
          type="primary"
          :loading="saving"
          :disabled="archived || !examId || roster.length === 0"
          @click="handleSave"
        >
          保存
        </NButton>
      </div>
    </div>

    <NDataTable
      :columns="columns"
      :data="rows"
      :loading="loading"
      :row-key="(r: Row) => r.student.id"
      max-height="480"
      size="small"
    />

    <PasteModal v-model:show="pasteShow" :roster-size="roster.length" @apply="handlePasteApply" />
  </div>
</template>

<style scoped></style>
