# 来源与整理范围

业务后端来自 Cabite/text-to-podcast-backend，基线提交
`6708347dfcd6d930cc2ff37bf77b21e858af2274`，包含本地 HTTP TTS 接入改动。
本次使用本机完整工作副本的源码，不复制 .git、.env、数据库和运行产物。
`backend/fixtures/test_audio.mp3` 是上游自带的合成测试音，不是用户录音；
Git blob SHA 为 `c532868036a4a0ea6a0cf5046bc95642b0ef8512`。

TTS 服务、Qwen/Mock 适配器及跨服务验证工具来自本机 podcast 项目。
整理只调整目录与测试/文档路径；模型服务和业务后端通过 HTTP 连接。
不重复提交旧的 integrations 后端快照与 patch，新仓库克隆后无需再应用 patch。

不包含远程仓库的示例前端/原型，不在本次声称已完成前端联调或真实 LLM 接入。
该目录供新分支审阅；未向 GitHub 写入任何对象或创建远程分支。

上游后端和本项目尚未设置统一项目 LICENSE，本次不替团队添加许可证。
Qwen SDK/模型按其独立许可使用；本交付不分发模型权重。

整理时省去两份上游旧 OpenAPI 生成快照，实际契约使用运行时 /openapi.json。
默认配置示例改为 local_http + mock，先验证链路再显式切换 Qwen。
根 tests/ 的路径及源码导出工具已适配 backend/tts 同仓库布局。
