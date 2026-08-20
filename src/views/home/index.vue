<script setup lang="ts">
defineOptions({
  name: 'Home'
});
</script>

<template>
  <NSpace vertical :size="16">
    <NCard :bordered="false" class="card-wrapper">
      <NH2>班级总览</NH2>
      <NText depth="2">班主任的本地班级管理工具，数据保存在本机浏览器中。</NText>
    </NCard>
  </NSpace>
</template>

<style scoped></style>
