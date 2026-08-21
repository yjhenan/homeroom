<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import type { DataTableColumns, UploadFileInfo } from 'naive-ui';
import { NButton, NTag } from 'naive-ui';
import { useSemesterStore } from '@/store/modules/semester';
import { repo } from '@/repo';
import type { DocumentAttachment, DocumentInput, DocumentRecord } from '@/repo';

defineOptions({
  name: 'Document'
});

const semesterStore = useSemesterStore();

const isArchived = computed(() => semesterStore.activeSemester?.archived === true);

const categoryOptions = ['通知', '计划', '总结', '其他'].map(v => ({ label: v, value: v }));

/** 附件大小上限 10MB（base64 前的原始字节） */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const keyword = ref('');
const filterCategory = ref<string | null>(null);
const records = ref<DocumentRecord[]>([]);
const loading = ref(false);

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return records.value.filter(r => {
    if (filterCategory.value && r.category !== filterCategory.value) return false;
    if (!kw) return true;
    return r.title.toLowerCase().includes(kw) || (r.summary ?? '').toLowerCase().includes(kw);
  });
});

const columns: DataTableColumns<DocumentRecord> = [
  { title: '日期', key: 'date', width: 110, sorter: 'default' },
  { title: '标题', key: 'title', ellipsis: { tooltip: true } },
  {
    title: '分类',
    key: 'category',
    width: 90,
    render: row => h(NTag, { size: 'small', bordered: false }, { default: () => row.category })
  },
  { title: '摘要', key: 'summary', ellipsis: { tooltip: true }, render: row => row.summary || '—' },
  {
    title: '附件',
    key: 'attachment',
    width: 160,
    render: row =>
      row.attachment
        ? h(
            NButton,
            { size: 'small', quaternary: true, type: 'primary', onClick: () => downloadAttachment(row) },
            { default: () => `📎 ${row.attachment!.name}` }
          )
        : '—'
  },
  {
    title: '操作',
    key: 'actions',
    width: 130,
    align: 'center',
    render: row =>
      h('div', { class: 'flex justify-center gap-8px' }, [
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: 'primary',
            disabled: isArchived.value,
            onClick: () => handleEdit(row)
          },
          { default: () => '编辑' }
        ),
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
      ])
  }
];

async function load() {
  if (!semesterStore.activeSemesterId) return;
  loading.value = true;
  try {
    records.value = await repo.listDocuments(semesterStore.activeSemesterId);
  } finally {
    loading.value = false;
  }
}

