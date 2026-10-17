# TextCast 前端

这是文字转播客生成系统的前端子项目，不是独立产品仓库。

## 技术栈

- React + TypeScript：页面和交互。
- Vite：本地开发服务器和生产构建。
- React Router：项目、脚本和音频页面路由。
- TanStack Query：服务端数据请求与缓存。
- MSW：后端完成前的浏览器模拟接口。
- Tailwind CSS 与组件封装：界面样式。

## 本地运行

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

质量检查：

```powershell
pnpm typecheck
pnpm lint
pnpm build
```

## 代码入口

- `src/main.tsx`：创建 React 应用，开发环境按配置启动 MSW。
- `src/app/App.tsx`：布局、项目列表和路由入口。
- `src/app/Project.tsx`：原文上传/粘贴和脚本版本列表。
- `src/app/Script.tsx`：原文与脚本对照、编辑、版本和确认。
- `src/app/Audio.tsx`：声音参数、任务状态、播放器和下载界面。
- `src/api/`：脚本、生成任务和音频请求封装。
- `src/mocks/`：开发期模拟数据与接口处理器。
- `src/types/`：前后端共享语义的 TypeScript 类型。

## Mock 与真实后端

`.env.development` 默认设置 `VITE_ENABLE_MOCK=true`，浏览器会拦截 `/api` 请求并返回内存数据。Mock 用于页面开发，不代表数据已经保存到数据库，也不代表 LLM/TTS 已经接入。

联调正式后端时，应配置 API 地址并关闭 Mock，例如：

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api
VITE_ENABLE_MOCK=false
```

正式切换前必须保证后端响应与 `src/api/`、`src/types/` 和现有 Mock 契约一致。
