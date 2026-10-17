# 文字转播客生成系统贡献指南

## 开始开发

1. 从最新 `main` 创建分支。
2. 前端开发进入 `frontend/`，执行 `pnpm install --frozen-lockfile`。
3. 在小范围内完成一个可审查的变更。
4. 前端提交前在 `frontend/` 运行 `pnpm check`；后端原型变更运行 `python backend/prototype/test_demo.py`。
5. 推送分支并创建 Pull Request。

## 分支命名

- `feat/简短主题`：新功能
- `fix/简短主题`：缺陷修复
- `docs/简短主题`：文档
- `refactor/简短主题`：不改变行为的重构
- `test/简短主题`：测试

## 提交信息

采用 `类型: 摘要` 格式，例如：

```text
feat: 接入脚本生成任务接口
fix: 禁止未确认脚本生成音频
docs: 补充本地联调说明
```

## Pull Request 要求

- 一个 PR 只解决一个主题。
- 描述需求编号，例如 FR11、FR12。
- 说明用户可见变化、接口变化和验证方法。
- 页面变化附截图；接口变化附请求与响应示例。
- 不提交 `node_modules`、`dist`、真实密钥、个人配置或大体积临时文件。
- 至少一名组员审核后再合并。

## 完成标准

- `frontend/` 下的 `pnpm typecheck` 通过。
- `frontend/` 下的 `pnpm lint` 无错误。
- `frontend/` 下的 `pnpm build` 通过。
- 新增或修改流程覆盖正常、空输入、失败和重试场景。
- 任务状态、脚本版本和音频版本之间的关联符合需求规格说明书。
- Mock 与真实接口契约同步更新。
