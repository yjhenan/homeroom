<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';
import { repo } from '@/repo';
import type { Score } from '@/repo';

defineOptions({
  name: 'ScoreStats'
});

const props = defineProps<{
  examId: string;
  subject: string;
}>();

const semesterStore = useSemesterStore();
const studentStore = useStudentStore();

const scores = ref<Score[]>([]);
const loading = ref(false);

async function load() {
  if (!props.examId || !props.subject) {
    scores.value = [];
    return;
  }
  loading.value = true;
  try {
    scores.value = await repo.getScoresBySubject(props.examId, props.subject);
  } finally {
    loading.value = false;
  }
}

interface StatRow {
  student_id: string;
  name: string;
  student_no: string;
  score: number | null;
  rank: number | null;
}

const valid = computed(() => scores.value.filter(s => s.score !== null).map(s => s.score as number));

const summary = computed(() => {
  const n = valid.value.length;
  if (n === 0) return null;
  const sorted = [...valid.value].sort((a, b) => a - b);
  const avg = valid.value.reduce((a, b) => a + b, 0) / n;
  const pass = valid.value.filter(v => v >= 60).length;
  return {
    n,
    absent: scores.value.length - n,
    avg: Math.round(avg * 100) / 100,
    passRate: Math.round((pass / n) * 1000) / 10,
    min: sorted[0],
    max: sorted[n - 1]
  };
});

/** 名次并列取最小值：rank = 严格大于自己的人数 + 1 */
const rows = computed<StatRow[]>(() => {
  const map = new Map(studentStore.students.map(s => [s.id, s]));
  const sorted = scores.value.map(s => ({ ...s, score: s.score })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return sorted.map(s => {
    const rank = s.score === null ? null : valid.value.filter(v => v > (s.score as number)).length + 1;
    return {
      student_id: s.student_id,
      name: map.get(s.student_id)?.name ?? '（已删除）',
      student_no: map.get(s.student_id)?.student_no ?? '—',
      score: s.score,
      rank
    };
  });
});

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
    <div v-if="!examId || !subject" class="py-32px">
      <NEmpty description="先在上方 ② 选择考试、③ 选择科目" />
    </div>
    <template v-else>
      <div v-if="summary" class="mb-16px flex flex-wrap gap-24px">
        <NStatistic label="参评" :value="summary.n">
          <template #suffix>人（缺考 {{ summary.absent }}）</template>
        </NStatistic>
        <NStatistic label="均分" :value="summary.avg" />
        <NStatistic label="及格率" :value="summary.passRate">
          <template #suffix>%</template>
        </NStatistic>
        <NStatistic label="最高" :value="summary.max" />
        <NStatistic label="最低" :value="summary.min" />
      </div>
      <NEmpty v-else description="该科目暂无成绩" class="py-24px" />
      <div v-if="rows.length" class="max-h-480px overflow-auto rounded-6px border border-[rgb(63,69,87)]">
        <table class="w-full text-14px">
          <thead class="sticky top-0 bg-[rgb(38,45,64)]">
            <tr>
              <th class="w-80px px-12px py-8px text-left font-medium">名次</th>
              <th class="w-120px px-12px py-8px text-left font-medium">学号</th>
              <th class="px-12px py-8px text-left font-medium">姓名</th>
              <th class="w-120px px-12px py-8px text-left font-medium">成绩</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="r.student_id" class="border-t border-[rgb(63,69,87)]">
              <td class="px-12px py-6px font-medium">{{ r.rank ?? '—' }}</td>
              <td class="px-12px py-6px opacity-80">{{ r.student_no }}</td>
              <td class="px-12px py-6px">{{ r.name }}</td>
              <td class="px-12px py-6px">
                <NTag v-if="r.score === null" size="small" :bordered="false">缺考</NTag>
                <span v-else :class="r.score < 60 ? 'text-error' : ''">{{ r.score }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped></style>
