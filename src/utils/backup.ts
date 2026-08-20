/**
 * JSON 全量备份：下载 / 读取
 *
 * 硬规则：导入前必须先导出一份当前数据（调用方负责触发）
 */
import type { BackupFile } from '@/repo';

/** 触发浏览器下载备份 JSON */
export function downloadBackup(data: BackupFile) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `班级数据备份_${data.exportedAt.replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 读取备份文件并做最小结构校验 */
export async function readBackupFile(file: File): Promise<BackupFile> {
  const text = await file.text();
  const data = JSON.parse(text) as BackupFile;

  if (!data || typeof data !== 'object' || data.version !== 1) {
    throw new Error('不是有效的班级数据备份（缺少 version: 1）');
  }
  if (!Array.isArray(data.semesters) || !Array.isArray(data.students) || !Array.isArray(data.enrollments)) {
    throw new Error('备份缺少 semesters/students/enrollments 字段');
  }
  return data;
}
