import { DexieClassRepo } from './dexie';
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
 * Tauri 壳内 → SQLite（class.db 在 exe 同目录）；纯浏览器 → Dexie(IndexedDB)
 * SQLite 实现懒加载（动态 import），避免 web 包里打进 @tauri-apps 依赖
 */
export function createRepo(): ClassRepo {
  if (isTauri()) {
    // 动态 import 打破模块级依赖；工厂被调用时一定在壳内
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SqliteClassRepo } = require('./sqlite') as typeof import('./sqlite');
    return new SqliteClassRepo();
  }
  return new DexieClassRepo();
}

/** 应用级单例；组件与 store 一律通过它访问数据 */
export const repo: ClassRepo = createRepo();
