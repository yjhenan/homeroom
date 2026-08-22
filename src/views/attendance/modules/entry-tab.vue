<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { onBeforeRouteLeave } from 'vue-router';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';
import { repo } from '@/repo';
import type { AttendanceInput, AttendanceStatus } from '@/repo';
import { attendanceStatusLabel, attendanceTagType, nextAttendanceStatus } from '@/constants/business';
import { todayStr } from '@/utils/date';
import RemarkDrawer from './remark-drawer.vue';

defineOptions({
  name: 'AttendanceEntry'
});

const semesterStore = useSemesterStore();
const studentStore = useStudentStore();

const isArchived = computed(() => semesterStore.activeSemester?.archived === true);

/** 考勤日期必须落在学期内：默认今天，学期未开始/已结束则钳到最近边界 */
const semRange = computed(() => {
  const sem = semesterStore.activeSemester;
  return { start: sem?.start_date ?? '0000-01-01', end: sem?.end_date ?? '9999-12-31' };
});

function clampToSemester(d: string): string {
  if (d < semRange.value.start) return semRange.value.start;
  if (d > semRange.value.end) return semRange.value.end;
  return d;
}

const date = ref<string>(clampToSemester(todayStr()));
/** 当前编辑态：student_id → { status, remark } */
const statuses = ref<Record<string, { status: AttendanceStatus; remark?: string }>>({});
/** 加载完成时的快照，用于脏比较（必须响应式：isDirty computed 依赖它，普通变量不会触发重算） */
const snapshot = ref('');
const loading = ref(false);
const saving = ref(false);
const drawerShow = ref(false);

/** 本学期在读学生 */
const roster = computed(() => studentStore.students.filter(s => s.enrollment?.status === 'active'));

const isDirty = computed(() => JSON.stringify(statuses.value) !== snapshot.value);

/** 汇总：各状态人数 */
const summary = computed(() => {
  const counts = new Map<AttendanceStatus, number>();
  roster.value.forEach(s => {
    const st = statuses.value[s.id]?.status ?? 'present';
    counts.set(st, (counts.get(st) ?? 0) + 1);
  });
  return counts;
});

const abnormalCount = computed(() => {
  let n = 0;
  summary.value.forEach((count, status) => {
    if (status !== 'present') n += count;
  });
  return n;
});

/** 已保存的异常条数（纯异常存储：0 = 全勤日） */
const savedCount = ref(0);

async function loadDate(targetDate: string) {
  if (!semesterStore.activeSemesterId) return;
  loading.value = true;
  try {
    const rows = await repo.getAttendanceByDate(semesterStore.activeSemesterId, targetDate);
    savedCount.value = rows.length;

    const map: Record<string, { status: AttendanceStatus; remark?: string }> = {};
    rows.forEach(r => {
      map[r.student_id] = { status: r.status, ...(r.remark ? { remark: r.remark } : {}) };
    });
    statuses.value = map;
    snapshot.value = JSON.stringify(map);
  } finally {
    loading.value = false;
  }
}

function statusOf(studentId: string): AttendanceStatus {
  return statuses.value[studentId]?.status ?? 'present';
}

/** 点选循环：出勤 → 病假 → 事假 → 旷课 → 迟到 → 早退 → 出勤 */
function cycleStatus(studentId: string) {
  if (isArchived.value) return;
  const next = nextAttendanceStatus(statusOf(studentId));
  const cur = statuses.value[studentId] ?? { status: 'present' as AttendanceStatus };
  statuses.value = { ...statuses.value, [studentId]: { ...cur, status: next } };
}

/** 备注抽屉回写 */
function handleRemark(studentId: string, remark: string) {
  const cur = statuses.value[studentId] ?? { status: 'present' as AttendanceStatus };
  statuses.value = { ...statuses.value, [studentId]: { ...cur, ...(remark ? { remark } : {}) } };
}

/** 日期选择器禁用学期范围外 */
function isDateOutOfSemester(ts: number) {
  const key = dayjs(ts).format('YYYY-MM-DD');
  return key < semRange.value.start || key > semRange.value.end;
}

async function handleDateChange(value: string | [string, string] | null) {
  const next = typeof value === 'string' ? value : todayStr();
  if (next === date.value) return;
  if (!(await confirmDiscard())) return;
  date.value = next;
  await loadDate(next);
}

