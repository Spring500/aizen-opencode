# 贡献指南

感谢你对 opencode-repl 的关注！以下是参与贡献的指南。

## 开发环境搭建

```bash
# 克隆仓库
git clone <repo-url>
cd aizen-opencode

# 安装依赖
bun install

# 启动开发
bun run dev
```

### 环境要求

- [Bun](https://bun.sh) >= 1.0
- [TypeScript](https://www.typescriptlang.org/) >= 5.7
- 运行中的 opencode 服务用于集成测试

## 代码风格

- TypeScript 严格模式
- 使用双引号字符串
- 函数式风格优先，避免 class
- 不添加非必要注释

## 运行测试

```bash
# 运行全部测试
bun test

# 类型检查
bun run typecheck
```

请确保提交前所有测试通过且类型检查无错误。

## 提交规范

使用语义化提交信息前缀：

| 前缀 | 用途 |
|------|------|
| `feat:` | 新功能 |
| `fix:` | Bug 修复 |
| `chore:` | 构建/工具/依赖变更 |
| `test:` | 测试相关 |
| `docs:` | 文档变更 |
| `refactor:` | 重构（不改变行为） |

示例：
```
feat: 添加 /compact 斜杠命令
fix: 修复多行输入空行丢失问题
```

## 如何提 Issue

- 描述你遇到的问题或期望的功能
- 如果是 Bug，请附上复现步骤和环境信息
- 如果是功能建议，请描述使用场景

## 如何提 Pull Request

1. Fork 本仓库并创建特性分支（`feat/xxx` 或 `fix/xxx`）
2. 编写代码并添加对应的测试
3. 确保 `bun test` 和 `bun run typecheck` 通过
4. 提交 PR 并描述你的改动

## 目录结构

详见 [README.md](./README.md#项目架构) 的架构说明部分。
