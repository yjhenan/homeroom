<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useEcharts } from '@/hooks/common/echarts';
import type { ECOption } from '@/hooks/common/echarts';
import { useSemesterStore } from '@/store/modules/semester';
import { repo } from '@/repo';
import type { Exam, Score } from '@/repo';

defineOptions({
  name: 'StudentScoresTab'
});

const props = defineProps<{
  studentId: string;
}>();

const semesterStore = useSemesterStore();

const scores = ref<Score[]>([]);
const exams = ref<Exam[]>([]);
const loading = ref(false);

const examMap = computed(() => new Map(exams.value.map(e => [e.id, e])));

/** 按考试日期升序的考试轴（只含有成绩的考试） */
const examAxis = computed(() => {
  const ids = new Set(scores.value.map(s => s.exam_id));
  return exams.value
    .filter(e => ids.has(e.id))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({ id: e.id, label: `${e.date.slice(5)} ${e.name}` }));
});

/** 折线图：每科目一条线 */
const chartOptions = computed<ECOption>(() => {
  const subjects = Array.from(new Set(scores.value.map(s => s.subject)));
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 40, right: 20, top: 36, bottom: 28 },
    xAxis: { type: 'category', data: examAxis.value.map(e => e.label) },
    yAxis: { type: 'value' },
    series: subjects.map(sub => ({
      name: sub,
      type: 'line',
      connectNulls: true,
      data: examAxis.value.map(e => scores.value.find(s => s.exam_id === e.id && s.subject === sub)?.score ?? null)
    }))
  };
});

const { domRef, setOptions } = useEcharts(() => chartOptions.value);

watch(chartOptions, opts => setOptions(opts));

interface DetailRow {
  date: string;
  exam_name: string;
  subject: string;
  score: number | null;
}

const detailRows = computed<DetailRow[]>(() =>
  scores.value
    .map(s => {
      const exam = examMap.value.get(s.exam_id);
      return { date: exam?.date ?? '—', exam_name: exam?.name ?? '（已删除考试）', subject: s.subject, score: s.score };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.subject.localeCompare(b.subject))
);

async function load() {
  if (!semesterStore.activeSemesterId) return;
  loading.value = true;
  try {
    const [s, e] = await Promise.all([
      repo.getScoresByStudent(semesterStore.activeSemesterId, props.studentId),
      repo.listExams(semesterStore.activeSemesterId)
    ]);
    scores.value = s;
    exams.value = e;
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.studentId, semesterStore.activeSemesterId],
  () => load()
);

onMounted(() => load());
</script>

<template>
  <div>
    <NSpin :show="loading">
      <NEmpty v-if="scores.length === 0" description="本学期暂无成绩" class="py-24px" />
      <template v-else>
        <div ref="domRef" class="h-280px w-full"></div>
        <NDivider>各次考试明细</NDivider>
        <NTable :bordered="false" :single-line="false" size="small" :max-height="360">
          <thead>
            <tr>
              <th>日期</th>
              <th>考试</th>
              <th>科目</th>
              <th>成绩</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in detailRows" :key="i">
              <td>{{ r.date }}</td>
              <td>{{ r.exam_name }}</td>
              <td>{{ r.subject }}</td>
              <td>
                <NTag v-if="r.score === null" size="small" :bordered="false">缺考</NTag>
                <span v-else :class="r.score < 60 ? 'text-error' : ''">{{ r.score }}</span>
              </td>
            </tr>
          </tbody>
        </NTable>
      </template>
    </NSpin>
  </div>
</template>

<style scoped></style>
