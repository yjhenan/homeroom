# homeroom · 班级管理

班主任的本地班级管理工具。单用户、无登录、固定深色；**web-first**：功能开发期纯网页（Vite + Dexie/IndexedDB），M4 才集成 Tauri + SQLite。

## 必读

动手前先读 `docs/`（五篇，每篇一屏）：

- `00-总览` — 目标与非目标（不做：通知推送/多用户/云同步/浅色/移动端）
- `01-架构` — 技术栈、ClassRepo 分层与硬规则、M1 裁剪清单
- `02-数据模型` — 全部表结构、备份/迁移 JSON 格式
- `03-模块需求` — 每模块页面与交互定义
- `04-里程碑` — M1–M4 与验收标准

## 硬规则（违反即返工）

- 组件/store 只准依赖 `src/repo` 的 `ClassRepo` 接口与 DTO，禁止直接 import `dexie` / `@tauri-apps/*`
- DTO 纯数据：字符串 nanoid id、日期 `YYYY-MM-DD`、时间 ISO 字符串；不出入 Date 对象或存储层特有类型
- Dexie schema 变更必须升 version 并写 migration
- SheetJS 用 `cdn.sheetjs.com` 官方源（npm 上的 `xlsx` 停更于 2022）
- 不收学生身份证号等强敏感字段

## 环境与约定

- pnpm ≥10 / Node ≥20.19；Rust 未装（M4 前不需要）
- `pnpm dev` → http://localhost:9527（`vite --mode test`）
- git 提交一律 `--no-verify`（上游 pre-commit 过重，M1 裁剪时改轻量钩子）
- UI 文案与 commit message 用中文
- 代码基于 soybean-admin v2.2.0 裁剪；进度看 `git log --oneline`（`3dbc406` 为原版基线）
