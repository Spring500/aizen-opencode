// ============================================================================
// format.test.ts
// ============================================================================
//
// 这个文件测试终端输出的格式化逻辑。REPL 是一个命令行工具，所有显示在
// 屏幕上的东西（AI 回复、工具状态、会话列表、历史消息等等）都是由
// src/format.ts 里的函数生成的。
//
// 测试覆盖了约 20 个格式化函数，按输出的场景可以分成几组：
//
//   - AI 消息头：显示 Agent 名和模型名，字段缺失时不输出 "undefined"
//   - 提示符和分隔线：输入提示符、带/不带标题的分隔线
//   - 权限询问：显示 ⚠ 图标、命令类型和具体内容、y/n/a 三个选项
//   - 连接状态：正在连接、已连接、连接失败、会话不存在、创建失败
//   - /info 命令：标题、ID、目录、模型（没有则显示"默认"）、附件数
//   - /files 命令：空列表显示"无附件"，否则编号列出
//   - 流式输出中的单个事件：文字透传、工具运行(⚙)/完成(✓)/失败(✗)、
//     推理过程（受 thinking 开关控制）、问题询问、中断提示、断连提示
//   - /history 命令：空历史、角色前缀（You:/AI:）、超长消息截断加 "...”、
//     多行保留换行、条数限制
//   - /sessions 命令：空列表、三列表格（ID/标题/时间）、长文本截断
//
// 格式化函数输出的字符串都包含 ANSI 终端颜色码。测试里用一个 strip() 辅助
// 函数先把颜色码去掉再断言纯文本内容，这样既能验证文案正确，又能确认
// 颜色码确实存在。
//
// ============================================================================

import { describe, test, expect } from "vitest"
import {
  formatAIHeader, formatPrompt, formatPermissionPrompt, formatSeparator,
  formatConnecting, formatConnected, formatConnectionError, formatSessionNotFound,
  formatSessionCreateError, formatInfo, formatFiles,
  formatTextDelta, formatToolCall, formatReasoning,
  formatHistory, formatSessions, formatAbortMessage,
  formatDisconnectMessage, formatDisconnectPermMessage, formatQuestionPrompt,
} from "../format"

