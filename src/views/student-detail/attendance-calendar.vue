<script setup lang="ts">
import { computed, ref } from 'vue';
import { attendanceStatusLabel } from '@/constants/business';
import type { Attendance, AttendanceStatus } from '@/repo';

defineOptions({
  name: 'AttendanceCalendar'
});

const props = defineProps<{
  /** 该学生全学期考勤记录 */
  records: Attendance[];
}>();

/** 状态 → 色块底色（rgba 透明底在深浅主题都可读） */
const statusColor: Record<AttendanceStatus, string> = {
  present: 'rgba(24, 160, 88, 0.30)',
  late: 'rgba(240, 160, 32, 0.32)',
  sick: 'rgba(32, 128, 240, 0.30)',
  personal: 'rgba(144, 147, 153, 0.30)',
  absent: 'rgba(208, 48, 80, 0.34)',
  early_leave: 'rgba(240, 160, 32, 0.32)'
};

const now = new Date();
const year = ref(now.getFullYear());
const month = ref(now.getMonth()); // 0-11

const monthTitle = computed(() => `${year.value} 年 ${month.value + 1} 月`);

const byDate = computed(() => {
  const map = new Map<string, Attendance>();
  props.records.forEach(r => map.set(r.date, r));
  return map;
});

/** 周一~周日 6 行日历格 */
const weeks = computed(() => {
  const first = new Date(year.value, month.value, 1);
  const daysInMonth = new Date(year.value, month.value + 1, 0).getDate();
  // 周一为一周起点
  const lead = (first.getDay() + 6) % 7;

  const cells: ({ day: number; date: string } | null)[] = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push({
      day: d,
      date: `${year.value}-${String(month.value + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: ({ day: number; date: string } | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
});

function cellStyle(date: string): string {
  const rec = byDate.value.get(date);
  if (!rec) return '';
  return statusColor[rec.status];
}

function cellTitle(date: string): string {
  const rec = byDate.value.get(date);
  if (!rec) return `${date}：无记录`;
  return `${date}：${attendanceStatusLabel[rec.status]}${rec.remark ? `（${rec.remark}）` : ''}`;
}

function prevMonth() {
  month.value -= 1;
  if (month.value < 0) {
    month.value = 11;
    year.value -= 1;
  }
}

function nextMonth() {
  month.value += 1;
  if (month.value > 11) {
    month.value = 0;
    year.value += 1;
  }
}
</script>

<template>
  <div>
    <div class="mb-12px flex items-center gap-12px">
      <NButton size="small" quaternary @click="prevMonth">‹ 上月</NButton>
      <span class="w-110px text-center text-15px font-medium">{{ monthTitle }}</span>
      <NButton size="small" quaternary @click="nextMonth">下月 ›</NButton>
      <div class="ml-auto flex flex-wrap gap-8px text-12px opacity-80">
        <span v-for="(color, st) in statusColor" :key="st" class="flex items-center gap-4px">
          <span class="inline-block h-10px w-10px rounded-2px" :style="{ background: color }" />
          {{ attendanceStatusLabel[st] }}
        </span>
      </div>
    </div>
    <div class="grid grid-cols-7 gap-4px text-center">
      <div v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w" class="py-4px text-12px opacity-60">
        周{{ w }}
      </div>
      <template v-for="(week, wi) in weeks" :key="wi">
        <div
          v-for="(cell, ci) in week"
          :key="`${wi}-${ci}`"
          class="flex h-44px items-center justify-center rounded-4px text-14px"
          :class="cell ? 'bg-[rgba(127,127,127,0.10)]' : ''"
          :style="cell ? { background: cellStyle(cell.date) || undefined } : {}"
          :title="cell ? cellTitle(cell.date) : ''"
        >
          {{ cell?.day ?? '' }}
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped></style>
