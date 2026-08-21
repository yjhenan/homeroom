<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import type { DataTableColumns, FormInst, FormRules } from 'naive-ui';
import { NButton, NTag } from 'naive-ui';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';
import { repo } from '@/repo';
import { todayStr } from '@/utils/date';
import { downloadBackup, readBackupFile } from '@/utils/backup';

defineOptions({
  name: 'Setting'
});

const semesterStore = useSemesterStore();
const studentStore = useStudentStore();

const loading = ref(false);

// ---- 学期管理 ----
const columns: DataTableColumns<import('@/repo').Semester> = [
  { title: '学期', key: 'name' },
  { title: '起止', key: 'range', render: row => `${row.start_date} ~ ${row.end_date}` },
  {
    title: '状态',
    key: 'status',
    width: 150,
    render: row =>
      h('div', { class: 'flex items-center gap-4px' }, [
        row.is_active ? h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => '当前' }) : null,
        row.archived ? h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => '已归档' }) : null,
        !row.is_active && !row.archived ? h('span', { class: 'opacity-60' }, '—') : null
      ])
  },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    align: 'center',
    render: row =>
      h('div', { class: 'flex justify-center gap-8px' }, [
        row.is_active
          ? null
          : h(
              NButton,
              { size: 'small', quaternary: true, type: 'primary', onClick: () => handleSwitch(row) },
              { default: () => '切换为当前' }
            ),
        row.archived
          ? h(
              NButton,
              {
                size: 'small',
                quaternary: true,
                onClick: () => handleArchive(row, false)
              },
              { default: () => '取消归档' }
            )
          : h(
              NButton,
              {
                size: 'small',
                quaternary: true,
                type: 'warning',
                disabled: row.is_active,
                onClick: () => handleArchive(row, true)
              },
              { default: () => '归档' }
            )
      ])
  }
];

async function load() {
  loading.value = true;
  try {
    await semesterStore.refreshSemesters();
  } finally {
    loading.value = false;
  }
}

async function refreshSemesters() {
  await semesterStore.refreshSemesters();
}

async function handleSwitch(row: import('@/repo').Semester) {
  try {
    await semesterStore.switchSemester(row.id);
    window.$message?.success(`已切换到 ${row.name}`);
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '切换失败');
  }
}

function handleArchive(row: import('@/repo').Semester, archived: boolean) {
  window.$dialog?.warning({
    title: archived ? '归档学期' : '取消归档',
    content: archived
      ? `归档后「${row.name}」的全部数据变为只读（可查看不可编辑）。确认归档？`
      : `恢复「${row.name}」为可编辑状态？`,
    positiveText: archived ? '归档' : '恢复',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await repo.setSemesterArchived(row.id, archived);
        await refreshSemesters();
        window.$message?.success(archived ? '已归档' : '已恢复');
      } catch (err) {
        window.$message?.error(err instanceof Error ? err.message : '操作失败');
      }
    }
  });
}

// ---- 新建学期 ----
const modalShow = ref(false);
const saving = ref(false);
const formRef = ref<FormInst | null>(null);

const form = ref({
  id: '',
  name: '',
  start_date: null as string | null,
  end_date: null as string | null,
  copyFrom: null as string | null
});

const rules: FormRules = {
  id: [
    { required: true, message: '请输入学期编号', trigger: 'blur' },
    { pattern: /^\d{4}-\d{4}-\d$/, message: '格式如 2026-2027-2', trigger: 'blur' }
  ],
  name: [{ required: true, message: '请输入学期名称', trigger: 'blur' }],
  start_date: [{ required: true, message: '请选择开始日期', trigger: ['blur', 'change'] }],
  end_date: [{ required: true, message: '请选择结束日期', trigger: ['blur', 'change'] }]
};

const copyOptions = computed(() =>
  semesterStore.semesters
    .filter(s => s.id !== form.value.id)
    .map(s => ({ label: `${s.name}（在读名册）`, value: s.id }))
);

function openCreate() {
  form.value = { id: '', name: '', start_date: null, end_date: null, copyFrom: null };
  modalShow.value = true;
}

async function handleCreate() {
  await formRef.value?.validate();
  if (saving.value) return;
  if (!form.value.start_date || !form.value.end_date) return;
  saving.value = true;
  try {
    await repo.createSemester({
      id: form.value.id.trim(),
      name: form.value.name.trim(),
      start_date: form.value.start_date,
      end_date: form.value.end_date
    });
    let copied = 0;
    if (form.value.copyFrom) {
      copied = await repo.copyRoster(form.value.copyFrom, form.value.id.trim());
    }
    // 新学期建完刷新列表并切过去（教学节奏：新建通常为了开始使用）
    await semesterStore.switchSemester(form.value.id.trim());
    await refreshSemesters();
    window.$message?.success(`已新建${copied ? `（复制名册 ${copied} 人）` : ''}`);
    modalShow.value = false;
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '创建失败');
  } finally {
    saving.value = false;
  }
}

// ---- 数据备份 ----
const backupInputRef = ref<HTMLInputElement | null>(null);

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
      const current = await repo.exportAll();
      downloadBackup(current);
      await repo.importAll(data);
      await refreshSemesters();
      if (semesterStore.activeSemesterId) {
        await studentStore.loadStudents(semesterStore.activeSemesterId);
      }
      window.$message?.success('备份已导入');
    }
  });
}

const lastBackupAt = ref<string | null>(null);

