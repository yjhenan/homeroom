<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import { printElement } from '@/utils/print';
import type { DataTableColumns } from 'naive-ui';
import { NTag } from 'naive-ui';
import { repo } from '@/repo';
import type { Score, StudentWithEnrollment } from '@/repo';

defineOptions({
  name: 'ScoreMatrixPanel'
});

const props = defineProps<{
  examId: string;
  examName: string;
  subjects: string[];
  roster: StudentWithEnrollment[];
  /** 版本号：任何科目保存后 +1，触发重载 */
  version: number;
}>();

const examName = computed(() => props.examName || '成绩单');

interface Row extends StudentWithEnrollment {
  scores: Record<string, number | null>;
  total: number;
  rank: number | null;
}

const allScores = ref<Score[]>([]);
const loading = ref(false);
const tableRef = ref<HTMLElement | null>(null);

function handlePrint() {
  printElement(tableRef.value, `成绩单 · ${examName.value}`);
}

async function load() {
  if (!props.examId) {
    allScores.value = [];
    return;
  }
  loading.value = true;
  try {
    allScores.value = await repo.getScoresByExam(props.examId);
  } finally {
    loading.value = false;
  }
}

const rows = computed<Row[]>(() => {
  const map = new Map<string, Record<string, number | null>>();
  allScores.value.forEach(s => {
    const rec = map.get(s.student_id) ?? {};
    rec[s.subject] = s.score;
    map.set(s.student_id, rec);
  });

  const list = props.roster.map(stu => {
    const scores = map.get(stu.id) ?? {};
    const total = props.subjects.reduce((sum, sub) => sum + (scores[sub] ?? 0), 0);
    return { ...stu, scores, total, rank: null as number | null };
  });

  // 名次按总分（并列取最小）；一科未录的学生不排名
  const withScores = list.filter(r => props.subjects.some(sub => r.scores[sub] !== undefined));
  withScores.forEach(r => {
    r.rank = withScores.filter(x => x.total > r.total).length + 1;
  });
  return list;
});

/** 汇总行：各科均分 */
const summary = computed(() => {
  const bySubject = new Map<string, { sum: number; n: number }>();
  props.subjects.forEach(sub => bySubject.set(sub, { sum: 0, n: 0 }));
  allScores.value.forEach(s => {
    if (s.score === null || !bySubject.has(s.subject)) return;
    const rec = bySubject.get(s.subject)!;
    rec.sum += s.score;
    rec.n += 1;
  });
  const avg = (sum: number, n: number) => (n ? Math.round((sum / n) * 100) / 100 : '—');
  const totals = rows.value.filter(r => props.subjects.some(sub => r.scores[sub] !== undefined));
  const totalAvg = totals.length
    ? Math.round((totals.reduce((s, r) => s + r.total, 0) / totals.length) * 100) / 100
    : '—';
  return { bySubject, avg, totalAvg };
});

const columns = computed<DataTableColumns<Row>>(() => [
  { title: '#', key: 'idx', width: 56, render: (r, i) => r.rank ?? i + 1 },
  { title: '学号', key: 'student_no', width: 110 },
  { title: '姓名', key: 'name', width: 100 },
  ...props.subjects.map<DataTableColumns<Row>[number]>(sub => ({
    title: sub,
    key: `s-${sub}`,
    width: 90,
    align: 'center',
    render: r => {
      const v = r.scores[sub];
      if (v === undefined) return h('span', { class: 'opacity-40' }, '—');
      if (v === null) return h(NTag, { size: 'small', bordered: false }, { default: () => '缺' });
      return h('span', { class: v < 60 ? 'text-error' : '' }, String(v));
    }
  })),
  { title: '总分', key: 'total', width: 90, align: 'center', render: r => (r.rank ? r.total : '—') },
  { title: '名次', key: 'rank', width: 70, align: 'center', render: r => r.rank ?? '—' }
]);

watch(
  () => [props.examId, props.version],
  () => load()
);
onMounted(() => load());
</script>

<template>
  <div>
    <div class="mb-12px text-13px opacity-60">
      总表为只读汇总：保存各科成绩后自动更新；「—」未录入，「缺」为缺考，缺考按 0 分计入总分。
    </div>
    <!-- 打印在 WebView2 下弹窗空白，暂隐待修复 -->
    <NButton v-if="false" size="small" class="mb-8px" @click="handlePrint">打印成绩单</NButton>
    <div
      class="mb-8px flex flex-wrap items-center gap-16px rounded-6px bg-[rgba(127,127,127,0.08)] px-16px py-8px text-13px"
    >
      <span class="opacity-70">班级均分：</span>
      <span v-for="sub in subjects" :key="sub">
        {{ sub }}
        <b>
          {{
            summary.bySubject.get(sub)?.n
              ? summary.avg(summary.bySubject.get(sub)!.sum, summary.bySubject.get(sub)!.n)
              : '—'
          }}
        </b>
      </span>
      <span>
        总分
        <b>{{ summary.totalAvg }}</b>
      </span>
    </div>
    <div ref="tableRef">
      <NDataTable
        :columns="columns"
        :data="rows"
        :loading="loading"
        :row-key="(r: Row) => r.id"
        max-height="480"
        size="small"
        :scroll-x="560 + subjects.length * 90"
      />
    </div>
  </div>
</template>

<style scoped></style>
