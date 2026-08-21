<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import type { DataTableColumns } from 'naive-ui';
import { NButton, NTag } from 'naive-ui';
import { disciplineCategoryOptions, disciplineDirectionLabel } from '@/constants/business';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';
import { repo } from '@/repo';
import type { DisciplineDirection, DisciplineEvent, DisciplineFilter } from '@/repo';

defineOptions({
  name: 'Discipline'
});

const semesterStore = useSemesterStore();
const studentStore = useStudentStore();

const isArchived = computed(() => semesterStore.activeSemester?.archived === true);

// ---- 快速新增 ----
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const form = ref({
  student_ids: [] as string[],
  date: today(),
  direction: 'minus' as DisciplineDirection,
  category: '纪律',
  points: null as number | null,
  description: ''
});
const adding = ref(false);

const studentOptions = computed(() =>
  studentStore.students
    .filter(s => s.enrollment?.status === 'active')
    .map(s => ({ label: `${s.name}（${s.student_no}）`, value: s.id }))
);

async function handleAdd() {
  if (!semesterStore.activeSemesterId || adding.value) return;
  if (form.value.student_ids.length === 0) {
    window.$message?.warning('请选择学生');
    return;
  }
  if (!form.value.description.trim()) {
    window.$message?.warning('请填写描述');
    return;
  }
  adding.value = true;
  try {
    const n = await repo.addDisciplineEvents(
      {
        student_ids: form.value.student_ids,
        date: form.value.date,
        direction: form.value.direction,
        category: form.value.category,
        ...(form.value.points !== null ? { points: form.value.points } : {}),
        description: form.value.description
      },
      semesterStore.activeSemesterId
    );
    window.$message?.success(`已记录 ${n} 条`);
    form.value.description = '';
    form.value.student_ids = [];
    await load();
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    adding.value = false;
  }
}

// ---- 事件流 + 筛选 ----
const filterStudent = ref<string | null>(null);
const filterCategory = ref<string | null>(null);
const filterDirection = ref<DisciplineDirection | null>(null);
const events = ref<DisciplineEvent[]>([]);
const loading = ref(false);

const nameMap = computed(() => new Map(studentStore.students.map(s => [s.id, s])));

interface Row extends DisciplineEvent {
  student_name: string;
  student_no: string;
}

const rows = computed<Row[]>(() =>
  events.value.map(e => {
    const stu = nameMap.value.get(e.student_id);
    return { ...e, student_name: stu?.name ?? '（已删除）', student_no: stu?.student_no ?? '—' };
  })
);

/** 筛选后汇总：加分/扣分/净分 */
const summary = computed(() => {
  let plus = 0;
  let minus = 0;
  rows.value.forEach(e => {
    if (e.points === undefined) return;
    if (e.direction === 'plus') plus += e.points;
    else minus += e.points;
  });
  return { plus, minus, net: plus - minus };
});

const columns: DataTableColumns<Row> = [
  { title: '日期', key: 'date', width: 110 },
  {
    title: '学生',
    key: 'student_name',
    width: 150,
    render: row => `${row.student_name}（${row.student_no}）`
  },
  {
    title: '方向',
    key: 'direction',
    width: 80,
    render: row =>
      h(
        NTag,
        { size: 'small', type: row.direction === 'plus' ? 'success' : 'error', bordered: false },
        { default: () => disciplineDirectionLabel[row.direction] }
      )
  },
  { title: '分类', key: 'category', width: 90 },
  { title: '分值', key: 'points', width: 80, render: row => (row.points === undefined ? '—' : row.points) },
  { title: '描述', key: 'description', ellipsis: { tooltip: true } },
  {
    title: '操作',
    key: 'actions',
    width: 80,
    align: 'center',
    render: row =>
      h(
        NButton,
        {
          size: 'small',
          quaternary: true,
          type: 'error',
          disabled: isArchived.value,
          onClick: () => handleDelete(row)
        },
        { default: () => '删除' }
      )
  }
];

async function load() {
  if (!semesterStore.activeSemesterId) return;
  loading.value = true;
  try {
    const filter: DisciplineFilter = {};
    if (filterStudent.value) filter.studentId = filterStudent.value;
    if (filterCategory.value) filter.category = filterCategory.value;
    if (filterDirection.value) filter.direction = filterDirection.value;
    events.value = await repo.listDisciplineEvents(semesterStore.activeSemesterId, filter);
  } finally {
    loading.value = false;
  }
}

