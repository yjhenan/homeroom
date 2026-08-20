import { DexieClassRepo } from './dexie';
import type { ClassRepo } from './types';

export type { ClassRepo } from './types';
export type * from './types';

/**
 * 仓库工厂——按环境返回实现
 *
 * web 阶段返回 Dexie(IndexedDB) 实现；M4 增加 SQLite 分支
 */
export function createRepo(): ClassRepo {
  return new DexieClassRepo();
}

/** 应用级单例；组件与 store 一律通过它访问数据 */
export const repo: ClassRepo = createRepo();
