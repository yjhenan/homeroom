<script setup lang="ts">
import { useThemeStore } from '@/store/modules/theme';
import { $t } from '@/locales';
import SettingItem from '../../../components/setting-item.vue';

defineOptions({
  name: 'ThemeSchema'
});

const themeStore = useThemeStore();

function handleGrayscaleChange(value: boolean) {
  themeStore.setGrayscale(value);
}

function handleColourWeaknessChange(value: boolean) {
  themeStore.setColourWeakness(value);
}
</script>

<template>
  <NDivider>{{ $t('theme.appearance.themeSchema.title') }}</NDivider>
  <div class="flex-col-stretch gap-16px">
    <SettingItem :label="$t('theme.appearance.grayscale')">
      <NSwitch :value="themeStore.grayscale" @update:value="handleGrayscaleChange" />
    </SettingItem>
    <SettingItem :label="$t('theme.appearance.colourWeakness')">
      <NSwitch :value="themeStore.colourWeakness" @update:value="handleColourWeaknessChange" />
    </SettingItem>
  </div>
</template>

<style scoped></style>