function downloadAttachment(row: DocumentRecord) {
  const att = row.attachment;
  if (!att) return;
  const binary = atob(att.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: att.mime_type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = att.name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- 新增/编辑弹窗 ----
const modalShow = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const form = ref({
  title: '',
  category: '通知',
  date: today(),
  summary: '',
  attachment: null as DocumentAttachment | null,
  /** 编辑时原有附件（未更换则保留） */
  keepAttachment: false
});

function handleAdd() {
  editingId.value = null;
  form.value = { title: '', category: '通知', date: today(), summary: '', attachment: null, keepAttachment: false };
  modalShow.value = true;
}

function handleEdit(row: DocumentRecord) {
  editingId.value = row.id;
  form.value = {
    title: row.title,
    category: row.category,
    date: row.date,
    summary: row.summary ?? '',
    attachment: null,
    keepAttachment: Boolean(row.attachment)
  };
  modalShow.value = true;
}

async function handleFileChange(options: { fileList: UploadFileInfo[] }) {
  const file = options.fileList[0]?.file;
  if (!file) return;
  if (file.size > MAX_ATTACHMENT_BYTES) {
    window.$message?.warning('附件超过 10MB，请压缩后再上传');
    form.value.attachment = null;
    return;
  }
  const buf = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  form.value.attachment = {
    name: file.name,
    mime_type: file.type || 'application/octet-stream',
    data: btoa(binary)
  };
  form.value.keepAttachment = false;
}

function clearAttachment() {
  form.value.attachment = null;
  form.value.keepAttachment = false;
}

const editingRecord = computed(() => records.value.find(r => r.id === editingId.value) ?? null);

async function handleSave() {
  if (!semesterStore.activeSemesterId || saving.value) return;
  if (!form.value.title.trim()) {
    window.$message?.warning('请输入标题');
    return;
  }
  saving.value = true;
  try {
    const input: DocumentInput = {
      title: form.value.title,
      category: form.value.category,
      date: form.value.date,
      ...(form.value.summary.trim() ? { summary: form.value.summary } : {}),
      // 必须浅拷贝成普通对象：ref 里读出的是 Vue reactive Proxy，IndexedDB structured clone 会抛 DataCloneError
      ...(form.value.attachment ? { attachment: { ...form.value.attachment } } : {})
    };

    if (editingId.value) {
      const patch = { ...input } as Parameters<typeof repo.updateDocument>[1];
      if (!form.value.attachment && form.value.keepAttachment) {
        delete patch.attachment; // 保留原附件
      } else if (!form.value.attachment && !form.value.keepAttachment) {
        patch.attachment = null; // 明确清除
      }
      await repo.updateDocument(editingId.value, patch);
      window.$message?.success('已保存');
    } else {
      await repo.createDocument(input, semesterStore.activeSemesterId);
      window.$message?.success('已登记');
    }
    modalShow.value = false;
    await load();
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

function handleDelete(row: DocumentRecord) {
  window.$dialog?.warning({
    title: '确认删除',
    content: `删除「${row.title}」${row.attachment ? '及其附件' : ''}？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await repo.deleteDocument(row.id);
        window.$message?.success('已删除');
        await load();
      } catch (err) {
        window.$message?.error(err instanceof Error ? err.message : '删除失败');
      }
    }
  });
}

watch([keyword, filterCategory], () => undefined); // 客户端过滤，无需重载
watch(
  () => semesterStore.activeSemesterId,
  () => load()
);

onMounted(async () => {
  await semesterStore.initSemesters();
  await load();
});
</script>

<template>
  <NCard :bordered="false" class="card-wrapper">
    <div class="mb-16px flex flex-wrap items-center gap-12px">
      <div class="text-18px font-medium">文档台账</div>
      <NTag v-if="isArchived" type="warning" :bordered="false">学期已归档，只读</NTag>
      <div class="ml-auto flex items-center gap-12px">
        <NInput v-model:value="keyword" placeholder="标题 / 摘要搜索" clearable class="w-200px" />
        <NSelect
          v-model:value="filterCategory"
          :options="categoryOptions"
          placeholder="全部分类"
          clearable
          class="w-120px"
        />
        <NButton type="primary" :disabled="isArchived" @click="handleAdd">登记文档</NButton>
      </div>
    </div>

    <NDataTable
      :columns="columns"
      :data="filtered"
      :loading="loading"
      :row-key="(r: DocumentRecord) => r.id"
      :max-height="520"
      :pagination="{ pageSize: 50 }"
    />

    <NModal
      v-model:show="modalShow"
      preset="card"
      :title="editingId ? '编辑文档' : '登记文档'"
      class="w-520px"
      :mask-closable="false"
    >
      <NForm label-placement="left" label-width="64">
        <NFormItem label="标题" required>
          <NInput v-model:value="form.title" placeholder="必填" />
        </NFormItem>
        <NFormItem label="分类">
          <NSelect v-model:value="form.category" :options="categoryOptions" />
        </NFormItem>
        <NFormItem label="日期" required>
          <NDatePicker v-model:formatted-value="form.date" type="date" value-format="yyyy-MM-dd" class="w-full" />
        </NFormItem>
        <NFormItem label="摘要">
          <NInput v-model:value="form.summary" type="textarea" :rows="3" placeholder="登记内容 / 摘要" />
        </NFormItem>
        <NFormItem label="附件">
          <div class="flex flex-col gap-8px">
            <NUpload
              accept="*"
              :max="1"
              :default-upload="false"
              :show-file-list="false"
              :disabled="isArchived"
              @change="handleFileChange"
            >
              <NButton size="small">选择文件（≤10MB）</NButton>
            </NUpload>
            <div v-if="form.attachment" class="flex items-center gap-8px text-13px">
              <span>📎 {{ form.attachment.name }}</span>
              <NButton text size="tiny" type="error" @click="clearAttachment">移除</NButton>
            </div>
            <NText v-if="editingRecord?.attachment && !form.attachment" depth="3" class="text-13px">
              现有附件：{{ editingRecord.attachment.name }}（保存时保留；重新选择则替换）
            </NText>
          </div>
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-12px">
          <NButton @click="modalShow = false">取消</NButton>
          <NButton type="primary" :loading="saving" @click="handleSave">保存</NButton>
        </div>
      </template>
    </NModal>
  </NCard>
</template>

<style scoped></style>
