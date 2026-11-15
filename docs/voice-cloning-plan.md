# 语音克隆接入分析与实施计划

分析日期：2026-11-14。基线：`integration/final`，提交 `203799ffdd3a76d7140ed3de159b45cacf609c0b`。

执行更新：`feat/voice-cloning` 已实现认证适配、私有声音库、Base 引擎、角色绑定、试听和正式生成接线；下文保留分析时的现状。当前部署方法与真实模型待验收项见 [语音克隆说明](voice-cloning.md)。

本文是实施建议，尚未实现语音克隆。终端无法直连 GitHub，已通过 GitHub 连接器读取远端提交、递归文件树和缺失 blob，并复用本地哈希完全相同的文件，还原单提交浅克隆；228 个文件的 Git blob、完整 tree 和带签名 commit 均与远端一致。原有 `../text-to-podcast` 工作区及其未提交修改未改动。

## 1. 当前架构与可复用部分

```text
浏览器 React / TypeScript :5173
  ├─ /api/auth、/api/admin → backend :8000（账号、Cookie 会话）
  └─ /api → generation-backend :8001（项目、脚本、任务、资源）
               └─ 数据库任务队列 → 独立 Worker
                                    ├─ HTTP → llm :8003（建议部署端口）
                                    └─ HTTP → tts :8002
                                                └─ WAV → Worker / FFmpeg → MP3
```

- 业务服务与模型服务独立进程、独立环境；`generation-backend/app/integrations/local_tts.py` 不导入模型 SDK。
- `jobs/repository.py` 实现幂等提交、项目活动任务互斥、输入快照、租约和过期恢复；`jobs/handlers.py` 防止失效 Worker 发布结果。
- 角色模板通过 `RoleProfile.voice_config` 复制到 `ScriptRole`，生成音频时再次进入任务和音频版本快照，适合加入不可变克隆声音版本引用。
- TTS 具有引擎注册、能力发现、延迟加载和统一错误响应；`EngineInfo.supports_cloning` 已预留，但所有现有引擎均未实现克隆。
- `LocalTTSAudioGenerator` 已支持按句切块、换角色停顿、WAV 校验、重采样、MP3 编码和最终解码校验。
- 前端已有角色管理页 `Role.tsx` 和声音编辑弹窗 `RoleVoiceEditorDialog.tsx`，适合新增声音库入口。

## 2. MVP 状态判断：存在基础，不能直接视为真实端到端验收完成

| 发现 | 源码依据 | 对实施的影响 |
| --- | --- | --- |
| 当前前端认证契约与账号服务不一致 | `frontend/src/api/client.ts` 要求 `{code:"OK",data:...}`；`backend/app/auth.py` 返回 `{user,expiresAt}`，退出返回 204；注册字段为 `displayName`，前端为 `display_name` | 先对齐认证客户端和类型，Cookie 会话必须真实验证；CSRF 需形成统一实现，不能仅发送一个实际不存在的 token |
| 角色增改删和业务音色列表仍为 501 | `generation-backend/app/api/configuration.py` | 页面存在不代表可持久化，克隆绑定必须补齐这些接口 |
| 当前模型仅支持预设音色 | `tts/tts_service/qwen.py` 只接受 `custom_voice` / `0b6`，调用 `generate_custom_voice` | 新增 Base 适配器，不能只替换模型路径 |
| 请求协议拒绝参考音频 | `tts/tts_service/app.py` 严格字段校验；合成前要求 `voice_id` 属于引擎列表 | 增加受控声音版本解析和克隆请求分支，保持已有合成请求兼容 |
| 单任务固定一个引擎 | `local_tts.py` 强制每个角色 `tts_model == audio_config.engine_id` | 首版支持 Base 内多个克隆声音；CustomVoice 与 Base 混用另加角色级路由 |
| 修改模板不会改变已生成脚本 | `jobs/repository.py` 和 `jobs/handlers.py` 深拷贝角色配置 | 首版要求生成脚本前选定克隆声音；直接修改已有脚本需要补脚本角色保存、取消确认和修订控制 |
| 页面能力多于真实路由 | 前端调用脚本列表、保存、取消确认、音频试听、版本详情等；生成 API 当前只提供其中最小子集 | 列出首版必需路由并逐个联调，明确未实现入口，不把所有页面当成可用功能 |
| 部署默认端口有旧值 | `generation-backend/app/core/config.py` 默认 TTS=8001、LLM=8002，与整合拓扑不同 | 固定部署示例为账号 8000、生成 8001、TTS 8002、LLM 8003，API 与 Worker 同步配置 |
| 长文输入不等于长文生成完成 | 输入允许 100,000 字；本地 LLM 和脚本结果仍限制 5,000 字 | 克隆验收先用短文；逐段 LLM 汇总属于独立工作 |

