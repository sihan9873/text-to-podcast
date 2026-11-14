# Text-to-Podcast 本地 LLM/TTS 整合报告

> 仓库：`sihan9873/text-to-podcast`
> 分支：`feat/local-tts-port`
> 基线：`integration/three-repositories`（`c55645b`）
> 代码 HEAD：`e690814`
> 日期：2026-11-11
> 状态：核心链路联调完成；报告提交后推送远程

---

## 1. 整合概述

本次工作以 `integration/three-repositories` 为基线，新建 `feat/local-tts-port`，目标是把本地 LLM/TTS 服务接入生成后端，并保持前端、账号服务和既有生成业务可用。

完成内容：

- 移植独立本地服务目录 `llm/`（8 个文件）与 `tts/`（36 个文件）。
- 移植 `local_llm.py`、`local_tts.py` 两个 Adapter 到 `generation-backend/app/integrations/`。
- 完成 `generation-backend` 的配置、任务快照、Worker 分发和 seed 角色接线。
- 修复前端 generation API 前缀、Vite 代理、音频播放/下载的 Cookie 鉴权链路。
- 补充 LLM/TTS 配置示例和联调文档。

### 1.1 前端边界

- **移植阶段**：对 `frontend/` 的修改为 **0**，没有破坏前端业务实现。
- **联调阶段**：最终提交仅修改 3 个前端文件，用于请求路径和代理适配：
  - `frontend/vite.config.ts`
  - `frontend/src/api/generationBackend.ts`
  - `frontend/src/app/PodcastWorkflow.tsx`
- 这 3 个文件不改变页面业务逻辑，只修正代理、API 前缀和音频资源地址。

### 1.2 提交记录

| Commit | 说明 |
|---|---|
| `88ea601` | port local LLM and TTS services |
| `c9d2fa3` | wire local LLM/TTS into generation-backend |
| `5e65e7d` | seed local TTS roles and document mock engine config |
| `e690814` | complete local TTS integration, fix auth, proxy and audio playback issues |
| 本次 docs commit | add integration and deployment report |

所有提交作者为 `Sihan Chen <2567922348@qq.com>`。

### 1.3 变更规模

相对 `integration/three-repositories`：

```text
64 files changed, 3553 insertions(+), 16 deletions(-)
A = 56
M = 8
D = 0
```

其中 `frontend/` 为 3 个修改文件；本报告作为新增文档另计 1 个路径，不计入上述 64 个代码/配置路径。

---

## 2. 核心验证成果

### 2.1 账号与认证

已打通账号服务 Cookie 登录链路：

```text
POST /api/auth/login          → 8000 账号服务
  → 设置 HttpOnly session cookie（Path=/api）
  → 前端通过 Vite /api/auth 代理登录
  → 生成 API 通过 TEXTCAST_AUTH_URL 调用 /api/auth/me
```

验证结果：

- 目标仓库的写权限已确认。
- `backend` 账号服务运行在 8000。
- 生成 API 运行在 8001，配置 `TEXTCAST_AUTH_URL=http://127.0.0.1:8000`。
- 修改代理后重新登录一次，Cookie 以 `localhost` 域重新签发。

### 2.2 全链路

已完成：

```text
新建项目
  → 提交原文
  → 生成脚本（LLM_PROVIDER=mock）
  → 确认脚本
  → 音频合成（AUDIO_PROVIDER=local_http，LOCAL_TTS_ENGINE_ID=mock）
  → Worker 调度
  → 本地 TTS mock 合成
  → FFmpeg MP3 编码
  → 前端播放/下载
```

关键结果：

- 脚本任务、音频任务均成功。
- 音频任务返回 `asset_id=3`、`audio_version_id=5`。
- Worker 实际调用本地 TTS 的 `/v1/engines`、`/v1/voices`、`/v1/synthesize`。
- FFmpeg 完成 PCM → MP3 编码，产物可播放、可下载。

### 2.3 音频产物

```text
路径：
generation-backend/data/assets/567a70c4-87da-4daa-a754-1e76d666236f.mp3

大小：13,101 字节
时长：816 ms
格式：MP3, 24 kHz, mono, 128 kb/s
SHA256：b6772954dfa0e00a3048d035da6060c5180620f0fccea2aef89431899080ef3a
```

数据库 `assets` 记录与磁盘文件一致：

- `user_id=2`
- `status=ready`
- `size_bytes=13101`
- `duration_ms=816`
- `sha256` 与文件哈希一致
- `metadata.provider=local_http`，`engine_id=mock`，`real_speech=false`，`chunk_count=3`

### 2.4 前端验证

- `pnpm check` 通过：
  - Lint：8 个 warning，**0 error**
  - 单元测试：4 个文件，**18/18 通过**
  - 构建：`vite build` 成功，约 1994 个模块