async function handleSave() {
  if (!semesterStore.activeSemesterId || saving.value) return;

  const rows: AttendanceInput[] = roster.value.map(s => {
    const cur = statuses.value[s.id];
    return {
      student_id: s.id,
      status: cur?.status ?? 'present',
      ...(cur?.remark ? { remark: cur.remark } : {})
    };
  });

  saving.value = true;
  try {
    await repo.saveAttendanceForDate(semesterStore.activeSemesterId, date.value, rows);
    savedCount.value = rows.length;
    snapshot.value = JSON.stringify(statuses.value);
    const abnormal = rows.filter(r => r.status !== 'present').length;
    window.$message?.success(
      abnormal ? `已保存 ${date.value} 异常 ${abnormal} 人` : `已保存 ${date.value}：全勤（清除原有异常）`
    );
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

/** 未保存离开确认；返回 false 阻止 */
async function confirmDiscard(): Promise<boolean> {
  if (!isDirty.value) return true;
  return new Promise(resolve => {
    window.$dialog?.warning({
      title: '有未保存的修改',
      content: '当前考勤尚未保存，离开将丢失修改。确定离开吗？',
      positiveText: '离开',
      negativeText: '留下',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false)
    });
  });
}

onBeforeRouteLeave(async () => confirmDiscard());

function beforeunload(e: BeforeUnloadEvent) {
  if (!isDirty.value) return;
  e.preventDefault();
}

watch(
  () => semesterStore.activeSemesterId,
  async (next, prev) => {
    if (next && next !== prev) {
      // 学期切换视为新页面上下文；脏修改直接放弃（顶部学期切换本身有明确动作语义）
      date.value = clampToSemester(date.value);
      await loadDate(date.value);
    }
  }
);

onMounted(async () => {
  await semesterStore.initSemesters();
  if (semesterStore.activeSemesterId) {
    await studentStore.loadStudents(semesterStore.activeSemesterId);
    await loadDate(date.value);
  }
  window.addEventListener('beforeunload', beforeunload);
});

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeunload);
});
</script>

<template>
  <div>
    <div class="mb-16px flex flex-wrap items-center gap-12px">
      <div class="text-18px font-medium">考勤录入</div>
      <NTag size="small" :bordered="false" :type="savedCount > 0 ? 'warning' : 'success'">
        {{ savedCount > 0 ? `已存异常 ${savedCount} 人` : '全勤（无异常记录）' }}
      </NTag>
      <NTag v-if="isDirty" size="small" type="warning" :bordered="false">未保存</NTag>
      <NTag v-if="isArchived" size="small" type="warning" :bordered="false">学期已归档，只读</NTag>

      <div class="ml-auto flex items-center gap-12px">
        <NDatePicker
          :formatted-value="date"
          type="date"
          value-format="yyyy-MM-dd"
          :clearable="false"
          :is-date-disabled="isDateOutOfSemester"
          class="w-160px"
          @update:formatted-value="handleDateChange"
        />
        <NButton @click="drawerShow = true">备注 ({{ abnormalCount }})</NButton>
        <NButton type="primary" :loading="saving" :disabled="isArchived || roster.length === 0" @click="handleSave">
          {{ isDirty ? '保存异常' : savedCount > 0 ? '重存/清除异常' : '全勤无需保存' }}
        </NButton>
      </div>
    </div>

    <!-- 汇总条 -->
    <NSpace :size="12" class="mb-12px">
      <NTag v-for="[status, count] in summary" :key="status" :type="attendanceTagType[status]" :bordered="false">
        {{ attendanceStatusLabel[status] }} {{ count }}
      </NTag>
      <NText v-if="roster.length === 0" depth="3">本学期暂无在读学生，先去学生管理导入名单</NText>
    </NSpace>

    <!-- 学生点选网格：点击循环切换状态，默认全员出勤 -->
    <NSpin :show="loading">
      <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-8px">
        <div
          v-for="s in roster"
          :key="s.id"
          class="att-card flex cursor-pointer items-center justify-between gap-8px rounded-6px border border-[rgba(127,127,127,0.28)] bg-[rgb(var(--container-bg-color))] px-12px py-10px transition-colors hover:border-primary"
          :class="statusOf(s.id) !== 'present' ? 'border-warning' : ''"
          @click="cycleStatus(s.id)"
        >
          <div class="min-w-0">
            <div class="truncate text-15px font-medium">{{ s.name }}</div>
            <div class="truncate text-12px opacity-60">{{ s.student_no }}</div>
          </div>
          <NTag size="small" :type="attendanceTagType[statusOf(s.id)]" :bordered="false">
            {{ attendanceStatusLabel[statusOf(s.id)] }}
          </NTag>
        </div>
      </div>
    </NSpin>

    <div class="mt-12px text-13px opacity-60">
      点击卡片循环切换：出勤 → 病假 → 事假 → 旷课 → 迟到 → 早退 →
      出勤。默认全员出勤、由教学日历推导——只点异常学生，全勤日无需任何操作。
    </div>

    <RemarkDrawer v-model:show="drawerShow" :roster="roster" :statuses="statuses" @remark="handleRemark" />
  </div>
</template>

<style scoped></style>
