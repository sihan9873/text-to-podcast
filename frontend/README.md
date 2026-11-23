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

## 新版页面整合（2026-11-23）

页面与组件基于远程 `main` 的 `bff9769`（改进长文本显示），保留本地后端、统一 API 适配层、Vite 服务代理、测试依赖和 Mock 实现。此次仅更新工作区文件，不切换分支。

- 引入新版项目页、脚本工具栏与搜索替换、角色声音编辑、生成估算、MP3 播放器和背景动画。
- 保留 TXT/Markdown 读取、最长 100,000 字符校验及服务端分段预览；通过现有原文提交接口保存，不调用尚未实现的 `/source/upload`。
- 保留提示词创作、保留原文、长文概括三种模式、模型选择、目标时长、风格及多主持人；超过 5,000 字符时默认选择长文概括。
- 保留登录响应与整数 ID 转换、注册后的会话清理、401 处理和无默认时限的任务轮询。
- 保留角色页克隆声音库、本地测试控制台及脚本任务失败提示。
- 音频试听与逐句音频入口按服务能力显示；当前本地后端只支持完整音频。任务重试仅在后端返回 `can_retry` 时显示。
- 在线语法检查需要用户主动启用，编辑内容不会默认发送至 LanguageTool。

使用方法和服务端口保持上文约定。前端构建成功不代表真实模型或克隆音质已经通过验收。

本次验证：38 项前端测试、TypeScript、lint（4 条既有 warning）和生产构建通过；账号及生成后端回归测试通过。隔离数据库下的 Chromium 验证已覆盖真实登录、原文提交、保留原文生成、脚本编辑保存与确认、音频播放器读取及 MP3 下载，以及 Markdown 长文上传、服务端分段预览、模型选择和双主持人参数。生成测试使用后端 Mock 模型，未验收真实 LLM/TTS 或克隆音质。构建仍有大分包及无效动态导入提示。
