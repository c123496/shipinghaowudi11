# 视频号图书带货流程改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有工具流程改成飞书文章里的图书带货自动化链路，同时保留当前项目自己的文案提示词。

**Architecture:** 后端继续使用 FastAPI 的任务/步骤模型，扩展流水线步骤与执行器，把文案工坊、书籍识别、TTS、九宫格分镜和成片纳入统一一键流程。前端继续使用 React 单页任务视图，更新流程文案和一键按钮逻辑，使用户看到“抖音选题采集 → 逐字稿 → 清洗改写 → 识书 → TTS → 九宫格配图 → 字幕 → 成片”的顺序。

**Tech Stack:** Python/FastAPI/SQLAlchemy，React/TypeScript/Vite，现有 `wenan.py` 提示词体系，现有 storyboard 与 storyboard_video 服务。

---

### Task 1: 后端步骤定义与任务初始化

**Files:**
- Modify: `backend/routers/pipeline.py`
- Modify: `backend/routers/tasks.py`
- Test: `tests/test_pipeline_steps.py`

- [ ] 写测试，验证任务创建时包含文章式全流程步骤：`parse/transcribe/clean/rewrite/identify_book/tts/storyboard/subtitle/compose`。
- [ ] 运行 `pytest tests/test_pipeline_steps.py -q`，预期先失败。
- [ ] 把后端 `STEPS` 扩展为文章式全流程步骤。
- [ ] 更新任务创建逻辑，StepRun 初始化使用新的 `STEPS`。
- [ ] 再运行 `pytest tests/test_pipeline_steps.py -q`，预期通过。

### Task 2: 后端执行器接入文案与分镜

**Files:**
- Modify: `backend/routers/pipeline.py`

- [ ] 实现 `clean`：读取 `transcript.json`，调用 `services.wenan.clean`，写入/更新 `wenan.json.cleaned`。
- [ ] 实现 `identify_book`：使用清洗稿和 meta 调 `services.wenan.identify_book`，写入/更新 `wenan.json.book`，并同步到 `rewrite.json.book`。
- [ ] 调整 `rewrite`：继续调用现有 `services.rewriter.rewrite`，不替换提示词。
- [ ] 调整 `tts`：从 `rewrite.json` 选中候选稿读取文案，继续使用现有 TTS。
- [ ] 实现 `storyboard`：按选中口播稿准备九宫格批次并生成每组图片。
- [ ] 调整 `compose`：优先用 `storyboard_video.compose_variant(..., "rewrite")` 生成分镜成片，失败时回退旧 `composer.compose`。

### Task 3: 前端流程展示与一键逻辑

**Files:**
- Modify: `frontend/src/components/PipelineView.tsx`
- Modify: `frontend/src/components/StepCard.tsx`
- Modify: `frontend/src/api/client.ts` if type definitions need new fields.

- [ ] 更新页面流程卡片为文章式步骤命名。
- [ ] 更新一键出片日志与执行顺序，调用后端统一步骤而不是前端手动串联文案/分镜接口。
- [ ] 保留文案工坊与分镜面板作为人工复核/续跑入口。
- [ ] 去掉“古画 + AI 史诗”“三国克隆声”等非图书带货通用表达。

### Task 4: 验证

**Files:**
- No source changes expected.

- [ ] 运行 `pytest -q` 验证后端测试。
- [ ] 运行 `npm run build` in `frontend` 验证 TypeScript/Vite。
- [ ] 汇总改动文件、验证结果、未覆盖风险。
