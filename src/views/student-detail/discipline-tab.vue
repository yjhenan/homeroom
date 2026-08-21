<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { disciplineDirectionLabel } from '@/constants/business';
import { useSemesterStore } from '@/store/modules/semester';
import { repo } from '@/repo';
import type { DisciplineEvent } from '@/repo';

defineOptions({
  name: 'StudentDisciplineTab'
});

const props = defineProps<{
  studentId: string;
}>();

const semesterStore = useSemesterStore();

const events = ref<DisciplineEvent[]>([]);
const loading = ref(false);

const summary = computed(() => {
  let plus = 0;
  let minus = 0;
  events.value.forEach(e => {
    if (e.points === undefined) return;
    if (e.direction === 'plus') plus += e.points;
    else minus += e.points;
  });
  return { plus, minus, net: plus - minus, count: events.value.length };
});

async function load() {
  if (!semesterStore.activeSemesterId) return;
  loading.value = true;
  try {
    events.value = await repo.getDisciplineByStudent(semesterStore.activeSemesterId, props.studentId);
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.studentId, semesterStore.activeSemesterId],
  () => load()
);

onMounted(() => load());
</script>

<template>
  <div>
    <NSpin :show="loading">
      <NEmpty v-if="events.length === 0" description="本学期暂无德育事件" class="py-24px" />
      <template v-else>
        <div class="mb-16px flex items-center gap-16px text-14px">
          <span>共 {{ summary.count }} 条</span>
          <span>
            加分
            <b class="text-success">+{{ summary.plus }}</b>
          </span>
          <span>
            扣分
            <b class="text-error">-{{ summary.minus }}</b>
          </span>
          <span>
            净分
            <b>{{ summary.net >= 0 ? '+' : '' }}{{ summary.net }}</b>
          </span>
        </div>
        <NTimeline>
          <NTimelineItem
            v-for="e in events"
            :key="e.id"
            :type="e.direction === 'plus' ? 'success' : 'error'"
            :title="`${e.date} · ${e.category}${e.points !== undefined ? `（${disciplineDirectionLabel[e.direction]}${e.points}分）` : ''}`"
            :content="e.description"
          />
        </NTimeline>
      </template>
    </NSpin>
  </div>
</template>

<style scoped></style>
