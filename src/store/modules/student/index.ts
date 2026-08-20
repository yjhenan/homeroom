import { ref } from 'vue';
import { defineStore } from 'pinia';
import { SetupStoreId } from '@/enum';
import { repo } from '@/repo';
import type { StudentInput, StudentWithEnrollment } from '@/repo';

/**
 * 学生 store
 *
 * 只依赖 ClassRepo；列表按当前学期名册联查，搜索/筛选/排序留给页面做（班级规模小，全内存）
 */
export const useStudentStore = defineStore(SetupStoreId.Student, () => {
  const students = ref<StudentWithEnrollment[]>([]);
  const loading = ref(false);

  /** 加载某学期名册学生；不传学期则取当前学期 */
  async function loadStudents(semesterId?: string) {
    loading.value = true;
    try {
      students.value = await repo.listStudents(semesterId);
    } finally {
      loading.value = false;
    }
  }

  async function createStudent(input: StudentInput, semesterId: string) {
    await repo.createStudent(input, semesterId);
    await loadStudents(semesterId);
  }

  async function updateStudent(id: string, patch: Partial<StudentInput>, semesterId?: string) {
    await repo.updateStudent(id, patch);
    await loadStudents(semesterId);
  }

  /** 删除前取影响计数（供确认弹窗提示） */
  async function countRecords(studentId: string) {
    return repo.countStudentRecords(studentId);
  }

  async function removeStudent(id: string, semesterId?: string) {
    await repo.deleteStudent(id);
    await loadStudents(semesterId);
  }

  return {
    students,
    loading,
    loadStudents,
    createStudent,
    updateStudent,
    countRecords,
    removeStudent
  };
});
