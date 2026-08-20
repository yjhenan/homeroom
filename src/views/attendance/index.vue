<script setup lang="ts">
import EntryTab from './modules/entry-tab.vue';
import HistoryTab from './modules/history-tab.vue';

defineOptions({
  name: 'Attendance'
});
</script>

<template>
  <NCard :bordered="false" class="card-wrapper">
    <NTabs type="line" animated>
      <NTabPane name="entry" tab="录入" display-directive="show">
        <EntryTab />
      </NTabPane>
      <NTabPane name="history" tab="历史查询" display-directive="show:lazy">
        <HistoryTab />
      </NTabPane>
    </NTabs>
  </NCard>
</template>

<style scoped></style>
