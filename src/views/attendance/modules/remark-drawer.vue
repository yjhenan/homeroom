<script setup lang="ts">
import { computed } from 'vue';
import { attendanceStatusLabel, attendanceTagType } from '@/constants/business';
import type { AttendanceStatus, StudentWithEnrollment } from '@/repo';

defineOptions({
  name: 'AttendanceRemarkDrawer'
});

interface StatusEntry {
  status: AttendanceStatus;
  remark?: string;
}

const props = defineProps<{
  show: boolean;
  roster: StudentWithEnrollment[];
  statuses: Record<string, StatusEntry>;
}>();

const emit = defineEmits<{
  'update:show': [value: boolean];
  /** 备注变更实时回写 */
  remark: [studentId: string, remark: string];
}>();

/** 只列异常（或有备注）的学生 */
const items = computed(() =>
  props.roster.filter(s => {
    const entry = props.statuses[s.id];
    return entry && (entry.status !== 'present' || entry.remark);
  })
);

function handleClose() {
  emit('update:show', false);
}

function handleInput(studentId: string, value: string) {
  emit('remark', studentId, value);
}
</script>

<template>
  <NDrawer :show="props.show" :width="340" @update:show="handleClose">
    <NDrawerContent title="异常备注" closable>
      <NEmpty v-if="items.length === 0" description="当前没有异常考勤" class="mt-48px" />
      <div v-for="s in items" :key="s.id" class="mb-16px">
        <div class="mb-4px flex items-center gap-8px">
          <span class="font-medium">{{ s.name }}</span>
          <NTag size="small" :type="attendanceTagType[props.statuses[s.id]?.status ?? 'present']" :bordered="false">
            {{ attendanceStatusLabel[props.statuses[s.id]?.status ?? 'present'] }}
          </NTag>
        </div>
        <NInput
          :value="props.statuses[s.id]?.remark ?? ''"
          size="small"
          placeholder="备注，如：发烧家长已请假"
          @update:value="(v: string) => handleInput(s.id, v)"
        />
      </div>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped></style>
