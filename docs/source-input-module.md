# 原文输入模块说明

负责人：陈思涵  
对应需求：FR01、FR02、FR03

## 模块范围

原文输入模块负责：

- 选择并读取 UTF-8 编码的 TXT 文件；
- 粘贴、查看和继续编辑原文；
- 显示实时字符数；
- 在保存前检查文件和文本；
- 通过项目 API 保存完整原文；
- 展示明确的成功、警告和失败反馈。

模块不负责调用大模型或创建播客脚本版本。原文保存成功后，大模型模块应读取项目的最新 `content`，建立独立的脚本生成任务。

## 输入规则

| 场景 | 行为 |
| --- | --- |
| 非 `.txt` 文件 | 拒绝并显示“仅支持 .txt 文本文件” |
| TXT 超过 100 KB | 读取前拒绝，并显示当前文件大小 |
| 空文件 | 拒绝 |
| 非 UTF-8 字节 | 使用严格 UTF-8 解码拒绝，不使用乱码替代字符 |
| 文件读取异常 | 保留当前编辑内容并显示失败原因 |
| 空白原文 | 禁止保存 |
| 5000 字以内 | 可直接保存 |
| 超过 5000 字 | 不截断；显示警告，用户明确确认后才允许保存 |
| 已有脚本时修改原文 | 保存新原文，但不覆盖历史脚本，并提示需要重新生成脚本 |

字符数按用户可见的 Unicode 字符统计，因此 emoji 不会被错误计算为两个字符。

## 保存接口

```http
PUT /api/projects/{projectId}
Content-Type: application/json

{
  "content": "完整原文"
}
```

成功响应：

```json
{
  "project": {
    "id": "project-id",
    "content": "完整原文",
    "updatedAt": "2026-10-17T00:00:00.000Z"
  }
}
```

前端只在接口成功后更新 TanStack Query 缓存。开发环境的 MSW handler 会把项目写入 `localStorage`，用于刷新恢复；正式环境必须由后端重复校验并写入数据库。

## 代码位置

- `frontend/src/app/Project.tsx`：输入、编辑、反馈和保存界面。
- `frontend/src/features/source-input/validation.ts`：文件与文本校验。
- `frontend/src/features/source-input/validation.test.ts`：自动化测试。
- `frontend/src/features/projects/api.ts`：项目更新 API。
- `frontend/src/mocks/handlers/projects.ts`：开发环境项目接口。
- `frontend/src/mocks/data/projects.ts`：开发环境刷新持久化。

## 自动化验收

运行：

```powershell
cd frontend
pnpm test
```

测试覆盖：字符计数、纯空白、超过 5000 字且不截断、合法 TXT、错误扩展名、空文件、超过 100 KB、读取失败、UTF-8 BOM、无效 UTF-8、解码后空白，以及保存后重新加载 Mock 数据仍能恢复完整原文。

## 正式联调待办

- 后端实现并持久化 `PUT /api/projects/{projectId}`。
- 后端重复执行空白、长度和输入类型校验。
- 前后端共同确认超长原文是继续警告还是设置硬限制。
- 大模型模块使用保存后的项目原文创建脚本任务，不直接读取页面临时状态。
