<script setup lang="ts">
import { nextTick, ref } from 'vue';
import type { DropdownOption } from 'naive-ui';

/**
 * 通用右键/长按菜单：包一层默认插槽即获得 contextmenu（桌面）与 500ms 长按（触屏）；
 * 表格 row-props 等无插槽场景用 ref.open(event) 编程式打开。
 */
defineOptions({
  name: 'ContextMenu',
  inheritAttrs: false
});

const props = defineProps<{
  options: DropdownOption[];
}>();

const emit = defineEmits<{
  select: [key: string | number];
}>();

const show = ref(false);
const x = ref(0);
const y = ref(0);

function open(e: MouseEvent | TouchEvent) {
  show.value = false;
  nextTick().then(() => {
    const src = 'touches' in e ? (e.touches[0] ?? e.changedTouches[0]) : e;
    x.value = src?.clientX ?? 0;
    y.value = src?.clientY ?? 0;
    show.value = true;
  });
}

defineExpose({ open });

let timer: ReturnType<typeof setTimeout> | null = null;

function startLongPress(e: TouchEvent) {
  cancelLongPress();
  timer = setTimeout(() => open(e), 500);
}

function cancelLongPress() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function handleSelect(key: string | number) {
  show.value = false;
  emit('select', key);
}
</script>

<template>
  <div
    class="inline-flex select-none"
    @contextmenu.prevent="open($event)"
    @touchstart.passive="startLongPress"
    @touchmove.passive="cancelLongPress"
    @touchend.passive="cancelLongPress"
  >
    <slot />
  </div>
  <NDropdown
    placement="bottom-start"
    trigger="manual"
    :x="x"
    :y="y"
    :options="props.options"
    :show="show"
    :on-clickoutside="() => (show = false)"
    @update:show="(v: boolean) => (show = v)"
    @select="handleSelect"
  />
</template>

<style scoped></style>
