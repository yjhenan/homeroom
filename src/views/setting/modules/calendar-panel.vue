<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CalendarMark, Semester } from '@/repo';
import { repo } from '@/repo';
import { calendarOf, schoolDaysSoFar } from '@/utils/date';
import type { Calendar } from '@/utils/date';
import dayjs from 'dayjs';

defineOptions({
  name: 'SemesterCalendarPanel'
});

const props = defineProps<{
  semester: Semester | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

/** 编辑态：date → mark */
const marks = ref<Calendar>({});
const saving = ref(false);

watch(
  () => props.semester,
  sem => {
    if (!sem) return;
    marks.value = { ...calendarOf(sem) };
  },
  { immediate: true }
);

const semStart = computed(() => props.semester?.start_date ?? '2000-01-01');
const semEnd = computed(() => props.semester?.end_date ?? '2099-12-31');

/** NCalendar 默认定位到学期开始月 */
const defaultValueTs = computed(() => dayjs(semStart.value).valueOf());

/** 某日期的展示状态：holiday / school / 默认（按星期与是否在学期内） */
function markOf(key: string): CalendarMark | 'weekday' | 'weekend' {
  const m = marks.value[key];
  if (m) return m;
  const dow = dayjs(key).day();
  return dow >= 1 && dow <= 5 ? 'weekday' : 'weekend';
}

/** 点击切换：工作日↔假期，周末↔补课；再点还原 */
/**
 * 点击切换（差值语义，任何日期都可标记）：
 * - 范围内：工作日 ↔ 假期，周末 ↔ 补课
 * - 范围外：任意日 → 补课（创造一个上课日，如开学前军训）；范围外无"默认上课"可言，不产生假期标记
 * - 已标记 → 再点还原
 */
function handleCellClick(ts: number) {
  const key = dayjs(ts).format('YYYY-MM-DD');
  const next = { ...marks.value };
  const dow = dayjs(key).day();
  const isWeekend = dow === 0 || dow === 6;
  const inSemester = key >= semStart.value && key <= semEnd.value;

  if (next[key]) {
    delete next[key]; // 已标记 → 还原默认
  } else {
    next[key] = !inSemester || isWeekend ? 'school' : 'holiday';
  }
  marks.value = next;
}

const stateLabel: Record<string, string> = {
  weekday: '上课',
  weekend: '休息',
  holiday: '假期',
  school: '补课'
};

const stateClass: Record<string, string> = {
  holiday: 'rounded-4px bg-[rgba(240,160,32,0.25)] px-6px text-12px text-[rgb(240,160,32)]',
  school: 'rounded-4px bg-[rgba(24,160,88,0.25)] px-6px text-12px text-[rgb(80,200,140)]'
};

/** 汇总：至今应上课天数（范围内工作日基线 + 范围外补课标记，以今天为上界），随编辑实时变 */
const schoolDays = computed(() => {
  if (!props.semester) return 0;
  return schoolDaysSoFar(semStart.value, semEnd.value, marks.value);
});

const holidayCount = computed(() => Object.values(marks.value).filter(m => m === 'holiday').length);
const makeupCount = computed(() => Object.values(marks.value).filter(m => m === 'school').length);

async function handleSave() {
  if (!props.semester || saving.value) return;
  saving.value = true;
  try {
    // 浅拷贝成普通对象：marks.value 是 Vue reactive Proxy，IndexedDB structured clone 会抛 DataCloneError
    await repo.setSemesterCalendar(props.semester.id, { ...marks.value });
    window.$message?.success('教学日历已保存');
    emit('saved');
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

function handleClose() {
  emit('close');
}
</script>

<template>
  <NCard :bordered="false" class="card-wrapper" :title="`教学日历 · ${props.semester?.name ?? ''}`">
    <template #header-extra>
      <NButton size="small" quaternary @click="handleClose">收起</NButton>
    </template>
    <div class="mb-8px flex flex-wrap items-center gap-16px text-13px">
      <span class="opacity-70">点击日期切换（学期外点击 = 标记补课，如开学前活动）：</span>
      <span>
        工作日 上课 →
        <b class="text-warning">假期</b>
      </span>
      <span>
        周末 休息 →
        <b class="text-success">补课</b>
      </span>
      <span class="opacity-60">再点还原；范围外只产生补课标记</span>
      <span class="ml-auto">
        假期
        <b>{{ holidayCount }}</b>
        天 · 补课
        <b>{{ makeupCount }}</b>
        天 · 学期至今应上课
        <b class="text-primary">{{ schoolDays }}</b>
        天
      </span>
    </div>

    <NCalendar :default-value="defaultValueTs" class="teaching-calendar" @update:value="handleCellClick">
      <template #default="{ year, month, date }">
        <div
          v-if="
            stateLabel[markOf(`${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`)] !== '上课'
          "
          :class="
            stateClass[markOf(`${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`)] ??
            'rounded-4px bg-[rgba(127,127,127,0.15)] px-6px text-12px opacity-60'
          "
          class="mt-2px self-start"
        >
          {{ stateLabel[markOf(`${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`)] }}
        </div>
      </template>
    </NCalendar>

    <div class="mt-12px flex justify-end">
      <NButton type="primary" :loading="saving" @click="handleSave">保存</NButton>
    </div>
  </NCard>
</template>

<style scoped>
:deep(.teaching-calendar) {
  --n-cell-height: 64px !important;
}
:deep(.teaching-calendar .n-calendar-cell) {
  cursor: pointer;
}
:deep(.teaching-calendar .n-calendar-dates) {
  gap: 4px;
}
</style>
