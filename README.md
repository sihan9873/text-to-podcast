# 文字转播客生成系统

本仓库是小组项目的统一代码库。系统目标是将中文原文转换为经过人工审核的播客脚本，再生成可播放、可下载的音频。

正式业务流程：

```text
导入/粘贴原文
  -> 大模型生成播客脚本
  -> 用户审核、编辑并确认脚本
  -> 选择音色、风格和语速
  -> 生成、播放和下载音频
```

## 目录结构

```text
text-to-podcast/
├─ frontend/           TextCast 前端项目
├─ backend/
│  └─ prototype/       Python 离线流程演示，不是正式后端
├─ docs/               需求、分工、审核与联调文档
├─ .github/            CI 和 Pull Request 模板
├─ CONTRIBUTING.md     团队协作规范
└─ README.md
```

## 运行前端

需要 Node.js 22.12+ 和 pnpm 11+。

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

打开终端输出的本地地址。开发环境默认启用 MSW 模拟接口，因此暂时不需要运行后端。

提交前检查：

```powershell
cd frontend
pnpm check
```

前端的页面、数据流和当前限制见 [`frontend/README.md`](frontend/README.md) 与 [`docs/frontend-review.md`](docs/frontend-review.md)。

## 运行后端原型

需要 Python 3.10+，离线模式无第三方依赖。

```powershell
cd backend\prototype
python test_demo.py
python server.py
```

该原型有自己的简单演示页面，只用于说明任务提交、状态轮询和音频获取过程，不能直接充当正式前端的后端。

## 项目资料

- [`docs/文字转播客生成系统_产品需求规格说明书.docx`](docs/文字转播客生成系统_产品需求规格说明书.docx)：需求基线。
- [`docs/frontend-review.md`](docs/frontend-review.md)：TextCast 前端审核结论。
- [`docs/integration-plan.md`](docs/integration-plan.md)：前后端接口和实施顺序。
- [`docs/分工.md`](docs/分工.md)：当前小组分工记录。

## 当前状态

- TextCast 前端可以启动和构建，现阶段主要由 Mock 数据驱动。
- “提交给 AI 修改”尚未调用真实大模型。
- 脚本保存和确认仍有前端缓存操作，需要改为服务端持久化。
- 试听、真实 TTS、数据库、受控下载和部署尚未完成。
- `backend/prototype` 默认只生成一秒测试音，不朗读正文。

开发新功能前请先阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