function handleDelete(row: Row) {
  window.$dialog?.warning({
    title: '确认删除',
    content: `删除 ${row.date} ${row.student_name} 的「${row.description}」？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await repo.deleteDisciplineEvent(row.id);
        window.$message?.success('已删除');
        await load();
      } catch (err) {
        window.$message?.error(err instanceof Error ? err.message : '删除失败');
      }
    }
  });
}

watch([filterStudent, filterCategory, filterDirection], () => load());
watch(
  () => semesterStore.activeSemesterId,
  () => {
    filterStudent.value = null;
    filterCategory.value = null;
    filterDirection.value = null;
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
  <NSpace vertical :size="16">
    <!-- 快速新增 -->
    <NCard :bordered="false" class="card-wrapper" title="记一笔">
      <template #header-extra>
        <NTag v-if="isArchived" type="warning" :bordered="false">学期已归档，只读</NTag>
      </template>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-12px">
        <NFormItem label="学生" label-placement="top">
          <NSelect
            v-model:value="form.student_ids"
            :options="studentOptions"
            multiple
            filterable
            placeholder="可多选"
            :disabled="isArchived"
          />
        </NFormItem>
        <NFormItem label="日期" label-placement="top">
          <NDatePicker
            v-model:formatted-value="form.date"
            type="date"
            value-format="yyyy-MM-dd"
            class="w-full"
            :disabled="isArchived"
          />
        </NFormItem>
        <NFormItem label="方向" label-placement="top">
          <NRadioGroup v-model:value="form.direction" :disabled="isArchived">
            <NRadio value="minus">扣分</NRadio>
            <NRadio value="plus">加分</NRadio>
          </NRadioGroup>
        </NFormItem>
        <NFormItem label="分类" label-placement="top">
          <NSelect v-model:value="form.category" :options="disciplineCategoryOptions" :disabled="isArchived" />
        </NFormItem>
        <NFormItem label="分值" label-placement="top">
          <NInputNumber
            v-model:value="form.points"
            :min="0"
            placeholder="可不记分"
            class="w-full"
            :disabled="isArchived"
          />
        </NFormItem>
        <NFormItem label="描述" label-placement="top">
          <NInput
            v-model:value="form.description"
            placeholder="必填，如：课间打闹"
            :disabled="isArchived"
            @keyup.enter="handleAdd"
          />
        </NFormItem>
      </div>
      <div class="flex justify-end">
        <NButton type="primary" :loading="adding" :disabled="isArchived" @click="handleAdd">记一笔</NButton>
      </div>
    </NCard>

    <!-- 事件流 -->
    <NCard :bordered="false" class="card-wrapper">
      <div class="mb-12px flex flex-wrap items-center gap-12px">
        <div class="text-18px font-medium">事件流</div>
        <NSelect
          v-model:value="filterStudent"
          :options="studentOptions"
          placeholder="全部学生"
          clearable
          filterable
          class="w-180px"
        />
        <NSelect
          v-model:value="filterCategory"
          :options="disciplineCategoryOptions"
          placeholder="全部分类"
          clearable
          class="w-130px"
        />
        <NSelect
          :value="filterDirection"
          :options="[
            { label: '加分', value: 'plus' },
            { label: '扣分', value: 'minus' }
          ]"
          placeholder="全部方向"
          clearable
          class="w-120px"
          @update:value="(v: DisciplineDirection | null) => (filterDirection = v)"
        />
        <div class="ml-auto flex items-center gap-16px text-14px">
          <span>
            加分
            <b class="text-success">+{{ summary.plus }}</b>
          </span>
          <span>
            扣分
            <b class="text-error">-{{ summary.minus }}</b>
          </span>
          <span>
            净分
            <b>{{ summary.net >= 0 ? '+' : '' }}{{ summary.net }}</b>
          </span>
        </div>
      </div>
      <NDataTable
        :columns="columns"
        :data="rows"
        :loading="loading"
        :row-key="(r: Row) => r.id"
        :max-height="480"
        :pagination="{ pageSize: 50 }"
      />
    </NCard>
  </NSpace>
</template>

<style scoped></style>