- 联调补丁后 `tsc -b` 通过。
- 音频播放/下载统一使用 `/api/v1/audio-assets/...`，通过 Vite 同源代理携带 Cookie。
- 修复后 `/api/admin/users` 代理验证结果由 `404` 变为 `401 AUTH_REQUIRED`，说明请求已正确到达 8000 账号服务。

### 2.5 验证边界

本轮完成的是**核心闭环验证**，未运行 `generation-backend` 全量 `pytest`，也未安装真实 Qwen 模型权重。当前结论适用于“整合链路可运行、前端可演示”，不等同于真实语音质量验收。

---

## 3. 联调解决的 3 个关键问题

### 3.1 跨端口代理与 Cookie 丢失

问题：

- 账号服务在 8000，生成 API 在 8001，浏览器只访问 5173。
- 需要通过 Vite 代理把 `/api/auth` 和业务接口分流到不同端口。
- 登录 Cookie 默认域与浏览器访问域不一致，导致跨端口请求丢失 Cookie。

解决：

- Vite 增加 `cookieDomainRewrite: 'localhost'`。
- 前端统一通过同源相对路径访问，避免跨域。
- 代理修改后要求重新登录，确保 Cookie 以 `localhost` 重新签发。

### 3.2 音频播放 401 鉴权

问题：

- 登录 Cookie 的 `Path=/api`。
- 原播放器使用 `/generation/audio-assets/...`，浏览器不会把 `/api` Cookie 发送到 `/generation`。
- 即使 Vite 将 `/generation` 重写到 `/api/v1`，重写发生在浏览器之后，无法补发 Cookie。

解决：

- 音频播放/下载 URL 改为 `/api/v1/audio-assets/...`。
- 保持与 Cookie 的 `Path=/api` 匹配，并在 Vite 中配置 `cookieDomainRewrite`。

### 3.3 Admin 接口代理 404

问题：

- `/api/admin/users` 属于 8000 账号服务。
- Vite 原兜底规则 `/api` 指向 8001 生成 API，导致请求返回 404。
- Vite 按配置顺序匹配，`/api` 会截胡后续所有 `/api/*`。

解决：

- 在 `/api` 之前增加 `/api/admin` 规则，指向 8000。
- 保持 `/api/auth` 也在 `/api` 之前。
- 最终代理顺序：

```ts
server: {
  proxy: {
    '/api/auth': {
      target: 'http://127.0.0.1:8000',
      changeOrigin: true,
      cookieDomainRewrite: 'localhost',
    },
    '/api/admin': {
      target: 'http://127.0.0.1:8000',
      changeOrigin: true,
      cookieDomainRewrite: 'localhost',
    },
    '/api': {
      target: 'http://127.0.0.1:8001',
      changeOrigin: true,
      cookieDomainRewrite: 'localhost',
    },
    '/generation': {
      target: 'http://127.0.0.1:8001',
      changeOrigin: true,
      cookieDomainRewrite: 'localhost',
      rewrite: path => path.replace(/^\/generation/, '/api/v1'),
    },
  },
},
```

验证：

```text
修改前：GET /api/admin/users → 404 RESOURCE_NOT_FOUND（8001）
修改后：GET /api/admin/users → 401 AUTH_REQUIRED（8000）
```

浏览器登录后应返回 200。

---

## 4. 启动拓扑（5 个服务）

### 4.1 拓扑图

```text
Browser (http://localhost:5173)
  │
  ├─ /api/auth  ─────────────→ 8000  backend 账号服务
  ├─ /api/admin ─────────────→ 8000  backend 账号服务
  ├─ /api        ─────────────→ 8001  generation-backend API
  └─ /generation ──rewrite───→ 8001  /api/v1/*

generation-backend API :8001
  ├─→ 8000 /api/auth/me        （TEXTCAST_AUTH_URL）
  └─→ 8002 /v1/*               （LOCAL_TTS_BASE_URL，本地 TTS）

generation-backend Worker
  ├─→ SQLite: generation-backend/data/backend.sqlite3
  └─→ 8002 本地 TTS

Frontend :5173
  └─→ Vite proxy → 8000 / 8001
```

### 4.2 服务与端口

| 服务 | 端口 | 说明 |
|---|---:|---|
| `backend` 账号服务 | 8000 | 登录、Cookie、`/api/auth`、`/api/admin` |
| `generation-backend` API | 8001 | 项目、脚本、音频任务、音频资源 |
| `generation-backend` Worker | 无端口 | 消费任务，调用 TTS，执行 FFmpeg |
| 本地 TTS 服务 | 8002 | `tts_service.app:app`，当前 mock 引擎 |
| 前端 Vite dev server | 5173 | React 页面，代理到 8000/8001 |

### 4.3 环境变量

