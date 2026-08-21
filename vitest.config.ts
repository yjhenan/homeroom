import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * 测试独立配置：不加载 vite.config.ts（elegant-router/unocss 等插件在测试模式无谓拖慢启动）
 * 别名与 tsconfig 保持一致
 */
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts']
  }
});
