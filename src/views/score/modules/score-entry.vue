<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';
import { repo } from '@/repo';
import type { Score } from '@/repo';
import PasteModal from './paste-modal.vue';

defineOptions({
  name: 'ScoreEntry'
});

const props = defineProps<{
  examId: string;
  subject: string;
}>();

const semesterStore = useSemesterStore();
const studentStore = useStudentStore();

/** 编辑态：student_id -> 文本（空/缺 = 缺考） */
const inputs = ref<Record<string, string>>({});
const snapshot = ref('');
const loading = ref(false);
const saving = ref(false);
const pasteShow = ref(false);

const isArchived = computed(() => semesterStore.activeSemester?.archived === true);
const isDirty = computed(() => JSON.stringify(inputs.value) !== snapshot.value);

/** 本学期在读学生（学号序） */
const roster = computed(() => studentStore.students.filter(s => s.enrollment?.status === 'active'));

const absentCount = computed(
  () =>
    roster.value.filter(s => {
      const v = inputs.value[s.id];
      return v === undefined || v.trim() === '' || v.trim() === '缺' || v.trim() === '缺考';
    }).length
);

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

function normalize(v: string): number | null {
  const t = v.trim();
  if (t === '' || t === '缺' || t === '缺考') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

async function handleSave() {
  if (!props.examId || !props.subject || saving.value) return;
  saving.value = true;
  try {
    const rows = roster.value.map(s => ({ student_id: s.id, score: normalize(inputs.value[s.id] ?? '') }));
    await repo.saveScoresForSubject(props.examId, props.subject, rows);
    snapshot.value = JSON.stringify(inputs.value);
    window.$message?.success(`已保存「${props.subject}」成绩 ${rows.length} 条`);
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

/** 粘贴整列：与名册同序覆盖 */
function handlePasteApply(values: (number | null)[]) {
  const map: Record<string, string> = {};
  roster.value.forEach((s, i) => {
    if (i < values.length) {
      map[s.id] = values[i] === null ? '缺' : String(values[i]);
    }
  });
  inputs.value = map;
  pasteShow.value = false;
}

/** 键盘导航：Enter/↓ 下移，↑ 上移 */
function handleKey(e: KeyboardEvent, index: number) {
  if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const delta = e.key === 'ArrowUp' ? -1 : 1;
  const next = index + delta;
  if (next < 0 || next >= roster.value.length) return;
  const el = document.querySelector<HTMLInputElement>(`input[data-idx="${next}"]`);
  el?.focus();
  el?.select();
}

function cellClass(v: string | undefined): string {
  const t = (v ?? '').trim();
  if (t === '缺' || t === '缺考') return 'text-warning';
  if (t === '') return '';
  return Number.isFinite(Number(t)) ? '' : 'text-error';
}

watch(
  () => [props.examId, props.subject],
  () => load()
);

onMounted(async () => {
  await semesterStore.initSemesters();
  if (semesterStore.activeSemesterId) {
    await studentStore.loadStudents(semesterStore.activeSemesterId);
  }
  await load();
});
</script>

<template>
  <div>
    <div class="mb-12px flex flex-wrap items-center gap-12px">
      <NTag v-if="isArchived" type="warning" :bordered="false">学期已归档，只读</NTag>
      <NTag v-else-if="isDirty" type="warning" :bordered="false">未保存</NTag>
      <NText depth="3" class="text-13px">空 或「缺」= 缺考；Enter/↓ 下一行，↑ 上一行</NText>
      <div class="ml-auto flex items-center gap-12px">
        <NText depth="3" class="text-13px">缺考 {{ absentCount }} 人</NText>
        <NButton :disabled="isArchived || !examId || !subject" @click="pasteShow = true">粘贴成绩列</NButton>
        <NButton
          type="primary"
          :loading="saving"
          :disabled="isArchived || !isDirty || !examId || !subject"
          @click="handleSave"
        >
          保存
        </NButton>
      </div>
    </div>

    <NSpin :show="loading">
      <div v-if="!examId || !subject" class="py-32px">
        <NEmpty description="先在上方 ② 选择考试、③ 选择科目" />
      </div>
      <div v-else-if="roster.length === 0" class="py-32px">
        <NEmpty description="本学期暂无在读学生" />
      </div>
      <div v-else class="max-h-560px overflow-auto rounded-6px border border-[rgba(127,127,127,0.28)]">
        <table class="w-full text-14px">
          <thead class="sticky top-0 z-1 bg-[rgba(127,127,127,0.14)]">
            <tr>
              <th class="w-60px px-12px py-8px text-left font-medium">#</th>
              <th class="w-120px px-12px py-8px text-left font-medium">学号</th>
              <th class="px-12px py-8px text-left font-medium">姓名</th>
              <th class="w-160px px-12px py-8px text-left font-medium">{{ subject }} 成绩</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(s, i) in roster"
              :key="s.id"
              class="border-t border-[rgba(127,127,127,0.28)] hover:bg-[rgba(127,127,127,0.14)]"
            >
              <td class="px-12px py-6px opacity-60">{{ i + 1 }}</td>
              <td class="px-12px py-6px opacity-80">{{ s.student_no }}</td>
              <td class="px-12px py-6px">{{ s.name }}</td>
              <td class="px-12px py-6px">
                <input
                  :value="inputs[s.id] ?? ''"
                  :data-idx="i"
                  :disabled="isArchived"
                  placeholder="缺"
                  class="w-120px rounded-4px border border-[rgba(127,127,127,0.28)] bg-transparent px-8px py-4px text-14px outline-none focus:border-primary"
                  :class="cellClass(inputs[s.id])"
                  @input="inputs = { ...inputs, [s.id]: ($event.target as HTMLInputElement).value }"
                  @keydown="handleKey($event, i)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </NSpin>

    <PasteModal v-model:show="pasteShow" :roster-size="roster.length" @apply="handlePasteApply" />
  </div>
</template>

<style scoped></style>