`INTEGRATION_REPORT.md` 记录的是旧前端、Mock LLM 和 Mock TTS 的历史闭环；`docs/qwen-validation.json` 另有模型专项记录，但不能替代当前前端、双后端及真实模型的整体验收。本次未加载真实模型，不能评价实际音质与速度。

## 3. 模型路线与首版范围

建议优先接入 **Qwen3-TTS-12Hz-0.6B-Base 零样本克隆**，与现有 Qwen SDK 路线保持一致；以 0.6B 做资源和音质实测，必要时再评估 1.7B。这里不承诺显存占用或实时率。

Qwen 官方区分 CustomVoice 与 Base：克隆由 Base 的 `create_voice_clone_prompt` / `generate_voice_clone` 完成；参考音频加对应转写文本可建立可复用 prompt；仅 speaker embedding 的模式无需转写，但质量可能下降。因此首版要求用户填写并核对参考文本，省去 ASR 依赖。

首版用户流程：上传本人或已获授权的短录音 → 填写原话、命名 → 保存私有声音 → 短句试听 → 绑定角色 → 生成并确认脚本 → 生成整段播客 → 播放与下载。

- 建议产品限制：WAV/MP3、解码后 3–30 秒、上传最大 10 MiB；这些是拟定的产品约束，需由 PoC 调整，不是模型的硬性参数。
- 首版选择文件上传；浏览器录音、自动转写、微调训练、声音市场、实时流式合成后续再做。
- 首版音频任务支持全部角色使用 Base 的不同声音版本；原 CustomVoice 流程继续可用。预设声音与克隆声音混用列入后续阶段并单独验收。
- 不要求先补齐所有页面高级功能；聚焦登录、角色选择、脚本生成与确认、全量音频生成、播放下载所必需的调用。

## 4. 数据、存储与服务契约

### 4.1 声音资源

新增 `VoiceProfile`（用户声音）和不可变 `VoiceVersion`（参考素材版本）：

- Profile：`id`、业务 `user_id`、名称、当前版本、启用/停用状态、创建时间。
- Version：`id`、profile 引用、参考音频资源引用、转写文本、语言、音频 SHA256、引擎/模型修订、采样率、时长、授权确认时间。
- 参考音频作为私有资源独立保存，可扩展现有 `Asset.kind=voice_reference`；不可复用只允许播放 `full_audio` 的现有资源接口。
- 标准化音频先写临时文件、校验、原子发布；失败补偿清理文件和记录。原始文件若保留，明确用途与清理策略。
- 同一 version 不覆盖文件或转写文本，修改素材生成新版本。`voice_config` 引用 `voice_version_id`，任务快照保存该 ID、内容哈希和模型修订。
- 模板停用只阻止新任务选择；已确认脚本引用需明确报错或继续使用保留版本。首版禁止物理删除仍被角色、脚本或进行中任务引用的版本；生成好的 MP3 保留播放能力。

### 4.2 拟新增业务接口（均经过账号会话验证和资源归属检查）

