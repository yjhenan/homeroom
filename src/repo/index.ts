import { DexieClassRepo } from './dexie';
import { SqliteClassRepo } from './sqlite';
import type { ClassRepo } from './types';

export type { ClassRepo } from './types';
export type * from './types';

/** 是否运行在 Tauri 桌面壳内 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 仓库工厂——按环境返回实现
 *
 * Tauri 壳内 → SQLite（class.db 在 exe 同目录）；纯浏览器 → Dexie(IndexedDB)。
 * @tauri-apps 包导入本身无副作用（只在调用时触 invoke），web 构建安全带入。
 */
export function createRepo(): ClassRepo {
  return isTauri() ? new SqliteClassRepo() : new DexieClassRepo();
}

/** 应用级单例；组件与 store 一律通过它访问数据 */
export const repo: ClassRepo = createRepo();
