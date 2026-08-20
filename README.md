# homeroom · 班级管理

班主任的本地班级管理工具：学生、考勤、成绩、德育、值日的**录入与检索**，数据完全留在本机。

- 技术栈：Vue 3 + Vite + TypeScript + Naive UI（基于 soybean-admin v2.2.0 裁剪）+ Tauri v2 + SQLite
- 开发策略：**web-first**——先按普通网页开发（浏览器 + IndexedDB），Tauri 桌面化与 SQLite 在最后阶段集成
- 规划文档：[docs/](./docs)

## 快速开始

```bash
pnpm install
pnpm dev        # http://localhost:9527
```

## 文档索引

| 文档                                 | 内容                       |
| ------------------------------------ | -------------------------- |
| [00-总览](./docs/00-总览.md)         | 目标、非目标、交付形态     |
| [01-架构](./docs/01-架构.md)         | 技术栈、分层、仓库接口规则 |
| [02-数据模型](./docs/02-数据模型.md) | 全部表结构与约束           |
| [03-模块需求](./docs/03-模块需求.md) | 每个模块的页面与交互定义   |
| [04-里程碑](./docs/04-里程碑.md)     | M1–M4 与验收标准           |

## 目录（规划）

```
homeroom/
├── docs/               # 规划文档（本目录）
├── src/
│   ├── repo/           # ClassRepo 接口 + Dexie/SQLite 实现
│   ├── views/          # 按模块组织页面
│   └── ...
├── src-tauri/          # M4 阶段启用
└── 班级管理.exe + class.db + backup/   # 最终交付物（绿色免安装）
```
