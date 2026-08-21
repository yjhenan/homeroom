<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import type { FormInst, FormRules } from 'naive-ui';
import { examTypeOptions } from '@/constants/business';
import type { Exam, ExamInput, ExamType } from '@/repo';

defineOptions({
  name: 'ExamModal'
});

const props = defineProps<{
  show: boolean;
  /** 编辑时传入 */
  exam: Exam | null;
  saving?: boolean;
}>();

const emit = defineEmits<{
  'update:show': [value: boolean];
  save: [input: ExamInput];
}>();

const formRef = ref<FormInst | null>(null);

const form = reactive({
  name: '',
  date: null as string | null,
  type: 'midterm' as ExamType
});

const rules: FormRules = {
  name: [{ required: true, message: '请输入考试名称', trigger: 'blur' }],
  date: [{ required: true, message: '请选择日期', trigger: ['blur', 'change'] }]
};

watch(
  () => props.show,
  show => {
    if (!show) return;
    form.name = props.exam?.name ?? '';
    form.date = props.exam?.date ?? null;
    form.type = props.exam?.type ?? 'midterm';
    formRef.value?.restoreValidation();
  }
);

function handleClose() {
  emit('update:show', false);
}

async function handleSave() {
  await formRef.value?.validate();
  if (!form.date) return;
  emit('save', { name: form.name.trim(), date: form.date, type: form.type });
}
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    :title="props.exam ? '编辑考试' : '新建考试'"
    class="w-440px"
    :mask-closable="false"
    @update:show="handleClose"
  >
    <NForm ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="72">
      <NFormItem label="名称" path="name">
        <NInput v-model:value="form.name" placeholder="如期中考试" />
      </NFormItem>
      <NFormItem label="日期" path="date">
        <NDatePicker
          v-model:formatted-value="form.date"
          type="date"
          value-format="yyyy-MM-dd"
          class="w-full"
          clearable
        />
      </NFormItem>
      <NFormItem label="类型" path="type">
        <NSelect v-model:value="form.type" :options="examTypeOptions" />
      </NFormItem>
    </NForm>
    <template #footer>
      <div class="flex justify-end gap-12px">
        <NButton @click="handleClose">取消</NButton>
        <NButton type="primary" :loading="props.saving" @click="handleSave">保存</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped></style>
