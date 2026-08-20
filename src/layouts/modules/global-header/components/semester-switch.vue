<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';

defineOptions({
  name: 'SemesterSwitch'
});

const semesterStore = useSemesterStore();
const studentStore = useStudentStore();

const options = computed(() => semesterStore.semesters.map(s => ({ label: s.name, value: s.id })));

onMounted(async () => {
  await semesterStore.initSemesters();
  if (semesterStore.activeSemesterId) {
    await studentStore.loadStudents(semesterStore.activeSemesterId);
  }
});

async function handleChange(id: string) {
  await semesterStore.switchSemester(id);
  if (semesterStore.activeSemesterId) {
    await studentStore.loadStudents(semesterStore.activeSemesterId);
  }
}
</script>

<template>
  <div v-if="options.length" class="flex-y-center">
    <SvgIcon icon="mdi:school-outline" class="mr-4px text-icon" />
    <NSelect
      :value="semesterStore.activeSemesterId"
      :options="options"
      size="small"
      class="w-190px"
      @update:value="handleChange"
    />
  </div>
</template>

<style scoped></style>
