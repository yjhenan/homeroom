<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { dutyAreaOptions, dutyEvaluationLabel, dutyEvaluationTagType } from '@/constants/business';
import { useSemesterStore } from '@/store/modules/semester';
import { useStudentStore } from '@/store/modules/student';
import { repo } from '@/repo';
import type { DutyEvaluation, DutyInput, DutyRecord } from '@/repo';

defineOptions({
  name: 'Duty'
});

const semesterStore = useSemesterStore();
const studentStore = useStudentStore();

const isArchived = computed(() => semesterStore.activeSemester?.archived === true);

// ---- 周 ----
const toDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 本周一 */
function mondayOf(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (copy.getDay() + 6) % 7; // 周一=0
  copy.setDate(copy.getDate() - day);
  return copy;
}

const weekStart = ref(mondayOf(new Date()));

const weekDays = computed(() => {
  const days: { date: string; label: string; weekday: string }[] = [];
  const names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(weekStart.value);
    d.setDate(d.getDate() + i);
    days.push({ date: toDay(d), label: `${d.getMonth() + 1}/${d.getDate()}`, weekday: names[i] });
  }
  return days;
});

const weekTitle = computed(() => `${weekDays.value[0].date} ~ ${weekDays.value[6].date}`);

function prevWeek() {
  const d = new Date(weekStart.value);
  d.setDate(d.getDate() - 7);
  weekStart.value = d;
}

function nextWeek() {
  const d = new Date(weekStart.value);
  d.setDate(d.getDate() + 7);
  weekStart.value = d;
}

// ---- 数据 ----
const records = ref<DutyRecord[]>([]);
const semesterRecords = ref<DutyRecord[]>([]);
const loading = ref(false);

const recordsByDate = computed(() => {
  const map = new Map<string, DutyRecord[]>();
  records.value.forEach(r => {
    const list = map.get(r.date) ?? [];
    list.push(r);
    map.set(r.date, list);
  });
  return map;
});

const nameMap = computed(() => new Map(studentStore.students.map(s => [s.id, s.name])));

function studentNames(ids: string[]): string {
  return ids.map(id => nameMap.value.get(id) ?? '？').join('、');
}

/** 学期评价汇总 */
const semesterStats = computed(() => {
  const counts = { good: 0, ok: 0, poor: 0 };
  semesterRecords.value.forEach(r => {
    counts[r.evaluation] += 1;
  });
  return counts;
});

async function load() {
  if (!semesterStore.activeSemesterId) return;
  loading.value = true;
  try {
    const [week, all] = await Promise.all([
      repo.listDutyRecords(semesterStore.activeSemesterId, weekDays.value[0].date, weekDays.value[6].date),
      repo.listDutyRecords(semesterStore.activeSemesterId)
    ]);
    records.value = week;
    semesterRecords.value = all;
  } finally {
    loading.value = false;
  }
}

// ---- 编辑弹窗 ----
const modalShow = ref(false);
const saving = ref(false);
const editForm = ref<DutyInput & { id?: string }>({
  date: today(),
  group_name: '',
  student_ids: [],
  area: '教室',
  evaluation: 'ok',
  remark: ''
});

function today() {
  return toDay(new Date());
}

const studentOptions = computed(() =>
  studentStore.students
    .filter(s => s.enrollment?.status === 'active')
    .map(s => ({ label: `${s.name}（${s.student_no}）`, value: s.id }))
);

function openAdd(date: string) {
  editForm.value = { date, group_name: '', student_ids: [], area: '教室', evaluation: 'ok', remark: '' };
  modalShow.value = true;
}

function openEdit(record: DutyRecord) {
  editForm.value = {
    id: record.id,
    date: record.date,
    group_name: record.group_name ?? '',
    student_ids: [...record.student_ids],
    area: record.area,
    evaluation: record.evaluation,
    remark: record.remark ?? ''
  };
  modalShow.value = true;
}

async function handleSave() {
  if (!semesterStore.activeSemesterId || saving.value) return;
  if (editForm.value.student_ids.length === 0) {
    window.$message?.warning('请选择值日学生');
    return;
  }
  saving.value = true;
  try {
    await repo.saveDutyRecord(
      {
        date: editForm.value.date,
        ...(editForm.value.group_name?.trim() ? { group_name: editForm.value.group_name.trim() } : {}),
        student_ids: editForm.value.student_ids,
        area: editForm.value.area,
        evaluation: editForm.value.evaluation as DutyEvaluation,
        ...(editForm.value.remark?.trim() ? { remark: editForm.value.remark.trim() } : {})
      },
      semesterStore.activeSemesterId
    );
    window.$message?.success('已保存');
    modalShow.value = false;
    await load();
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function handleDelete() {
  if (!editForm.value.id) return;
  try {
    await repo.deleteDutyRecord(editForm.value.id);
    window.$message?.success('已删除');
    modalShow.value = false;
    await load();
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '删除失败');
  }
}

/** 复制上一周到本周 */
const copying = ref(false);
async function copyLastWeek() {
  if (!semesterStore.activeSemesterId || copying.value) return;
  copying.value = true;
  try {
    const prevStart = new Date(weekStart.value);
    prevStart.setDate(prevStart.getDate() - 7);
    const prevEnd = new Date(prevStart);
    prevEnd.setDate(prevEnd.getDate() + 6);
    const prev = await repo.listDutyRecords(semesterStore.activeSemesterId, toDay(prevStart), toDay(prevEnd));

    const existKey = new Set(records.value.map(r => `${r.date}|${r.area}`));
    let copied = 0;
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(weekStart.value);
      d.setDate(d.getDate() + i);
      const targetDate = toDay(d);
      prev
        .filter(r => r.date === toDay(new Date(prevStart.getTime() + i * 86400000)))
        .forEach(async r => {
          if (existKey.has(`${targetDate}|${r.area}`)) return;
          await repo.saveDutyRecord(
            {
              date: targetDate,
              student_ids: r.student_ids,
              area: r.area,
              evaluation: r.evaluation,
              ...(r.group_name ? { group_name: r.group_name } : {}),
              ...(r.remark ? { remark: r.remark } : {})
            },
            semesterStore.activeSemesterId!
          );
          copied += 1;
        });
    }
    // 等待批量写完成
    await new Promise(r => setTimeout(r, 300));
    window.$message?.success(`已复制 ${copied} 条（同日期同区域已跳过）`);
    await load();
  } catch (err) {
    window.$message?.error(err instanceof Error ? err.message : '复制失败');
  } finally {
    copying.value = false;
  }
}

