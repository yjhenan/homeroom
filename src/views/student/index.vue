<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import type { DataTableColumns, DataTableSortState } from 'naive-ui';
import { NButton, NTag } from 'naive-ui';
import { enrollmentStatusLabel, genderLabel } from '@/constants/business';
import { repo } from '@/repo';
import type { StudentInput, StudentWithEnrollment } from '@/repo';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';
import { downloadBackup, readBackupFile } from '@/utils/backup';
import { exportStudents } from '@/utils/excel';
import StudentModal from './modules/student-modal.vue';
import ImportModal from './modules/import-modal.vue';

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
const importShow = ref(false);
const backupInputRef = ref<HTMLInputElement | null>(null);

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

const backupOptions = [
  { label: 'JSON 备份导出', key: 'export' },
  { label: 'JSON 备份导入', key: 'import' }
];

function handleBackupSelect(key: string | number) {
  if (key === 'export') {
    handleBackupExport();
  } else if (key === 'import') {
    handleBackupImportClick();
  }
}

async function refresh() {
  if (semesterStore.activeSemesterId) {
    await studentStore.loadStudents(semesterStore.activeSemesterId);
  }
}

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

function handleExport() {
  exportStudents(filteredStudents.value);
  window.$message?.success(`已导出 ${filteredStudents.value.length} 条`);
}

async function handleBackupExport() {
  const data = await repo.exportAll();
  downloadBackup(data);
  await repo.setSetting('lastBackupAt', data.exportedAt);
  window.$message?.success('备份已下载');
}

function handleBackupImportClick() {
  backupInputRef.value?.click();
}

async function handleBackupImportChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  let data;
  try {
    data = await readBackupFile(file);
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '备份文件读取失败');
    return;
  }

  window.$dialog?.warning({
    title: '导入备份将覆盖全部数据',
    content: '确认后会先自动下载一份当前数据作留底，然后用备份文件内容整体替换。是否继续？',
    positiveText: '备份并导入',
    negativeText: '取消',
    onPositiveClick: async () => {
      // 硬规则：导入前强制先导出当前数据
      const current = await repo.exportAll();
      downloadBackup(current);
      await repo.importAll(data);
      await semesterStore.initSemesters();
      if (semesterStore.activeSemesterId) {
        await studentStore.loadStudents(semesterStore.activeSemesterId);
      }
      window.$message?.success('备份已导入');
    }
  });
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
          <NButton @click="importShow = true">导入</NButton>
          <NButton :disabled="filteredStudents.length === 0" @click="handleExport">导出</NButton>
          <NDropdown :options="backupOptions" @select="handleBackupSelect">
            <NButton>数据</NButton>
          </NDropdown>
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
    <ImportModal v-model:show="importShow" :semester-id="semesterStore.activeSemesterId ?? ''" @refreshed="refresh" />
    <input ref="backupInputRef" type="file" accept=".json" class="hidden" @change="handleBackupImportChange" />
  </NSpace>
</template>

<style scoped></style>
