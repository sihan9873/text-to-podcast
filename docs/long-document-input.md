# 长文本与 Markdown 输入

长文档输入由 `generation-backend` 统一管理。项目保存完整原文，同时保存确定性的有序分段；预览和正式提交使用同一算法，同一文本与参数会得到相同结果。

## 支持范围

- 页面直接粘贴纯文本或 Markdown。
- 上传 UTF-8 编码的 `.txt`、`.md`、`.markdown` 文件，单个文件不超过 2 MB。
- 原文最多 100,000 个 Unicode 字符。
- 按自然段分段，或按预计朗读时长组合自然段。
- Markdown 标题会与随后的正文保存在同一分段；围栏代码块中的空行不会误切分。
- 单个分段最多 5,000 字符，超长自然段优先按句末标点切分，再进行安全定长切分。
- 默认朗读速度为每分钟 240 字，可选范围 120–300；每段目标时长为 1–15 分钟，最多 2,000 个分段。

## 接口

### 预览分段

`POST /api/v1/projects/{project_id}/source/preview`

预览不写数据库。请求示例：

```json
{
  "text": "# 第一章\n\n这是正文。",
  "source_type": "markdown",
  "source_name": "article.md",
  "segmentation_mode": "duration",
  "target_minutes": 5,
  "chars_per_minute": 240
}
```

### 确认提交

`PUT /api/v1/projects/{project_id}/source`

请求体与预览一致。提交后完整原文和分段一并锁定，避免脚本任务引用的输入在执行期间变化。旧客户端只发送 `text` 时，默认按纯文本和自然段处理。

### 查询已提交分段

`GET /api/v1/projects/{project_id}/source/chunks`

返回 `chunk_id`、`sequence`、`text`、`character_count`、`estimated_seconds` 和 `boundary_type`。脚本任务快照也包含同一组 `source_chunks`，供后续逐段 LLM 生成使用。

## 数据库

`projects` 保存完整原文、类型、文件名、总字符数、预计时长和分段参数；`source_chunks` 保存有序分段。迁移版本为 `20261114_long_document_input`，运行 `python -m app.bootstrap` 会自动升级已有开发数据库。

## 当前边界

本功能完成输入、预览、分段、锁定、持久化和任务快照。Mock 生成流程可以继续运行；真实本地 LLM 当前单次接口仍限制 5,000 字，后续应按 `source_chunks` 逐段调用并汇总脚本，不能重新把十万字原文作为一次请求发送。
