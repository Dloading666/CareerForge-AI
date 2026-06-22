# 项目资料目录

这里集中存放「CareerForge-AI」项目的所有设计文档、调研文档、需求说明和改进计划。

## 怎么看这些文档

- 新人想了解项目是什么 / 解决什么问题：先看 [PRD.md](./PRD.md)
- 想了解系统架构、数据库、关键流程：再看 [DESIGN.md](./DESIGN.md)
- 想知道最近改了什么：[CHANGELOG.md](./CHANGELOG.md)
- AI 面试官相关（设计/调研/改进）：看「AI 面试官专题」区
- 历史归档（已废弃，仅供回溯）：[../.archive/docs/](../.archive/docs/)

## 目录分类

### 核心文档

- [PRD.md](./PRD.md) — 产品需求
- [DESIGN.md](./DESIGN.md) — 系统设计文档（架构、数据库、关键流程）
- [DATABASE.md](./DATABASE.md) — 数据库设计说明书（表清单、关键约定、迁移历史）
- [API.md](./API.md) — API 接口文档（按业务域分组的端点速查表）
- [CHANGELOG.md](./CHANGELOG.md) — 变更日志
- [design-qa.md](./design-qa.md) — 视觉对比 QA

### AI 面试官专题

- [AI面试官多模态升级设计报告.md](./AI面试官多模态升级设计报告.md) — 语音 + RAG + 报告的整体设计
- [ai-interviewer-from-zero-rag-architecture.md](./ai-interviewer-from-zero-rag-architecture.md) — RAG 架构从零搭建
- [agent-improvement-plan.md](./agent-improvement-plan.md) — Agent 改进计划

### 业务专题

- [interview-overhaul-plan.md](./interview-overhaul-plan.md) — 面试模块改造
- [resume-import-and-onboarding-plan.md](./resume-import-and-onboarding-plan.md) — 简历导入与 onboarding

### 改进计划

- [plans/2026-06-11-fact-guard-enhancement.md](./plans/2026-06-11-fact-guard-enhancement.md) — 事实护栏增强

## 待补文档

（暂无）

## 关于 `docs/` 目录

`docs/` 现在只放 AI 编码代理用的 prompt 模板（`2026*-ai-interviewer-*.md`），与本目录职责不同，请勿混淆。
