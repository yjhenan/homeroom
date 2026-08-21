<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import dayjs from 'dayjs';
import { useRoute } from 'vue-router';
import { attendanceStatusLabel, attendedStatuses, genderLabel } from '@/constants/business';
import { useSemesterStore } from '@/store/modules/semester';
import { repo } from '@/repo';
import type { Attendance, Student } from '@/repo';
import { todayStr, workdaysBetween } from '@/utils/date';
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

/** 出勤率 = 到校天数（present/late/early_leave） / 已记录天数 */
const stats = computed(() => {
  const counts = new Map<string, number>();
  records.value.forEach(r => counts.set(r.status, (counts.get(r.status) ?? 0) + 1));
  const total = records.value.length;
  const attended = records.value.filter(r => attendedStatuses.includes(r.status)).length;
  const rate = total === 0 ? null : Math.round((attended / total) * 1000) / 10;
  return { total, attended, rate, counts };
});

/** 应出勤天数：学期开始~今天之间的工作日（周一~周五），开学前/假期按 0 */
const expectedDays = computed(() => {
  const sem = semesterStore.activeSemester;
  if (!sem) return 0;
  const stop = dayjs().isBefore(dayjs(sem.end_date), 'day') ? todayStr() : sem.end_date;
  return workdaysBetween(sem.start_date, stop, sem.holidays ?? []);
});

/** 缺记录天数 = 应出勤 - 已记录（>0 提醒补录，出勤率口径注明"按已记录"） */
const missingDays = computed(() => Math.max(0, expectedDays.value - stats.value.total));

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
            <NStatistic label="出勤率（按已记录）" :value="stats.rate ?? '—'">
              <template #suffix>%</template>
            </NStatistic>
            <NStatistic label="已记录天数" :value="stats.total" />
            <NStatistic label="到校天数" :value="stats.attended" />
            <NStatistic label="应出勤工作日" :value="expectedDays" />
            <NStatistic label="缺记录" :value="missingDays">
              <template #suffix>天</template>
            </NStatistic>
            <NTag v-if="missingDays > 0" type="warning" size="small" :bordered="false">
              有 {{ missingDays }} 个工作日未录考勤
            </NTag>
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
