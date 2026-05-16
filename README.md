# opencode-repl

一个轻量级的终端 REPL 客户端，用于与 [opencode](https://opencode.ai) AI 服务进行交互式对话。基于 Bun 运行时构建，通过 SSE 实时流式接收 AI 响应。

## 功能特性

- **会话管理** — 创建、切换、fork、列出历史会话
- **实时流式输出** — 基于 SSE 的 AI 响应流式渲染
- **斜杠命令** — 内置丰富的本地和远程命令
- **多行输入** — 支持行尾 `\` 续行和 `.` 结束的多行模式
- **文件附件** — 将本地文件附加到对话上下文
- **权限交互** — AI 操作需要授权时的交互式确认
- **模型切换** — 运行时动态切换 AI 模型
- **优雅中断** — `Ctrl+C` 中断当前流式输出或退出

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org) >= 18（附带 npm）
- 运行中的 opencode 服务（默认 `http://localhost:4096`）

### 安装

```bash
git clone <repo-url>
cd aizen-opencode
npm install
```

### 启动

```bash
npm run dev
```

## 使用文档

### CLI 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--url <url>` | opencode 服务地址 | `http://localhost:4096` |
| `--dir <path>` | 项目目录 | 当前工作目录 |
| `--session <id>` | 指定恢复的会话 ID | — |
| `--new` | 强制创建新会话 | `false` |
| `--thinking` | 显示 AI 思考过程 | `false` |
| `--help, -h` | 显示帮助信息 | — |
| `--version, -v` | 显示版本号 | — |

### 斜杠命令

在 REPL 中输入 `/` 开头的命令：

| 命令 | 说明 |
|------|------|
| `/sessions [n]` | 列出最近的会话（可选数量限制） |
| `/switch [id]` | 切换到指定会话（无参数时弹出选择器） |
| `/new [title]` | 创建新会话 |
| `/fork [message_id]` | Fork 当前会话 |
| `/history [n]` | 查看最近 n 条消息（默认 10） |
| `/file <path>` | 附加文件到当前对话 |
| `/files` | 列出已附加的文件 |
| `/clear-files` | 清空附加文件列表 |
| `/model [name]` | 查看或切换模型 |
| `/info` | 显示当前会话信息 |
| `/quit` | 退出 REPL |

其他未识别的斜杠命令会作为远程命令发送给 opencode 服务。

### 多行输入

两种方式进入多行模式：

1. **反斜杠续行** — 行尾输入 `\`，下一行继续输入
2. **点号结束** — 进入多行模式后，单独输入 `.` 提交内容

## 项目架构

```
src/
├── index.ts          # CLI 入口，参数解析与初始化
├── repl.ts           # REPL 主循环，事件处理与状态机
├── client.ts         # opencode SDK 客户端封装
├── state.ts          # 数据模型（Config, Session, Multiline, ReplState）
├── format.ts         # 终端输出格式化工具函数
├── commands/
│   ├── slash.ts      # 斜杠命令解析与路由
│   └── prompt.ts     # AI 提示执行引擎（SSE 事件循环）
└── __tests__/        # 单元测试与集成测试
```

**核心流程：**

1. `index.ts` 解析 CLI 参数，创建客户端，建立或恢复会话
2. `repl.ts` 启动 readline 交互循环，管理状态机（Idle → Streaming → AwaitPerm → Idle）
3. 用户输入通过 `slash.ts` 路由到本地命令或远程命令
4. 非命令输入通过 `prompt.ts` 的 SSE 事件循环发送给 AI 并流式渲染响应

## 贡献

欢迎参与贡献！请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解开发流程与规范。

## 许可证

[MIT](./LICENSE)