watch(weekStart, () => load());
watch(
  () => semesterStore.activeSemesterId,
  () => load()
);

onMounted(async () => {
  await semesterStore.initSemesters();
  if (semesterStore.activeSemesterId) {
    await studentStore.loadStudents(semesterStore.activeSemesterId);
    await load();
  }
});
</script>

<template>
  <NSpace vertical :size="16">
    <NCard :bordered="false" class="card-wrapper">
      <div class="mb-16px flex flex-wrap items-center gap-12px">
        <div class="text-18px font-medium">值日排班</div>
        <NTag v-if="isArchived" type="warning" :bordered="false">学期已归档，只读</NTag>
        <div class="ml-auto flex items-center gap-12px">
          <NButton size="small" @click="prevWeek">‹ 上一周</NButton>
          <span class="w-200px text-center text-14px">{{ weekTitle }}</span>
          <NButton size="small" @click="nextWeek">下一周 ›</NButton>
          <NButton size="small" :disabled="isArchived" :loading="copying" @click="copyLastWeek">复制上一周</NButton>
        </div>
      </div>

      <!-- 学期汇总 -->
      <div class="mb-12px flex items-center gap-16px text-14px">
        <span class="opacity-70">学期评价：</span>
        <NTag size="small" type="success" :bordered="false">好 {{ semesterStats.good }}</NTag>
        <NTag size="small" type="warning" :bordered="false">一般 {{ semesterStats.ok }}</NTag>
        <NTag size="small" type="error" :bordered="false">差 {{ semesterStats.poor }}</NTag>
      </div>

      <NSpin :show="loading">
        <div class="grid grid-cols-7 gap-8px">
          <div
            v-for="day in weekDays"
            :key="day.date"
            class="min-h-160px rounded-6px border border-[rgb(63,69,87)] p-8px"
          >
            <div class="mb-8px flex items-center justify-between">
              <span class="text-13px font-medium">{{ day.weekday }} {{ day.label }}</span>
              <NButton text size="tiny" type="primary" :disabled="isArchived" @click="openAdd(day.date)">+排</NButton>
            </div>
            <div
              v-for="rec in recordsByDate.get(day.date) ?? []"
              :key="rec.id"
              class="mb-6px cursor-pointer rounded-4px bg-[rgba(127,127,127,0.10)] p-6px hover:bg-[rgba(127,127,127,0.18)]"
              @click="openEdit(rec)"
            >
              <div class="flex items-center justify-between gap-4px">
                <span class="text-13px font-medium">{{ rec.area }}</span>
                <NTag size="tiny" :type="dutyEvaluationTagType[rec.evaluation]" :bordered="false">
                  {{ dutyEvaluationLabel[rec.evaluation] }}
                </NTag>
              </div>
              <div class="truncate text-12px opacity-75">
                {{ rec.group_name ? `${rec.group_name}：` : '' }}{{ studentNames(rec.student_ids) || '未排学生' }}
              </div>
            </div>
          </div>
        </div>
      </NSpin>
    </NCard>

    <!-- 编辑弹窗 -->
    <NModal
      v-model:show="modalShow"
      preset="card"
      :title="editForm.id ? '编辑值日' : '排值日'"
      class="w-480px"
      :mask-closable="false"
    >
      <NForm label-placement="left" label-width="64">
        <NFormItem label="日期">
          <NDatePicker
            v-model:formatted-value="editForm.date"
            type="date"
            value-format="yyyy-MM-dd"
            class="w-full"
            :disabled="Boolean(editForm.id)"
          />
        </NFormItem>
        <NFormItem label="区域">
          <NRadioGroup v-model:value="editForm.area">
            <NRadio v-for="o in dutyAreaOptions" :key="o.value" :value="o.value">{{ o.label }}</NRadio>
          </NRadioGroup>
        </NFormItem>
        <NFormItem label="值日组">
          <NInput v-model:value="editForm.group_name" placeholder="选填，如第一组" />
        </NFormItem>
        <NFormItem label="学生">
          <NSelect
            v-model:value="editForm.student_ids"
            :options="studentOptions"
            multiple
            filterable
            placeholder="可多选"
          />
        </NFormItem>
        <NFormItem label="评价">
          <NRadioGroup v-model:value="editForm.evaluation">
            <NRadio value="good">好</NRadio>
            <NRadio value="ok">一般</NRadio>
            <NRadio value="poor">差</NRadio>
          </NRadioGroup>
        </NFormItem>
        <NFormItem label="备注">
          <NInput v-model:value="editForm.remark" placeholder="选填" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-between">
          <NButton v-if="editForm.id" quaternary type="error" @click="handleDelete">删除</NButton>
          <span v-else />
          <div class="flex gap-12px">
            <NButton @click="modalShow = false">取消</NButton>
            <NButton type="primary" :loading="saving" @click="handleSave">保存</NButton>
          </div>
        </div>
      </template>
    </NModal>
  </NSpace>
</template>

<style scoped></style>
