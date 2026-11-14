# 前端与生成后端接口对照

此文记录本地集成分支的实际接线。完整目标接口见 [后端设计](../generation-backend/docs/API文档.md)。后端同时提供静态 OpenAPI 文件，确认当前实现时以生成 API 的运行时 /openapi.json、路由代码和实际响应为准。配置类接口有路由但可能返回 501。

## 服务入口

- 账号和用户管理请求走 /api，由 Vite 代理到 8000。账号会话使用 Cookie。
- 生成页面请求走 /generation，由 Vite 代理到 8001 并改写为 /api/v1。下表以生成服务路径为准，省略 /api/v1。
- 生成 API 通过 TEXTCAST_AUTH_URL 校验登录会话，沿用账号身份。生成业务 ID 为整数，账号服务 ID 为字符串。业务 JSON 从响应的 data 字段取值，播放和下载直接返回 MP3。

## 当前页面调用

| 方法和路径 | 页面用途及字段 |
| --- | --- |
| GET /projects | 列表与最近项目，读取 items、total、project_id、title、updated_at 及当前产物 ID |
| POST /projects | 新建项目，发送 title，按返回的 project_id 打开详情 |
| GET /projects/{id} | 读取原文、当前脚本、最新音频和活动任务，刷新时恢复 |
| PUT /projects/{id}/source | 发送 text，最多 5000 字符，成功后锁定 |
| GET /roles | 取当前用户的默认主持人 profile_id |
| POST /projects/{id}/script/generate | 发送 roles，其中包含数字 profile_id 和 role_key，返回 task_id |
| GET /tasks/{id} | 轮询 queued、running、succeeded 或 failed，失败时读取 error_message |
| GET /scripts/{id} | 展示标题和台词，读取 version、edit_revision 和 status |
| POST /scripts/{id}/confirm | 发送 expected_script_version 和 expected_edit_revision |
| POST /projects/{id}/audio/generate | 发送 script_id 和同一组版本字段，返回 task_id |
| GET /audio-assets/{id}/play | 通过同源 Cookie 播放 |
| GET /audio-assets/{id}/download | 通过同源 Cookie 下载 |

两个生成 POST 都携带 Idempotency-Key。当前页面每次发起生成都会生成一个新键。若添加自动重试，同一次提交应复用原键。

## 差异和后续范围

- 当前最小模拟流程所需的业务路由均已接线。此前以 HTTP 验证了登录、生成、下载及跨账号隔离，前端构建已通过。浏览器逐步点击仍待验收。
- 旧项目、脚本和音频组件中还有面向旧契约的调用。当前项目路由使用 PodcastWorkflow。这些组件若重新挂载，需要重新核对接口和数据结构。
- 若恢复原有编辑能力，需补项目改名、服务端 TXT 上传、脚本编辑、取消确认、脚本和音频历史、前三句试听、逐句进度及片段候选。项目详情当前只展示当前脚本和最新完整音频。
- 后端支持传入角色列表和重新提交生成任务。页面仅使用默认主持人，生成脚本成功后也没有重新生成入口。
- 可用但业务页面未调用的独立路由包括存活和就绪检查。就绪检查覆盖数据库初始化，Worker 在线状态需要单独确认。
- 模型、密钥、项目模型配置、角色配置管理、TTS 配置和音色查询属于预留路由。GET /roles 角色列表已可用，其余配置路由返回 501。
- /generation 的转发目前由 Vite 开发服务提供。部署静态页面时需要在部署环境配置相同的转发规则。
