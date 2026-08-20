import type { ProxyOptions } from 'vite';

/**
 * Set http proxy
 *
 * web-first 阶段无后端，不启用代理；保留函数签名以兼容 vite.config.ts
 *
 * @param _env - The current env
 * @param _enable - If enable http proxy
 */
export function createViteProxy(_env: Env.ImportMeta, _enable: boolean): Record<string, ProxyOptions> | undefined {
  return undefined;
}
