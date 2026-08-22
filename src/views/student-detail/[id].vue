<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import dayjs from 'dayjs';
import { useRoute } from 'vue-router';
import { attendanceStatusLabel, attendedStatuses, genderLabel } from '@/constants/business';
import { useSemesterStore } from '@/store/modules/semester';
import { repo } from '@/repo';
import type { Attendance, Student } from '@/repo';
import { calendarOf, todayStr, workdaysBetween } from '@/utils/date';
import HistoryTab from '../attendance/modules/history-tab.vue';
import AttendanceCalendar from './attendance-calendar.vue';
import ScoresTab from './scores-tab.vue';
import DisciplineTab from './discipline-tab.vue';
import DutyTab from './duty-tab.vue';

defineOptions({
  name: 'StudentDetail'
});

const route = useRoute();
const semesterStore = useSemesterStore();

const studentId = computed(() => route.params.id as string);
const student = ref<Student | null>(null);
const records = ref<Attendance[]>([]);
const loading = ref(false);

/** 学期范围内的记录（历史遗留的范围外数据不���统计，列表照常展示） */
const inRangeRecords = computed(() => {
  const sem = semesterStore.activeSemester;
  if (!sem) return records.value;
  return records.value.filter(r => r.date >= sem.start_date && r.date <= sem.end_date);
});

/** 应出勤天数：学期开始~今天之间的上课日（按教学日历推导，含调休） */
const expectedDays = computed(() => {
  const sem = semesterStore.activeSemester;
  if (!sem) return 0;
  const stop = dayjs().isBefore(dayjs(sem.end_date), 'day') ? todayStr() : sem.end_date;
  return workdaysBetween(sem.start_date, stop, calendarOf(sem));
});

/**
 * 出勤率（日历口径）：出勤由教学日历推导，库中只存异常
 * - 到校 = 应出勤 - 未到校异常（病假/事假/旷课）；迟到/早退计入到校
 * - 应出勤为 0（开学前）时无意义 → null
 */
const stats = computed(() => {
  const counts = new Map<string, number>();
  inRangeRecords.value.forEach(r => counts.set(r.status, (counts.get(r.status) ?? 0) + 1));
  const absent = inRangeRecords.value.filter(r => !attendedStatuses.includes(r.status)).length;
  const attended = Math.max(0, expectedDays.value - absent);
  const rate = expectedDays.value === 0 ? null : Math.round((attended / expectedDays.value) * 1000) / 10;
  return { total: inRangeRecords.value.length, absent, attended, rate, counts };
});

const statItems = computed(() =>
  (Object.keys(attendanceStatusLabel) as (keyof typeof attendanceStatusLabel)[]).map(st => ({
    label: attendanceStatusLabel[st],
    count: stats.value.counts.get(st) ?? 0
  }))
);

async function load() {
  if (!semesterStore.activeSemesterId) return;
  loading.value = true;
  try {
    student.value = await repo.getStudent(studentId.value);
    records.value = await repo.queryAttendance({
      semesterId: semesterStore.activeSemesterId,
      studentId: studentId.value
    });
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await semesterStore.initSemesters();
  await load();
});
</script>

<template>
  <NSpace vertical :size="16">
    <!-- 基本信息卡 -->
    <NCard :bordered="false" class="card-wrapper">
      <NSpin :show="loading">
        <div v-if="student" class="flex flex-wrap items-start gap-24px">
          <div
            class="flex h-56px w-56px items-center justify-center rounded-full bg-primary text-20px font-medium text-white"
          >
            {{ student.name.slice(0, 1) }}
          </div>
          <div class="min-w-300px flex-1">
            <div class="flex items-center gap-12px">
              <span class="text-20px font-medium">{{ student.name }}</span>
              <NTag size="small" :bordered="false">{{ student.student_no }}</NTag>
              <NTag size="small" :bordered="false" type="info">{{ genderLabel[student.gender] }}</NTag>
            </div>
            <NDivider class="!my-10px" />
            <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6px text-14px opacity-80">
              <span>出生日期：{{ student.birth_date ?? '—' }}</span>
              <span>家长电话：{{ student.parent_contact ?? '—' }}</span>
              <span class="col-span-2">住址：{{ student.address ?? '—' }}</span>
              <span class="col-span-2">备注：{{ student.notes ?? '—' }}</span>
            </div>
          </div>
        </div>
        <NEmpty v-else-if="!loading" description="学生不存在或已删除" class="py-24px" />
      </NSpin>
    </NCard>

    <!-- 360 Tabs -->
    <NCard :bordered="false" class="card-wrapper">
      <NTabs type="line" animated>
        <NTabPane name="attendance" tab="考勤" display-directive="show:lazy">
          <div class="mb-16px flex flex-wrap items-center gap-16px">
            <NStatistic label="出勤率" :value="stats.rate ?? '—'">
              <template #suffix>%</template>
            </NStatistic>
            <NStatistic label="应出勤天数" :value="expectedDays">
              <template #suffix>天（按教学日历）</template>
            </NStatistic>
            <NStatistic label="到校天数" :value="stats.attended" />
            <NStatistic label="异常天数" :value="stats.total" />
            <div class="ml-auto flex flex-wrap gap-8px">
              <NTag v-for="it in statItems" :key="it.label" :bordered="false" size="small">
                {{ it.label }} {{ it.count }}
              </NTag>
            </div>
          </div>
          <AttendanceCalendar :records="records" />
          <NDivider>考勤记录</NDivider>
          <HistoryTab :student-id="studentId" />
        </NTabPane>
        <NTabPane name="scores" tab="成绩" display-directive="show:lazy">
          <ScoresTab :student-id="studentId" />
        </NTabPane>
        <NTabPane name="discipline" tab="德育" display-directive="show:lazy">
          <DisciplineTab :student-id="studentId" />
        </NTabPane>
        <NTabPane name="duty" tab="值日" display-directive="show:lazy">
          <DutyTab :student-id="studentId" />
        </NTabPane>
      </NTabs>
    </NCard>
  </NSpace>
</template>

<style scoped></style>
