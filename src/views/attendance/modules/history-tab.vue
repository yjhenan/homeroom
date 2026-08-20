<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import type { DataTableColumns } from 'naive-ui';
import { NTag } from 'naive-ui';
import { attendanceStatusLabel, attendanceTagType } from '@/constants/business';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';
import { repo } from '@/repo';
import type { Attendance, AttendanceStatus } from '@/repo';

defineOptions({
  name: 'AttendanceHistory'
});

const props = defineProps<{
  /** 360 视图单人模式：锁定学生并隐藏筛选器 */
  studentId?: string;
}>();

const semesterStore = useSemesterStore();
const studentStore = useStudentStore();

const toDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 默认查整个学期（当前真实日期可能早于学期开始，取"至今"会出现 from>to 空集） */
const defaultRange = (): [string, string] => {
  const sem = semesterStore.activeSemester;
  const today = toDay(new Date());
  return [sem?.start_date ?? today, sem?.end_date ?? today];
};

const range = ref<[string, string] | null>(defaultRange());
const studentFilter = ref<string | null>(props.studentId ?? null);
const statusFilter = ref<AttendanceStatus[] | null>(null);
const loading = ref(false);
const records = ref<Attendance[]>([]);

const studentOptions = computed(() =>
  studentStore.students.map(s => ({ label: `${s.name}（${s.student_no}）`, value: s.id }))
);

const statusOptions = (Object.keys(attendanceStatusLabel) as AttendanceStatus[]).map(value => ({
  label: attendanceStatusLabel[value],
  value
}));

/** 学号/姓名回查（学生可能已删除或转出） */
const studentNameMap = computed(() => {
  const map = new Map<string, Studentish>();
  studentStore.students.forEach(s => map.set(s.id, { name: s.name, no: s.student_no }));
  return map;
});

interface Studentish {
  name: string;
  no: string;
}

interface HistoryRow extends Attendance {
  student_name: string;
  student_no: string;
}

const rows = computed<HistoryRow[]>(() =>
  records.value.map(r => {
    const stu = studentNameMap.value.get(r.student_id);
    return { ...r, student_name: stu?.name ?? '（已删除）', student_no: stu?.no ?? '—' };
  })
);

const columns: DataTableColumns<HistoryRow> = [
  { title: '日期', key: 'date', width: 110 },
  {
    title: '学生',
    key: 'student_name',
    width: 160,
    render: row => `${row.student_name}（${row.student_no}）`
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: row =>
      h(
        NTag,
        { size: 'small', type: attendanceTagType[row.status], bordered: false },
        { default: () => attendanceStatusLabel[row.status] }
      )
  },
  { title: '备注', key: 'remark', ellipsis: { tooltip: true }, render: row => row.remark || '—' }
];

async function load() {
  if (!semesterStore.activeSemesterId) return;
  loading.value = true;
  try {
    records.value = await repo.queryAttendance({
      semesterId: semesterStore.activeSemesterId,
      from: range.value?.[0],
      to: range.value?.[1],
      studentId: studentFilter.value ?? undefined,
      statuses: statusFilter.value ?? undefined
    });
  } finally {
    loading.value = false;
  }
}

/** 异常行标橙 */
function rowClass(row: HistoryRow) {
  return row.status !== 'present' ? 'row-abnormal' : '';
}

watch([range, studentFilter, statusFilter], () => load());
watch(
  () => semesterStore.activeSemesterId,
  () => {
    range.value = defaultRange();
    load();
  }
);

onMounted(async () => {
  await semesterStore.initSemesters();
  if (semesterStore.activeSemesterId) {
    await studentStore.loadStudents(semesterStore.activeSemesterId);
    await load();
  }
});
</script>

<template>
  <div class="mb-16px flex flex-wrap items-center gap-12px">
    <template v-if="!props.studentId">
      <NDatePicker
        v-model:formatted-value="range"
        type="daterange"
        value-format="yyyy-MM-dd"
        clearable
        class="w-260px"
      />
      <NSelect
        v-model:value="studentFilter"
        :options="studentOptions"
        placeholder="全部学生"
        clearable
        filterable
        class="w-180px"
      />
      <NSelect
        v-model:value="statusFilter"
        :options="statusOptions"
        placeholder="全部状态"
        clearable
        multiple
        class="w-180px"
      />
    </template>
    <span v-else class="text-14px opacity-70">仅显示该学生记录</span>
    <span class="ml-auto text-13px opacity-60">
      共 {{ rows.length }} 条，异常 {{ rows.filter(r => r.status !== 'present').length }} 条
    </span>
  </div>
  <NDataTable
    :columns="columns"
    :data="rows"
    :loading="loading"
    :row-key="(r: HistoryRow) => r.id"
    :row-class-name="rowClass"
    :max-height="520"
    :pagination="{ pageSize: 50 }"
  />
</template>

<style scoped>
:deep(.row-abnormal) {
  --uno: bg-[rgb(64, 50, 32)];
}
</style>
