<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { dutyEvaluationLabel, dutyEvaluationTagType } from '@/constants/business';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';
import { repo } from '@/repo';
import type { DutyRecord } from '@/repo';

defineOptions({
  name: 'StudentDutyTab'
});

const props = defineProps<{
  studentId: string;
}>();

const semesterStore = useSemesterStore();
const studentStore = useStudentStore();

const records = ref<DutyRecord[]>([]);
const loading = ref(false);

const nameMap = computed(() => new Map(studentStore.students.map(s => [s.id, s.name])));

const stats = computed(() => {
  const counts = { good: 0, ok: 0, poor: 0 };
  records.value.forEach(r => {
    counts[r.evaluation] += 1;
  });
  return counts;
});

async function load() {
  if (!semesterStore.activeSemesterId) return;
  loading.value = true;
  try {
    records.value = await repo.getDutyByStudent(semesterStore.activeSemesterId, props.studentId);
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.studentId, semesterStore.activeSemesterId],
  () => load()
);

onMounted(async () => {
  if (semesterStore.activeSemesterId) {
    await studentStore.loadStudents(semesterStore.activeSemesterId);
  }
  await load();
});
</script>

<template>
  <div>
    <NSpin :show="loading">
      <NEmpty v-if="records.length === 0" description="本学期暂无值日记录" class="py-24px" />
      <template v-else>
        <div class="mb-16px flex items-center gap-16px text-14px">
          <span>参与 {{ records.length }} 次</span>
          <NTag size="small" type="success" :bordered="false">好 {{ stats.good }}</NTag>
          <NTag size="small" type="warning" :bordered="false">一般 {{ stats.ok }}</NTag>
          <NTag size="small" type="error" :bordered="false">差 {{ stats.poor }}</NTag>
        </div>
        <div class="max-h-420px overflow-auto rounded-6px border border-[rgba(127,127,127,0.28)]">
          <table class="w-full text-14px">
            <thead class="sticky top-0 bg-[rgba(127,127,127,0.14)]">
              <tr>
                <th class="w-110px px-12px py-8px text-left font-medium">日期</th>
                <th class="w-90px px-12px py-8px text-left font-medium">区域</th>
                <th class="w-100px px-12px py-8px text-left font-medium">值日组</th>
                <th class="px-12px py-8px text-left font-medium">同组学生</th>
                <th class="w-80px px-12px py-8px text-left font-medium">评价</th>
                <th class="px-12px py-8px text-left font-medium">备注</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in records" :key="r.id" class="border-t border-[rgba(127,127,127,0.28)]">
                <td class="px-12px py-6px opacity-80">{{ r.date }}</td>
                <td class="px-12px py-6px">{{ r.area }}</td>
                <td class="px-12px py-6px">{{ r.group_name ?? '—' }}</td>
                <td class="px-12px py-6px opacity-80">
                  {{
                    r.student_ids
                      .filter(id => id !== props.studentId)
                      .map(id => nameMap.get(id) ?? '？')
                      .join('、') || '—'
                  }}
                </td>
                <td class="px-12px py-6px">
                  <NTag size="small" :type="dutyEvaluationTagType[r.evaluation]" :bordered="false">
                    {{ dutyEvaluationLabel[r.evaluation] }}
                  </NTag>
                </td>
                <td class="px-12px py-6px">{{ r.remark ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </NSpin>
  </div>
</template>

<style scoped></style>
