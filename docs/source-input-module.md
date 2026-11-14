# 原文输入模块说明

负责人：陈思涵

## 已实现范围

- 粘贴纯文本或 Markdown。
- 上传 UTF-8 编码的 TXT、MD、MARKDOWN 文件，浏览器读取后不截断内容。
- 原文上限 100,000 个 Unicode 字符，文件上限 2 MB。
- 按自然段分段，或按每段预计朗读时长分段。
- 用户可选择每段 1–15 分钟及朗读速度，默认每分钟 240 字。
- 提交前显示完整的分段数量、每段字符数、预计时长和原文预览。
- 确认后同时保存完整原文、分段参数和有序分段，并锁定项目原文。
- Markdown 标题与后续正文保持在同一分段，围栏代码块中的空行不会误切分。

详细接口、数据库和算法边界见 [`long-document-input.md`](long-document-input.md)。

## 代码位置

- `frontend/src/features/source-input/SourceInputPanel.tsx`：上传、粘贴、参数选择、预览和确认界面。
- `frontend/src/features/source-input/validation.ts`：文件、UTF-8、字符数校验。
- `frontend/src/features/source-input/segmentation.ts`：Mock 模式使用的确定性分段实现。
- `generation-backend/app/services/source_segmentation.py`：正式后端分段算法。
- `generation-backend/app/services/projects.py`：预览、提交和查询分段。
- `generation-backend/migrations/versions/20261114_long_document_input.py`：数据库迁移。

## 验证范围

自动测试覆盖纯空白、十万字符上限、UTF-8 BOM、错误编码、TXT/Markdown 类型、自然段顺序、预计时长组合、超长段落、Markdown 标题、链接和围栏代码块、预览不落库、提交后持久化、用户隔离及任务快照。

## 后续协作边界

本模块不直接调用模型。脚本生成模块从任务快照的 `source_chunks` 按 `sequence` 读取分段，逐段调用真实 LLM 并汇总；不能把十万字原文重新作为一次模型请求发送。