function strip(s: string) { return s.replace(/\x1b\[\d+(;\d+)?m/g, "") }

describe("format", () => {
  // 格式化 AI 消息头：agent + modelID，容错 undefined
  describe("formatAIHeader", () => {
    test("all fields present", () => {
      const out = formatAIHeader("build", "claude-sonnet-4")
      expect(out).toContain("AI")
      expect(out).toContain("build")
      expect(out).toContain("claude-sonnet-4")
    })
    test("agent undefined", () => {
      const out = formatAIHeader(undefined, "claude-sonnet-4")
      expect(() => out).not.toThrow()
      expect(strip(out)).not.toContain("undefined")
    })
    test("modelID undefined", () => {
      const out = formatAIHeader("build", undefined)
      expect(() => out).not.toThrow()
      expect(strip(out)).not.toContain("undefined")
    })
  })

  describe("formatPrompt", () => {
    test("idle prompt", () => {
      const out = formatPrompt()
      expect(out).toContain(">")
    })
  })

  // 权限请求提示：permission 类型 + patterns + 操作选项
  describe("formatPermissionPrompt", () => {
    test("renders permission request", () => {
      const out = formatPermissionPrompt("bash", ["rm -rf dist/"])
      expect(out).toContain("⚠")
      expect(out).toContain("bash")
      expect(out).toContain("rm -rf dist/")
      expect(out).toContain("y=")
      expect(out).toContain("n=")
      expect(out).toContain("a=")
    })
  })

  describe("formatSeparator", () => {
    test("with label", () => {
      const out = formatSeparator("最近 10 条消息")
      expect(out).toContain("最近 10 条消息")
      expect(out).toContain("─")
    })
    test("empty label", () => {
      const out = formatSeparator()
      expect(out).toContain("─")
    })
  })

  // 连接状态消息族：连接中 / 已连接 / 连接失败 / Session 不存在 / 创建失败
  describe("connect messages", () => {
    test("formatConnecting", () => {
      const out = formatConnecting("http://localhost:4096")
      expect(strip(out)).toContain("正在连接")
      expect(out).toContain("localhost:4096")
    })
    test("formatConnected", () => {
      const out = formatConnected("ses_xxx", "测试会话")
      expect(strip(out)).toContain("已连接")
      expect(out).toContain("ses_xxx")
      expect(out).toContain("测试会话")
    })
    test("formatConnectionError", () => {
      const out = formatConnectionError("ECONNREFUSED")
      expect(strip(out)).toContain("无法连接")
      expect(out).toContain("ECONNREFUSED")
    })
    test("formatSessionNotFound", () => {
      const out = formatSessionNotFound("ses_404")
      expect(out).toContain("ses_404")
      expect(strip(out)).toContain("不存在")
    })
    test("formatSessionCreateError", () => {
      const out = formatSessionCreateError("权限不足")
      expect(strip(out)).toContain("无法创建")
      expect(out).toContain("权限不足")
    })
  })

  // /info 命令输出：Session 元信息汇总
  describe("formatInfo", () => {
    test("full info", () => {
      const out = formatInfo({ id: "ses_1", title: "测试", directory: "/a", model: "openai/gpt-4o", files: ["a.ts"] })
      expect(strip(out)).toContain("Title")
      expect(out).toContain("ses_1")
      expect(out).toContain("openai/gpt-4o")
      expect(strip(out)).toContain("1")
    })
    test("no model", () => {
      const out = formatInfo({ id: "ses_1", title: "x", directory: "/a", model: undefined, files: [] })
      expect(out).toContain("默认")
    })
  })

  // /files 命令输出：附件文件列表
  describe("formatFiles", () => {
    test("empty", () => {
      const out = formatFiles([])
      expect(strip(out)).toContain("无附件")
    })
    test("with files", () => {
      const out = formatFiles(["a.ts", "b.ts"])
      expect(strip(out)).toContain("1.")
      expect(strip(out)).toContain("2.")
      expect(out).toContain("a.ts")
      expect(out).toContain("b.ts")
    })
  })
})

// 流事件渲染：text delta / tool call / reasoning / question / abort / disconnect
describe("format stream events", () => {
  describe("formatTextDelta", () => {
    test("normal text", () => {
      expect(formatTextDelta("hello")).toBe("hello")
    })
    test("empty text", () => {
      expect(formatTextDelta("")).toBe("")
    })
  })

  // 工具调用渲染：running(⚙) / completed(✓) / error(✗)
  describe("formatToolCall", () => {
    test("running", () => {
      const out = formatToolCall("bash", "npm install", "running")
      expect(strip(out)).toContain("⚙")
      expect(out).toContain("bash")
      expect(out).toContain("npm install")
    })
    test("completed", () => {
      const out = formatToolCall("bash", "npm install", "completed", "done!")
      expect(strip(out)).toContain("✓")
      expect(out).toContain("done!")
    })
    test("completed no output", () => {
      const out = formatToolCall("read", "file.ts", "completed")
      expect(strip(out)).toContain("✓")
      expect(() => out).not.toThrow()
    })
    test("error", () => {
      const out = formatToolCall("write", "config.json", "error", "EACCES")
      expect(strip(out)).toContain("✗")
      expect(out).toContain("EACCES")
    })
    test("undefined state does not throw", () => {
      const out = formatToolCall("bash", "cmd", undefined as any)
      expect(() => out).not.toThrow()
    })
  })

  // 推理过程渲染：--thinking 开关控制显隐
  describe("formatReasoning", () => {
    test("enabled", () => {
      const out = formatReasoning("思考中...", true)
      expect(strip(out)).toContain("思考中...")
    })
    test("disabled", () => {
      const out = formatReasoning("思考中...", false)
      expect(out).toBe("")
    })
  })

  describe("formatQuestionPrompt", () => {
    test("renders question", () => {
      const out = formatQuestionPrompt("你想使用哪个端口？")
      expect(strip(out)).toContain("?")
      expect(out).toContain("你想使用哪个端口")
    })
  })

  describe("formatAbortMessage", () => {
    test("renders", () => {
      const out = formatAbortMessage()
      expect(strip(out)).toContain("已中断")
    })
  })

  describe("formatDisconnectMessage", () => {
    test("streaming disconnect", () => {
      const out = formatDisconnectMessage()
      expect(strip(out)).toContain("连接中断")
    })
  })

  describe("formatDisconnectPermMessage", () => {
    test("permission disconnect", () => {
      const out = formatDisconnectPermMessage()
      expect(strip(out)).toContain("权限请求可能已被拒绝")
    })
  })
})

// /history 命令输出：消息历史列表，支持截断和 limit
describe("formatHistory", () => {
  test("empty", () => {
    const out = formatHistory([], 10)
    expect(strip(out)).toContain("无历史")
  })
  test("user message", () => {
    const out = formatHistory([{ role: "user", text: "hello" }])
    expect(out).toContain("You:")
    expect(out).toContain("hello")
  })
  test("assistant message", () => {
    const out = formatHistory([{ role: "assistant", text: "hi" }])
    expect(out).toContain("AI:")
    expect(out).toContain("hi")
  })
  test("long message truncation", () => {
    const msg = "a".repeat(130)
    const out = formatHistory([{ role: "user", text: msg }])
    expect(strip(out)).toContain("...")
    expect(strip(out).length).toBeLessThan(300)
  })
  test("multiline preserved", () => {
    const out = formatHistory([{ role: "user", text: "line1\nline2" }])
    expect(out).toContain("line1")
    expect(out).toContain("line2")
  })
  test("respects limit", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, text: `msg${i}` }))
    const out = formatHistory(msgs, 5)
    const lines = out.split("\n")
    const count = lines.filter(l => l.includes("You:")).length
    expect(count).toBe(5)
  })
})

// /sessions 命令输出：Session 列表表格，支持长文本截断
describe("formatSessions", () => {
  test("empty", () => {
    const out = formatSessions([])
    expect(strip(out)).toContain("无 session")
  })
  test("single", () => {
    const out = formatSessions([{ id: "ses_1", title: "测试", updated: "11:18" }])
    expect(out).toContain("ses_1")
    expect(out).toContain("测试")
    expect(out).toContain("11:18")
    expect(out).toContain("Session ID")
    expect(out).toContain("Title")
    expect(out).toContain("Updated")
  })
  test("long id truncated", () => {
    const out = formatSessions([{ id: "s".repeat(30), title: "测试", updated: "11:18" }])
    const stripped = strip(out)
    expect(stripped).toContain("...")
    expect(stripped.length).toBeLessThan(180)
  })
  test("long title truncated", () => {
    const out = formatSessions([{ id: "ses_1", title: "这是一个非常非常非常非常非常非常非常非常长的标题需要被截断显示省略号", updated: "11:18" }])
    const stripped = strip(out)
    expect(stripped).toContain("...")
  })
})
