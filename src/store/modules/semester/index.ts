import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { SetupStoreId } from '@/enum';
import { repo } from '@/repo';
import type { Semester } from '@/repo';

/**
 * 学期 store
 *
 * 「当前学期」以 semesters.is_active 为唯一事实，settings.currentSemesterId 同步留存于备份
 */
export const useSemesterStore = defineStore(SetupStoreId.Semester, () => {
  const semesters = ref<Semester[]>([]);
  const activeSemesterId = ref<string | null>(null);
  const initialized = ref(false);

  /** 进行中的初始化 promise：header 切换器与页面 onMounted 可能同一 tick 并发调用，防重复建默认学期 */
  let initPromise: Promise<void> | null = null;

  const activeSemester = computed(() => semesters.value.find(s => s.id === activeSemesterId.value) ?? null);

  /** 应用启动时调用；空库自动创建默认学期（并发安全） */
  function initSemesters(): Promise<void> {
    if (!initPromise) {
      initPromise = doInit().catch(err => {
        initPromise = null; // 失败允许重试
        throw err;
      });
    }
    return initPromise;
  }

  async function doInit() {
    let list = await repo.listSemesters();

    if (list.length === 0) {
      await repo.createSemester({
        id: '2026-2027-1',
        name: '2026-2027学年 第一学期',
        start_date: '2026-09-01',
        end_date: '2027-01-20',
        is_active: true
      });
      list = await repo.listSemesters();
    }

    // 兜底：存在学期但无 active（如手工改库）时激活最新一个
    if (!list.some(s => s.is_active) && list.length > 0) {
      const latest = list[list.length - 1];
      await repo.setActiveSemester(latest.id);
      list = await repo.listSemesters();
    }

    semesters.value = list;
    activeSemesterId.value = (list.find(s => s.is_active) ?? list[list.length - 1] ?? null)?.id ?? null;
    initialized.value = true;
  }

  /** 强制从库里刷新学期列表（归档等变更后调用） */
  async function refreshSemesters() {
    const list = await repo.listSemesters();
    semesters.value = list;
    const active = list.find(x => x.is_active);
    if (active) {
      activeSemesterId.value = active.id;
    } else if (!list.some(x => x.id === activeSemesterId.value)) {
      activeSemesterId.value = list[list.length - 1]?.id ?? null;
    }
  }

  /** 切换当前学期 */
  async function switchSemester(id: string) {
    if (id === activeSemesterId.value) return;

    await repo.setActiveSemester(id);
    await repo.setSetting('currentSemesterId', id);

    semesters.value = await repo.listSemesters();
    activeSemesterId.value = id;
  }

  return {
    semesters,
    activeSemesterId,
    activeSemester,
    initialized,
    initSemesters,
    refreshSemesters,
    switchSemester
  };
});
