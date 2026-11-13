# 本地 Mock

运行 `pnpm dev` 后自动启用 MSW，拦截 `/api/*`；生产构建不启动 Mock。
连接真实后端时，在 `.env.local` 设置 `VITE_ENABLE_MOCK=false` 并重启开发服务。

Mock 与 `src/api` 的请求和响应类型保持一致，提供统一响应信封、分页、关键词及状态筛选。
默认未登录，演示账号为 `demo`，密码为 `TextCast123`。注册不自动登录，支持重复用户名和错误密码检查。
模拟账户和会话保存在 sessionStorage，同一标签页刷新可保留；密码仅存 SHA-256 摘要。这仅用于本地演示，不代表真实后端鉴权。
包含四个项目：已完成音频、音频失败可重试、待确认脚本和未提交原文。演示项目为共享数据。
支持创建项目、粘贴或上传 TXT、脚本保存和确认、试听、音频生成、逐句候选选择、任务重试及配置管理。
异步任务约三秒完成，在后续请求时推进状态；同一路径的幂等键可复用任务。

数据保存在内存中，刷新页面会恢复演示数据。音频为本地生成的四秒 WAV 提示音，用于验证播放和下载，不是真实语音合成。
脚本详情提供草稿和已确认状态；第一个项目额外包含 V2 草稿，方便测试多版本、保存及确认冲突。
声音目录提供 2 个模拟提供方、3 个模型和 6 种音色，覆盖中文/英文、可调/固定语速，以及数字、枚举、布尔额外参数。
保存接口保留角色模板关联，并模拟 `REVISION_CONFLICT`、`SCRIPT_LOCKED`、`INVALID_ROLE`、`INVALID_VOICE`、`INVALID_AUDIO_PARAMS` 和 `ANOTHER_SCRIPT_CONFIRMED`。
运行 `node --experimental-strip-types scripts/check-script-mocks.mjs` 验证脚本详情流程。
