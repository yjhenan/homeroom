<script setup lang="ts">
import { computed, ref, watch } from 'vue';

defineOptions({
  name: 'ScorePasteModal'
});

const props = defineProps<{
  show: boolean;
  /** 名单人数（用于提示对齐） */
  rosterSize: number;
}>();

const emit = defineEmits<{
  'update:show': [value: boolean];
  /** 提交解析后的分数列（与名册同序；null=缺考/空） */
  apply: [values: (number | null)[]];
}>();

const text = ref('');
const showHelp = ref(false);

const parsed = computed(() => parseColumn(text.value));

/** 解析粘贴文本：每行一个分数；空行/'缺'/'缺考' 视为 null */
function parseColumn(raw: string): { values: (number | null)[]; badLines: number[] } {
  const values: (number | null)[] = [];
  const badLines: number[] = [];
  raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .forEach((line, i) => {
      if (line === '' || line === '缺' || line === '缺考') {
        values.push(null);
        return;
      }
      const n = Number(line);
      if (Number.isFinite(n)) {
        values.push(Math.round(n * 100) / 100);
      } else {
        badLines.push(i + 1);
      }
    });
  return { values, badLines };
}

watch(
  () => props.show,
  show => {
    if (show) {
      text.value = '';
      showHelp.value = false;
    }
  }
);

function handleClose() {
  emit('update:show', false);
}

function handleApply() {
  emit('apply', parsed.value.values);
  handleClose();
}
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    title="从 Excel 粘贴成绩列"
    class="w-520px"
    :mask-closable="false"
    @update:show="handleClose"
  >
    <NAlert type="info" :bordered="false" class="mb-12px">
      在 Excel 里选中某一列的成绩（不含表头），Ctrl+C 复制后粘贴到下面。行序与当前名单一致； 空、
      <b>缺</b>
      、
      <b>缺考</b>
      均按缺考处理。当前名单 {{ props.rosterSize }} 人。
    </NAlert>
    <NInput
      v-model:value="text"
      type="textarea"
      :rows="12"
      placeholder="92.5&#10;88&#10;缺&#10;76&#10;……"
      class="font-mono"
    />
    <div v-if="text" class="mt-8px text-13px">
      <template v-if="parsed.badLines.length">
        <NText type="error">第 {{ parsed.badLines.join('、') }} 行不是数字，将被忽略。</NText>
      </template>
      <NText v-else depth="3">
        已识别 {{ parsed.values.length }} 行（{{ parsed.values.filter(v => v === null).length }} 个缺考）。
      </NText>
      <NText v-if="parsed.values.length > props.rosterSize" type="warning">
        超过名单人数，将只应用前 {{ props.rosterSize }} 行。
      </NText>
    </div>
    <template #footer>
      <div class="flex justify-end gap-12px">
        <NButton @click="handleClose">取消</NButton>
        <NButton type="primary" :disabled="parsed.values.length === 0" @click="handleApply">应用到名单</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped></style>