| 接口 | 用途 |
| --- | --- |
| `POST /api/v1/voice-profiles` | multipart 上传参考音频、名称、参考文本、语言和授权确认；仅做有界解码与保存，不在此请求加载模型 |
| `GET /api/v1/voice-profiles` | 当前用户私有声音列表及状态 |
| `GET /api/v1/voice-profiles/{id}` | 声音详情；不返回服务器路径 |
| `PATCH /api/v1/voice-profiles/{id}` | 改名或停用 |
| `POST /api/v1/voice-profiles/{id}/preview` | 提交有长度限制的短句试听任务，使用幂等键 |
| `GET /api/v1/voices` | 将预设声音、当前用户克隆声音和真实能力映射成前端 `VoiceItem` |
| 既有 `POST/PATCH/DELETE /api/v1/roles...` | 实现模板管理及克隆声音归属、版本、状态校验 |

声音试听复用数据库任务机制，但当前 `Task.project_id` 必填、任务类型仅有 script/audio，不能直接套用现有 submit。需显式迁移：允许 voice_preview 类型无 project，增加声音版本引用；project 任务仍保留活动任务约束，试听使用用户配额、幂等键、租约和独立发布检查。更新 schemas、Worker 分发、恢复、任务视图和鉴权，避免伪造一个隐藏项目。

### 4.3 TTS 内部协议

- 新增 `Qwen3BaseEngine`，单独验证 Base 模型类型和本地文件完整性，设置 `supports_cloning=true`，延迟加载。
- 保留旧 `/v1/synthesize` 请求。新增克隆合成路径或显式版本化请求模型，字段包含 `engine_id`、`voice_version_id`、`text`、`language`；不通过通用 `extra_params` 偷渡文件路径。
- 首版采用同机私有参考音频目录：生成后端管理文件与所有权，TTS 通过服务端配置的只读根目录及受控相对对象键读取；目录必须显式配置。请求中不接受浏览器提供的任意路径或 URL，解析后再次检查根目录边界。
- 业务 API 校验 owner，只有可信 Worker 能调用内部克隆路径；默认回环地址，跨机部署另加服务鉴权及受控素材传输，不能直接假设两端共享绝对路径。
- Base 没有预设 speaker 列表，克隆分支应验证声音版本解析结果，不能继续要求它出现在 CustomVoice 的 speaker 列表中。业务 `/voices` 按用户过滤，TTS 不向客户端枚举全体用户声音。
- 首次合成构造 prompt，进程内有界缓存，缓存键包含声音版本、素材哈希、参考文本哈希及模型修订。重启可重新计算，首版不上传/反序列化用户 prompt 文件。
- Base 与 CustomVoice 若使用同一 GPU，使用共享推理锁并限制模型驻留；不同引擎各自持锁不足以避免同时占显存。混合引擎任务进入下一阶段前实测常驻与切换成本。

## 5. 实施顺序与交付

| 阶段 | 工作与主要文件 | 完成标准 |
| --- | --- | --- |
| P0：验证基线 | 认证契约、端口、必需路由；`frontend/src/api/{client,auth,types}.ts`、配置文档 | 关闭 MSW 后，新前端完成登录→短文→脚本确认→现有音频播放下载；分别标注 Mock 和真实模型证据 |
| P1：模型 PoC | 新增 `tts/tts_service/qwen_base.py`，修改 `configured.py`，隔离模型路径配置 | 用授权录音和准确转写合成至少三句中文，记录显存峰值、冷启动、热推理耗时和听感；失败则调整素材/模型，不先铺全栈 |
| P2：业务与声音库 | models、Alembic、私有音频存储、声音接口、角色接口、`/voices`、voice_preview 任务迁移 | 上传→保存→列表→试听→角色绑定可用；跨用户不可访问；重启后声音仍可用 |
| P3：正式生成接入 | `local_tts.py`、`jobs/repository.py`、Worker、快照校验 | 两个 Base 克隆角色生成可解码 MP3；任务引用固定版本；模型失败时明确失败，旧音频和脚本可保留 |
| P4：前端和回归 | `Role.tsx`、新声音库组件、`RoleVoiceEditorDialog.tsx`、API types/MSW | 新用户无需手工改数据库即可上传、试听、绑定、生成和下载；UI 不展示本次未实现的操作 |
| P5：混合引擎（后续） | 将 audio config 从单引擎改为角色级路由；按角色查能力、分块限制和模型；统一 GPU 调度 | 预设主持人 + 克隆嘉宾生成完整音频；验证显存、切换耗时及超时处理 |