// ---- 假期（当前学期）----
const holidayList = ref<string[]>([]);
const newHoliday = ref<string | null>(null);
const holidaySaving = ref(false);

async function loadHolidays() {
  const sem = semesterStore.activeSemester;
  holidayList.value = [...(sem?.holidays ?? [])];
}

async function addHoliday() {
  const d = newHoliday.value;
  if (!d || holidayList.value.includes(d)) return;
  holidayList.value = [...holidayList.value, d].sort();
  newHoliday.value = null;
  await saveHolidays();
}

async function removeHoliday(d: string) {
  holidayList.value = holidayList.value.filter(x => x !== d);
  await saveHolidays();
}

async function saveHolidays() {
  if (!semesterStore.activeSemesterId) return;
  holidaySaving.value = true;
  try {
    await repo.setSemesterHolidays(semesterStore.activeSemesterId, holidayList.value);
    await refreshSemesters();
    window.$message?.success('假期已更新');
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    holidaySaving.value = false;
  }
}

onMounted(async () => {
  await load();
  lastBackupAt.value = await repo.getSetting<string>('lastBackupAt');
  await loadHolidays();
});
</script>

<template>
  <NSpace vertical :size="16">
    <!-- 学期管理（含当前学期假期） -->
    <NCard :bordered="false" class="card-wrapper" title="学期管理">
      <template #header-extra>
        <NButton size="small" type="primary" @click="openCreate">新建学期</NButton>
      </template>
      <NDataTable
        :columns="columns"
        :data="semesterStore.semesters"
        :loading="loading"
        :row-key="(r: import('@/repo').Semester) => r.id"
        :pagination="false"
      />
      <div class="mt-8px text-13px opacity-60">
        归档后学期全模块只读；新建学期可从已有学期复制在读名册。切换学期用顶栏切换器。
      </div>

      <!-- 假期（当前学期） -->
      <NDivider class="!my-12px">
        <span class="text-14px">当前学期假期</span>
      </NDivider>
      <div class="flex flex-wrap items-center gap-12px">
        <NDatePicker
          v-model:formatted-value="newHoliday"
          type="date"
          value-format="yyyy-MM-dd"
          clearable
          class="w-170px"
        />
        <NButton size="small" :disabled="!newHoliday" :loading="holidaySaving" @click="addHoliday">添加</NButton>
        <NText depth="3" class="text-13px">
          作用于「{{ semesterStore.activeSemester?.name ?? '—' }}」：假期日不计入应出勤工作日
        </NText>
      </div>
      <div v-if="holidayList.length" class="mt-8px flex flex-wrap gap-8px">
        <NTag v-for="d in holidayList" :key="d" closable size="small" @close="removeHoliday(d)">
          {{ d }}
        </NTag>
      </div>
      <NText v-else depth="3" class="mt-8px block text-13px">未设置假期（按周一~周五估算应出勤）</NText>
    </NCard>

    <!-- 数据 -->

    <NCard :bordered="false" class="card-wrapper" title="数据备份">
      <div class="flex flex-wrap items-center gap-12px">
        <NButton @click="handleBackupExport">导出 JSON 备份</NButton>
        <NButton @click="handleBackupImportClick">导入备份（覆盖全部）</NButton>
        <NText depth="3" class="text-13px">
          上次备份：{{ lastBackupAt ? lastBackupAt.replace('T', ' ').slice(0, 19) : '从未备份' }}
        </NText>
      </div>
      <div class="mt-8px text-13px opacity-60">
        备份包含全部学期数据（学生/考勤/成绩/德育/值日/文档），是迁移到桌面版的桥梁。建议每周导出一次。
      </div>
      <input ref="backupInputRef" type="file" accept=".json" class="hidden" @change="handleBackupImportChange" />
    </NCard>

    <!-- 关于 -->
    <NCard :bordered="false" class="card-wrapper" title="关于">
      <div class="text-14px leading-24px opacity-80">
        <p>homeroom 班级管理 · v0.1.0（web 阶段）</p>
        <p>数据保存在本机浏览器 IndexedDB；桌面版（M4）将迁移到 exe 同目录 SQLite。</p>
      </div>
    </NCard>

    <!-- 新建学期弹窗 -->
    <NModal v-model:show="modalShow" preset="card" title="新建学期" class="w-480px" :mask-closable="false">
      <NForm ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="84">
        <NFormItem label="学期编号" path="id">
          <NInput v-model:value="form.id" placeholder="如 2026-2027-2" />
        </NFormItem>
        <NFormItem label="学期名称" path="name">
          <NInput v-model:value="form.name" placeholder="如 2026-2027学年 第二学期" />
        </NFormItem>
        <NFormItem label="开始日期" path="start_date">
          <NDatePicker v-model:formatted-value="form.start_date" type="date" value-format="yyyy-MM-dd" class="w-full" />
        </NFormItem>
        <NFormItem label="结束日期" path="end_date">
          <NDatePicker v-model:formatted-value="form.end_date" type="date" value-format="yyyy-MM-dd" class="w-full" />
        </NFormItem>
        <NFormItem label="复制名册自">
          <NSelect v-model:value="form.copyFrom" :options="copyOptions" placeholder="不复制" clearable class="w-full" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-12px">
          <NButton @click="modalShow = false">取消</NButton>
          <NButton type="primary" :loading="saving" @click="handleCreate">创建并切换</NButton>
        </div>
      </template>
    </NModal>
  </NSpace>
</template>

<style scoped></style>
