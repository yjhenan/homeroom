<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import type { DataTableColumns, DataTableSortState } from 'naive-ui';
import { NButton, NTag } from 'naive-ui';
import { enrollmentStatusLabel, genderLabel } from '@/constants/business';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';
import type { StudentInput, StudentWithEnrollment } from '@/repo';
import StudentModal from './modules/student-modal.vue';

defineOptions({
  name: 'Student'
});

const semesterStore = useSemesterStore();
const studentStore = useStudentStore();

const keyword = ref('');
const statusFilter = ref<'all' | 'active' | 'transferred_out'>('all');
const modalShow = ref(false);
const editingStudent = ref<StudentWithEnrollment | null>(null);
const saving = ref(false);

const semesterName = computed(() => semesterStore.activeSemester?.name ?? '');

/** 搜索（姓名/学号模糊）+ 状态筛选，客户端全内存处理 */
const filteredStudents = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return studentStore.students.filter(s => {
    if (statusFilter.value !== 'all' && s.enrollment?.status !== statusFilter.value) return false;
    if (!kw) return true;
    return s.name.toLowerCase().includes(kw) || s.student_no.toLowerCase().includes(kw);
  });
});

const columns: DataTableColumns<StudentWithEnrollment> = [
  { title: '学号', key: 'student_no', width: 120, sorter: 'default' },
  { title: '姓名', key: 'name', width: 120, sorter: 'default' },
  {
    title: '性别',
    key: 'gender',
    width: 80,
    render: row => genderLabel[row.gender]
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: row => {
      const status = row.enrollment?.status;
      if (!status) return '—';
      return h(
        NTag,
        { size: 'small', type: status === 'active' ? 'success' : 'warning', bordered: false },
        { default: () => enrollmentStatusLabel[status] }
      );
    }
  },
  { title: '家长电话', key: 'parent_contact', width: 140, render: row => row.parent_contact || '—' },
  {
    title: '出生日期',
    key: 'birth_date',
    width: 120,
    render: row => row.birth_date || '—'
  },
  { title: '备注', key: 'notes', ellipsis: { tooltip: true }, render: row => row.notes || '—' },
  {
    title: '操作',
    key: 'actions',
    width: 130,
    align: 'center',
    render: row =>
      h('div', { class: 'flex justify-center gap-8px' }, [
        h(
          NButton,
          { size: 'small', quaternary: true, type: 'primary', onClick: () => handleEdit(row) },
          { default: () => '编辑' }
        ),
        h(
          NButton,
          { size: 'small', quaternary: true, type: 'error', onClick: () => handleDelete(row) },
          { default: () => '删除' }
        )
      ])
  }
];

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '在读', value: 'active' },
  { label: '转出', value: 'transferred_out' }
];

onMounted(async () => {
  await semesterStore.initSemesters();
  if (semesterStore.activeSemesterId) {
    await studentStore.loadStudents(semesterStore.activeSemesterId);
  }
});

function handleAdd() {
  editingStudent.value = null;
  modalShow.value = true;
}

function handleEdit(row: StudentWithEnrollment) {
  editingStudent.value = row;
  modalShow.value = true;
}

async function handleSave(input: StudentInput) {
  if (!semesterStore.activeSemesterId) return;
  saving.value = true;
  try {
    if (editingStudent.value) {
      await studentStore.updateStudent(editingStudent.value.id, input, semesterStore.activeSemesterId);
      window.$message?.success('已保存');
    } else {
      await studentStore.createStudent(input, semesterStore.activeSemesterId);
      window.$message?.success('已新增');
    }
    modalShow.value = false;
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function handleDelete(row: StudentWithEnrollment) {
  const counts = await studentStore.countRecords(row.id);
  const detail = `将删除「${row.name}」及其 ${counts.enrollments} 条名册记录，历史考勤、成绩等数据将一并丢失且不可恢复。`;
  window.$dialog?.warning({
    title: '确认删除学生',
    content: detail,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      if (!semesterStore.activeSemesterId) return;
      try {
        await studentStore.removeStudent(row.id, semesterStore.activeSemesterId);
        window.$message?.success('已删除');
      } catch (err) {
        window.$message?.error(err instanceof Error ? err.message : '删除失败');
      }
    }
  });
}

function handleSorterChange(_states: DataTableSortState[] | DataTableSortState | null) {
  // NDataTable 自带客户端排序，这里仅占位避免受控告警
}
</script>

<template>
  <NSpace vertical :size="16">
    <NCard :bordered="false" class="card-wrapper">
      <div class="mb-16px flex flex-wrap items-center gap-12px">
        <div class="text-18px font-medium">学生名单</div>
        <NTag size="small" :bordered="false" type="info">{{ semesterName }}</NTag>
        <div class="ml-auto flex items-center gap-12px">
          <NInput v-model:value="keyword" placeholder="姓名 / 学号搜索" clearable class="w-200px" />
          <NSelect v-model:value="statusFilter" :options="statusOptions" class="w-120px" />
          <NButton type="primary" @click="handleAdd">新增学生</NButton>
        </div>
      </div>
      <NDataTable
        :columns="columns"
        :data="filteredStudents"
        :loading="studentStore.loading"
        :row-key="(row: StudentWithEnrollment) => row.id"
        :max-height="560"
        @update:sorter="handleSorterChange"
      />
    </NCard>
    <StudentModal v-model:show="modalShow" :student="editingStudent" :saving="saving" @save="handleSave" />
  </NSpace>
</template>

<style scoped></style>
