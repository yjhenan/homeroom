<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { UploadFileInfo } from 'naive-ui';
import { repo } from '@/repo';
import type { ImportConflictStrategy, ImportResult, StudentInput } from '@/repo';
import { downloadStudentTemplate, parseStudentFile } from '@/utils/excel';
import type { RowError } from '@/utils/excel';

defineOptions({
  name: 'StudentImportModal'
});

const props = defineProps<{
  show: boolean;
  semesterId: string;
}>();

const emit = defineEmits<{
  'update:show': [value: boolean];
  /** 导入成功后刷新列表 */
  refreshed: [];
}>();

type Stage = 'pick' | 'errors' | 'confirm' | 'done';

const stage = ref<Stage>('pick');
const fileName = ref('');
const parsedRows = ref<StudentInput[]>([]);
const rowErrors = ref<RowError[]>([]);
const conflictCount = ref(0);
const strategy = ref<ImportConflictStrategy>('overwrite');
const importing = ref(false);
const importResult = ref<ImportResult | null>(null);

const newCount = computed(() => parsedRows.value.length - conflictCount.value);

watch(
  () => props.show,
  show => {
    if (!show) return;
    reset();
  }
);

function reset() {
  stage.value = 'pick';
  fileName.value = '';
  parsedRows.value = [];
  rowErrors.value = [];
  conflictCount.value = 0;
  strategy.value = 'overwrite';
  importing.value = false;
  importResult.value = null;
}

function handleClose() {
  emit('update:show', false);
}

function handleTemplate() {
  downloadStudentTemplate();
}

async function handleFileChange(options: { fileList: UploadFileInfo[] }) {
  const file = options.fileList[0]?.file;
  if (!file) return;

  reset();
  fileName.value = file.name;

  const { rows, errors } = await parseStudentFile(file);

  if (errors.length > 0) {
    rowErrors.value = errors;
    stage.value = 'errors';
    return;
  }

  parsedRows.value = rows;

  // 与库内学号比对（含其他学期学生）
  const existing = await repo.listStudents();
  const existingNos = new Set(existing.map(s => s.student_no));
  conflictCount.value = rows.filter(r => existingNos.has(r.student_no)).length;

  stage.value = 'confirm';
}

async function handleImport() {
  importing.value = true;
  try {
    const result = await repo.importStudents(parsedRows.value, props.semesterId, strategy.value);
    importResult.value = result;
    stage.value = 'done';
    emit('refreshed');
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '导入失败');
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    title="导入学生名单"
    class="w-560px"
    :mask-closable="false"
    @update:show="handleClose"
  >
    <!-- 第 1 步：选择文件 -->
    <template v-if="stage === 'pick'">
      <NAlert type="info" :bordered="false" class="mb-12px">
        先下载模板，把名单粘贴进去再上传。表头：
        <b>学号*、姓名*、性别、出生日期、家长电话、住址、备注</b>
      </NAlert>
      <NUpload accept=".xlsx,.xls" :max="1" :default-upload="false" :show-file-list="false" @change="handleFileChange">
        <NButton type="primary">选择 Excel 文件</NButton>
      </NUpload>
      <NButton quaternary type="primary" class="mt-12px" @click="handleTemplate">下载空白模板</NButton>
    </template>

    <!-- 第 2 步：行级校验错误，一次列全 -->
    <template v-else-if="stage === 'errors'">
      <NAlert type="error" :bordered="false" class="mb-12px">
        {{ fileName }} 有 {{ rowErrors.length }} 处问题，全部列出如下。修正后重新上传。
      </NAlert>
      <div class="max-h-320px overflow-auto rounded-4px bg-[rgb(18,22,33)] p-8px">
        <div v-for="e in rowErrors" :key="`${e.row}-${e.message}`" class="py-2px">
          <NTag size="small" type="error" :bordered="false" class="mr-8px">第 {{ e.row }} 行</NTag>
          <span>{{ e.message }}</span>
        </div>
      </div>
      <div class="mt-12px flex justify-end gap-12px">
        <NButton @click="reset">重新选择文件</NButton>
      </div>
    </template>

    <!-- 第 3 步：确认导入 -->
    <template v-else-if="stage === 'confirm'">
      <div class="mb-12px">
        文件
        <b>{{ fileName }}</b>
        解析完成，共
        <b>{{ parsedRows.length }}</b>
        行有效数据：
      </div>
      <NSpace :size="24" class="mb-12px">
        <span>
          新增
          <b class="text-primary">{{ newCount }}</b>
          人
        </span>
        <span v-if="conflictCount > 0">
          学号已存在
          <b class="text-warning">{{ conflictCount }}</b>
          人
        </span>
      </NSpace>
      <NFormItem v-if="conflictCount > 0" label="已存在学生处理方式" label-placement="left">
        <NRadioGroup v-model:value="strategy">
          <NRadio value="overwrite">覆盖更新（用表内信息更新学生资料）</NRadio>
          <NRadio value="skip">跳过（保留库内资料）</NRadio>
        </NRadioGroup>
      </NFormItem>
      <NAlert v-if="conflictCount > 0 && strategy === 'overwrite'" type="warning" :bordered="false">
        覆盖只更新学生资料（姓名/性别/出生日期/电话/住址/备注），学号不变。
      </NAlert>
      <div class="mt-16px flex justify-end gap-12px">
        <NButton @click="reset">重新选择文件</NButton>
        <NButton type="primary" :loading="importing" :disabled="parsedRows.length === 0" @click="handleImport">
          开始导入
        </NButton>
      </div>
    </template>

    <!-- 第 4 步：完成 -->
    <template v-else>
      <NResult
        status="success"
        title="导入完成"
        :description="`新增 ${importResult?.created ?? 0} 人，更新 ${importResult?.updated ?? 0} 人，跳过 ${importResult?.skipped ?? 0} 人`"
      />
      <div class="flex justify-end">
        <NButton type="primary" @click="handleClose">关闭</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped></style>
