# TextCast 前端

本目录是统一项目的唯一前端入口。技术栈为 React、TypeScript、Vite、TanStack Query、React Router、Tailwind CSS 和 MSW。

## 本地开发

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

默认使用 MSW 模拟接口。连接真实后端时，新建不提交到 Git 的 `.env.local`：

```env
VITE_ENABLE_MOCK=false
```

Vite 会把账号接口 `/api/auth`、管理员接口 `/api/admin` 转发到 `127.0.0.1:8000`，把生成业务接口转发到 `127.0.0.1:8001/api/v1`。

## 质量检查

```powershell
pnpm check
```

该命令依次运行 Oxlint、Vitest、TypeScript 和 Vite 生产构建。

## 代码边界

- `src/api/`：统一 API 客户端和数据类型。
- `src/app/`：登录、项目、脚本、角色和音频页面。
- `src/mocks/`：与正式接口保持同一数据结构的开发模拟服务。
- `src/features/source-input/`：长文本、TXT/Markdown 读取、自然段/预计时长分段预览与输入校验。

旧的 `PodcastWorkflow`、旧 `request.ts` 和旧版登录页面已被统一入口替代，不应重新引入第二套客户端。
