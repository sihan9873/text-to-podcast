# 来源、许可与交付范围

## 上游来源

业务后端来自 `Cabite/text-to-podcast-backend`，基线提交
`6708347dfcd6d930cc2ff37bf77b21e858af2274`，保留项目、脚本、数据库任务、
租约、幂等和音频发布机制。HTTP TTS 服务及其适配代码从本机 podcast 项目整理而来。
仓库已包含完整接入代码，不需要额外应用历史补丁或复制另一份后端。

`backend/fixtures/test_audio.mp3` 是上游自带的合成测试音，Git blob SHA 为
`c532868036a4a0ea6a0cf5046bc95642b0ef8512`，是唯一提交到源码中的音频素材。
它仅用于固定 Mock 回归测试，不作为真实合成结果。

## Qwen 模型与依赖

脚本模型为 [Qwen/Qwen2.5-0.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct)，
固定提交 `7ae557604adf67be50417f59c2c2f167def9a775`，模型许可证为 Apache-2.0。
显式下载工具保存模型 LICENSE、版本和逐文件 SHA256；权重不随源码提交。

语音模型为 [Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice)，
本机部署复用已有完整权重，不复制或修改原模型目录。模型与 SDK 的许可分别适用。
本次验收环境使用 `qwen-tts 0.1.1`、`transformers 4.57.3`、
`huggingface-hub 0.36.2` 和已有 `torch 2.10.0+cu128`。

LLM 使用独立 Conda 环境 `podcast-llm`，从已有 `podcast-tts` 离线克隆；
未修改原环境、CUDA/PyTorch 或全局 Python。早期临时 `.venv` 已移除。
后端只使用 HTTP，不导入模型 SDK；用户级临时 systemd 单元托管本机服务，不设置开机自启。

## 当前交付与验证

交付内容包括 Qwen 脚本服务、后端 `ScriptGenerator` HTTP 适配、模型与配置快照、
真实 TTS 启动、结构化输出校验、脚本 JSON/TXT 导出、MP3 生成验证，以及测试和配置示例。
默认部署示例选择真实 Qwen，Mock 路径保留用于显式测试，不在生成失败时降级冒充真实结果。

- [回归测试记录](validation.json) 覆盖后端、TTS、LLM 和跨模块工具。
- [早期 LLM 与 Conda 迁移记录](llm-validation.json) 中的音频阶段使用 Mock。
- [完整真实 Qwen 记录](qwen-validation.json) 验证 Qwen LLM、Qwen TTS、数据库任务及 MP3 解码。

真实推理和可解码不代表台词、事实、发音或音色已通过人工验收；完整文件仍需试听。
本分支未包含前端或正式鉴权，未声称完成前端、MySQL 或 LAN 部署验收。

不提交真实 `.env`、密钥、数据库、模型权重、参考录音、生成脚本/音频、缓存或环境。
本机已有资产与运行产物保留，源码导出工具同样排除这些内容。
上游后端和本项目尚未设置统一项目 LICENSE，本次不替团队添加许可证。