| 变量 | 服务 | 值 |
|---|---|---|
| `TEXTCAST_AUTH_URL` | 生成 API、Worker | `http://127.0.0.1:8000` |
| `AUDIO_PROVIDER` | 生成 API、Worker | `local_http` |
| `LOCAL_TTS_BASE_URL` | 生成 API、Worker | `http://127.0.0.1:8002` |
| `LOCAL_TTS_ENGINE_ID` | 生成 API、Worker | `mock` |
| `LLM_PROVIDER` | 生成 API、Worker | `mock`（本轮不启动 LLM 服务） |
| `FFMPEG_BINARY` | 生成 API、Worker | 指向可执行的 `ffmpeg.exe` |
| `VITE_API_BASE_URL` | 前端 | `/api` |
| `VITE_ENABLE_MOCK` | 前端 | `false` |

### 4.4 启动顺序

```text
1. backend 账号服务（8000）
2. TTS 服务（8002）
3. generation-backend API（8001）
4. generation-backend Worker
5. 前端 dev server（5173）
```

首次启动前，在 `generation-backend` 执行一次：

```powershell
.\.venv\Scripts\python.exe -m app.bootstrap
```

### 4.5 配置注意

1. **TTS 用 8002，不是 8001**：8001 已被生成 API 占用。API/Worker 必须显式设置 `LOCAL_TTS_BASE_URL=http://127.0.0.1:8002`。
2. 当前 `.env.example` 的 `LOCAL_TTS_BASE_URL` 默认仍可能是 8001，按本拓扑必须覆盖为 8002。
3. `FFMPEG_BINARY` 必须设置在 **API 进程**，因为音频配置快照在提交任务时生成；只设置在 Worker 不够。
4. 修改 `TEXTCAST_AUTH_URL` 后要同时重启 API 和 Worker。
5. Vite 代理修改后要重启/重载前端，并重新登录，让 Cookie 以 `localhost` 域签发。
6. 如果通过 `127.0.0.1:5173` 访问，`cookieDomainRewrite: 'localhost'` 不匹配，需改为 `127.0.0.1` 或置空。
7. 本轮 `LLM_PROVIDER=mock`，不启动 `llm/` 服务；8002 当前留给 TTS。若启用真实本地 LLM，需改用 8003 等端口，避免冲突。

---

## 5. 遗留说明

### 5.1 当前限制

| 项目 | 现状 | 影响 |
|---|---|---|
| 真实模型权重 | 未安装 Qwen LLM/TTS 权重 | 当前只能验证链路，不能验收真实语音质量 |
| 音频内容 | `LOCAL_TTS_ENGINE_ID=mock`，`real_speech=false` | 产物是确定性测试音，不是正文朗读 |
| 全量测试 | 未运行 `generation-backend` 全量 pytest | 当前验证范围是核心闭环，不是完整回归 |
| FFmpeg | 使用便携版 4.1-era 构建 | libmp3lame 已验证；若要求最新版需替换二进制 |

### 5.2 原项目文档与源码不一致

- `generation-backend/docs/openapi.json` 和 `API文档.md` 声称存在 `/api/v1/auth/login`。
- `generation-backend/app` 中并没有 auth 路由；实际认证依赖 `backend` 账号服务。
- 这是 integration 基线已有的“文档先行、代码未实现”问题，不是本次移植新增。

### 5.3 其他原项目遗留问题

- 前端缺少角色选择器，`PodcastWorkflow.tsx` 默认取 `/roles` 返回的 `items[0]`。
- 新 auth 用户首次访问时，生成后端会自动创建默认角色并复制 role 1 的 mock 配置；seed 中的 local_http 角色 2/3 属于 `development_user`。
- 真实联调时需要调整当前用户的 role `voice_config`，否则可能触发 `TTS_INVALID_VOICE_CONFIG`。
- 这是原项目角色 provisioning/前端选择器缺失导致的，不是本次 TTS Adapter 移植引入。

### 5.4 责任边界

- 本次移植没有修改 `backend/app/auth.py`、`backend/app/main.py` 等账号服务代码。
- 移植阶段对 `frontend/` 修改为 0；最终提交的 3 个前端文件仅修复代理、API 前缀和音频资源路径。
- 上述遗留问题在 `integration/three-repositories` 基线中已经存在，本次工作是对其进行联调适配，不是引入新的业务缺陷。

---

## 6. 结论

- 本地 LLM/TTS 服务、Adapter 和 generation-backend 接线已完成。
- 登录、项目、脚本、TTS、FFmpeg、前端播放/下载全链路已跑通。
- 跨端口 Cookie、音频 401、Admin 404 三个联调问题已修复。
- 代码已按功能提交，报告提交后推送 `origin/feat/local-tts-port`。
- 当前为 Mock 音频验证；真实语音质量需要后续安装模型权重并做专项验收。

---

*报告统计口径：`integration/three-repositories...e690814`，64 个代码/配置文件；本报告作为新增文档另计。*
