<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { FormInst, FormRules } from 'naive-ui';
import { genderOptions } from '@/constants/business';
import type { Student, StudentInput, StudentWithEnrollment } from '@/repo';

defineOptions({
  name: 'StudentModal'
});

const props = defineProps<{
  show: boolean;
  /** 编辑时传入；新增为 null */
  student: StudentWithEnrollment | null;
  /** 保存中（按钮 loading） */
  saving?: boolean;
}>();

const emit = defineEmits<{
  'update:show': [value: boolean];
  /** 提交表单（值为 DTO 入参） */
  save: [input: StudentInput];
}>();

const formRef = ref<FormInst | null>(null);

interface FormState {
  name: string;
  student_no: string;
  gender: Student['gender'];
  birth_date: string | null;
  parent_contact: string;
  address: string;
  notes: string;
}

const blankForm = (): FormState => ({
  name: '',
  student_no: '',
  gender: 'unknown',
  birth_date: null,
  parent_contact: '',
  address: '',
  notes: ''
});

const form = reactive<FormState>(blankForm());

const isEdit = computed(() => Boolean(props.student));

const title = computed(() => (isEdit.value ? '编辑学生' : '新增学生'));

const rules: FormRules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  student_no: [
    { required: true, message: '请输入学号', trigger: 'blur' },
    { pattern: /^\S+$/, message: '学号不能含空格', trigger: 'blur' }
  ],
  parent_contact: [{ pattern: /^[\d\-+ ]*$/, message: '电话仅支持数字与 + - 空格', trigger: 'blur' }]
};

watch(
  () => props.show,
  show => {
    if (!show) return;
    const src = props.student;
    Object.assign(form, blankForm(), {
      name: src?.name ?? '',
      student_no: src?.student_no ?? '',
      gender: src?.gender ?? 'unknown',
      birth_date: src?.birth_date ?? null,
      parent_contact: src?.parent_contact ?? '',
      address: src?.address ?? '',
      notes: src?.notes ?? ''
    });
    formRef.value?.restoreValidation();
  }
);

function handleClose() {
  emit('update:show', false);
}

async function handleSave() {
  await formRef.value?.validate();
  emit('save', {
    name: form.name,
    student_no: form.student_no,
    gender: form.gender,
    birth_date: form.birth_date || undefined,
    parent_contact: form.parent_contact || undefined,
    address: form.address || undefined,
    notes: form.notes || undefined
  });
}
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    :title="title"
    class="w-520px"
    :mask-closable="false"
    @update:show="handleClose"
  >
    <NForm
      ref="formRef"
      :model="form"
      :rules="rules"
      label-placement="left"
      label-width="86"
      require-mark-placement="right-hanging"
    >
      <NFormItem label="学号" path="student_no">
        <NInput v-model:value="form.student_no" placeholder="如 2026001" :disabled="isEdit" />
      </NFormItem>
      <NFormItem label="姓名" path="name">
        <NInput v-model:value="form.name" placeholder="必填" />
      </NFormItem>
      <NFormItem label="性别" path="gender">
        <NRadioGroup v-model:value="form.gender">
          <NRadio v-for="opt in genderOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</NRadio>
        </NRadioGroup>
      </NFormItem>
      <NFormItem label="出生日期" path="birth_date">
        <NDatePicker
          v-model:formatted-value="form.birth_date"
          type="date"
          value-format="yyyy-MM-dd"
          clearable
          class="w-full"
        />
      </NFormItem>
      <NFormItem label="家长电话" path="parent_contact">
        <NInput v-model:value="form.parent_contact" placeholder="选填" />
      </NFormItem>
      <NFormItem label="住址" path="address">
        <NInput v-model:value="form.address" placeholder="选填" />
      </NFormItem>
      <NFormItem label="备注" path="notes">
        <NInput v-model:value="form.notes" type="textarea" :rows="2" placeholder="选填" />
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