建议拆成五个小 PR：基线契约修复；Base 引擎 PoC；声音资源及业务接口；任务与正式生成；前端联调。混合引擎另开 PR。模型/环境就绪时，首版粗估 5–8 个有效工作日；模型音质调优、基线缺陷和混合模型资源问题可能增加时间，PoC 后再重估。

## 6. 验证与验收

- 无模型测试：SDK 调用参数和 Base/CustomVoice 类型拒绝、延迟加载、缓存隔离、忙碌/OOM/缺失权重错误；health 和列表不加载权重、不触发下载。
- API/数据库：音频真实解码、超长/空白/静音或损坏文件、上传限制、路径越界、跨用户访问、版本不可变、引用删除规则、重试幂等及新任务类型迁移。
- Worker：试听和正式生成租约续期、过期恢复、重复消费不重复发布、上游超时后仍在推理的忙碌处理、失败清理、声音停用与任务快照一致性。
- 回归：现有 Mock、CustomVoice、脚本确认和 MP3 下载；前端 MSW 与真实服务分别检查。
- 真实验收：至少两位授权说话人、每人多条参考录音；测试未出现在参考中的中文句子、数字/英文混读及 2–3 分钟多角色播客；记录漏字、重复、声线漂移、接缝和人工音色相似度反馈。
- 质量、延迟、显存阈值在 PoC 后按实际机器制定。可播放不等于克隆质量通过，测试音不计入真实合成通过。
- 本次仅分析与轻量检查，不安装依赖、不下载权重、不运行 GPU 推理、不修改应用实现；执行结果见本文后续补充记录。

### 本次实际检查记录

- Git：提交 SHA、tree SHA、全部 228 个文件内容均校验一致；`git fsck` 未报告缺失或损坏对象，仅有还原过程产生的未引用临时对象。浅克隆不包含父提交历史。
- LLM：在 `llm/` 使用既有 `podcast-tts-service` 环境运行 `python -m unittest discover -s tests -v`，5/5 通过，未加载真实模型。
- TTS：既有轻量环境没有 pytest，改用仓库支持的 unittest；前四项完成，第五项 `test_configured_service_aliases_and_boundaries` 未返回，已人工中断。完整 TTS 测试结论为未完成。
- 账号和生成后端：既有 `podcast-backend` 环境中启动 `python -m pytest -q`，未输出测试结果且持续不返回，已人工中断；没有据此认定测试通过或断言业务失败。该环境 FastAPI 0.162.2 / Starlette 1.10.0，不代表仓库锁定依赖；挂起原因待隔离环境诊断。
- 前端：已阅读 API、页面与代理配置；本次未安装依赖、未执行构建或浏览器联调。
- 文档：`git diff --check` 通过；工作区仅新增本计划文件。

## 7. 官方技术依据

- Qwen3-TTS 模型分类、Base 克隆、参考音频/文本、可复用 prompt：[官方 README](https://github.com/QwenLM/Qwen3-TTS/blob/main/README.md)。
- Base 推理参数及模型类型约束：[官方实现](https://github.com/QwenLM/Qwen3-TTS/blob/main/qwen_tts/inference/qwen3_tts_model.py)。
- 仓库目前适配固定 SDK 路线；实施前核对既有环境 SDK 版本与上述 API，避免直接升级整个 CUDA/PyTorch 环境。
