<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import type { DataTableColumns, DataTableSortState } from 'naive-ui';
import { NButton, NTag } from 'naive-ui';
import { useRouterPush } from '@/hooks/common/router';
import { enrollmentStatusLabel, genderLabel } from '@/constants/business';
import { repo } from '@/repo';
import type { StudentInput, StudentWithEnrollment } from '@/repo';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';
import { exportStudents } from '@/utils/excel';
import { printElement } from '@/utils/print';
import StudentModal from './modules/student-modal.vue';
import ImportModal from './modules/import-modal.vue';
import ContextMenu from '@/components/common/context-menu.vue';

defineOptions({
  name: 'Student'
});

const semesterStore = useSemesterStore();
const studentStore = useStudentStore();
const { routerPushByKey } = useRouterPush();

const keyword = ref('');
const statusFilter = ref<'all' | 'active' | 'transferred_out'>('all');
const modalShow = ref(false);
const editingStudent = ref<StudentWithEnrollment | null>(null);
const saving = ref(false);
const importShow = ref(false);

/** 行右键菜单：详情 / 编辑 / 删除 */
const menuRow = ref<StudentWithEnrollment | null>(null);
const rowMenuRef = ref<InstanceType<typeof ContextMenu> | null>(null);
const rowMenuOptions = [
  { label: '详情', key: 'detail' },
  { label: '编辑', key: 'edit' },
  { label: '删除', key: 'delete' }
];

function handleRowMenu(key: string | number) {
  const row = menuRow.value;
  if (!row) return;
  if (key === 'detail') {
    handleDetail(row);
  } else if (key === 'edit') {
    handleEdit(row);
  } else if (key === 'delete') {
    handleDelete(row);
  }
}

function rowProps(row: StudentWithEnrollment) {
  return {
    onContextmenu: (e: MouseEvent) => {
      e.preventDefault(); // 阻止系统右键菜单（编程式 open 不经过组件的 .prevent 修饰符）
      menuRow.value = row;
      rowMenuRef.value?.open(e);
    }
  };
}

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
  { title: '学号', key: 'student_no', width: 110, sorter: 'default' },
  { title: '姓名', key: 'name', sorter: 'default' },
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
  { title: '家长电话', key: 'parent_contact', render: row => row.parent_contact || '—' },
  {
    title: '出生日期',
    key: 'birth_date',
    render: row => row.birth_date || '—'
  },
  { title: '备注', key: 'notes', ellipsis: { tooltip: true }, render: row => row.notes || '—' }
];

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '在读', value: 'active' },
  { label: '转出', value: 'transferred_out' }
];

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

function handleDetail(row: StudentWithEnrollment) {
  return routerPushByKey('student-detail', { params: { id: row.id } });
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
  const detail = `将删除「${row.name}」及其 ${counts.enrollments} 条名册、${counts.attendance} 条考勤、${counts.scores} 条成绩、${counts.discipline} 条德育记录，值日参与一并移除，且不可恢复。`;
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

/** 打印点名表：学号/姓名 + 空白签到列（点名/收作业通用） */
function handlePrintRoster() {
  const rows = filteredStudents.value
    .map(s => `<tr><td>${s.student_no}</td><td>${s.name}</td><td></td><td></td></tr>`)
    .join('');
  const html = `<table><thead><tr><th>学号</th><th>姓名</th><th>上午</th><th>下午</th></tr></thead><tbody>${rows}</tbody></table>`;
  const host = document.getElementById('__print_host__');
  if (host) host.remove();
  const div = document.createElement('div');
  div.id = '__print_host__';
  div.innerHTML =
    `<h1 class="print-title">点名表 · ${semesterStore.activeSemester?.name ?? ''}（${filteredStudents.value.length} 人）</h1>` +
    html;
  document.body.appendChild(div);
  document.body.classList.add('printing');
  window.print();
  window.setTimeout(() => {
    document.body.classList.remove('printing');
    div.remove();
  }, 300);
}

function handleExport() {
  exportStudents(filteredStudents.value);
  window.$message?.success(`已导出 ${filteredStudents.value.length} 条`);
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
          <NButton :disabled="filteredStudents.length === 0" @click="handlePrintRoster">打印点名表</NButton>
          <NButton type="primary" @click="handleAdd">新增学生</NButton>
          <NTooltip placement="bottom">
            <template #trigger>
              <NButton quaternary size="small">行操作？</NButton>
            </template>
            右键学生行：详情 / 编辑 / 删除
          </NTooltip>
        </div>
      </div>
      <NDataTable
        :columns="columns"
        :data="filteredStudents"
        :loading="studentStore.loading"
        :row-key="(row: StudentWithEnrollment) => row.id"
        :row-props="rowProps"
        :max-height="560"
        @update:sorter="handleSorterChange"
      />
      <ContextMenu ref="rowMenuRef" :options="rowMenuOptions" @select="handleRowMenu" />
    </NCard>
    <StudentModal v-model:show="modalShow" :student="editingStudent" :saving="saving" @save="handleSave" />
    <ImportModal v-model:show="importShow" :semester-id="semesterStore.activeSemesterId ?? ''" @refreshed="refresh" />
  </NSpace>
</template>

<style scoped></style>
