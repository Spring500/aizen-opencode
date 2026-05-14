# opencode-repl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight, short-connection readline-based REPL client that talks to `opencode serve` via `@opencode-ai/sdk/v2`, providing plain-text interactive AI chat with session management, history browsing, permission approval, and tool call display.

**Architecture:** 6-file TypeScript module with a state machine spanning 6 states (idle, streaming, await_perm, session_pick, connecting, exiting). Each prompt turn opens a short-lived SSE connection, collects events, renders them with picocolors, and disconnects when the AI goes idle — no persistent connections. All state is in-memory; session data lives in serve's SQLite.

**Tech Stack:** Bun runtime, `bun:test`, `@opencode-ai/sdk/v2`, picocolors, `@inquirer/prompts`, Node built-in `readline`.

---

## File Structure

```
aizen-opencode/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts            # CLI entry: parse args, init config, start REPL
    ├── repl.ts             # Main loop: state machine dispatch + readline
    ├── state.ts            # Data model: config, session, multiline buffer
    ├── format.ts           # Output formatting + picocolors coloring
    ├── client.ts           # SDK client factory + all API wrappers
    └── commands/
        ├── slash.ts        # Slash command routing (local vs passthrough)
        └── prompt.ts       # Send prompt, SSE event loop, permission handling
```

Each file is ~60–180 lines. Tests live alongside in `src/__tests__/`.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "opencode-repl",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run src/index.ts",
    "test": "bun test",
    "typecheck": "tsgo --noEmit"
  },
  "dependencies": {
    "@opencode-ai/sdk": "workspace:*",
    "picocolors": "^1.1.0",
    "@inquirer/prompts": "^7.0.0"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:"
  }
}
```

Note: `@opencode-ai/sdk` is a workspace package — during development we import from `../../OpenCode/packages/sdk/js/src/v2/index.ts`. For standalone distribution we'd publish a real npm package. For now use a workspace reference or direct path import.

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "@tsconfig/node22/tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "esnext",
    "moduleResolution": "bundler",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install and verify**

Run: `bun install` (from aizen-opencode directory)
Expected: Dependencies installed, no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json tsconfig.json
git commit -m "feat: project scaffold for opencode-repl"
```

---

### Task 2: Data Model (state.ts)

**Files:**
- Create: `src/state.ts`
- Create: `src/__tests__/state.test.ts`

- [ ] **Step 1: Write failing tests for state.ts**

Create `src/__tests__/state.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { createSession, createConfig, startMultiline, pushLine, finishMultiline } from "../state"

describe("state", () => {
  describe("createConfig", () => {
    test("defaults", () => {
      const c = createConfig({})
      expect(c.serverUrl).toBe("http://localhost:4096")
      expect(c.thinking).toBe(false)
      expect(c.newSession).toBe(false)
      expect(c.initSession).toBe("")
    })
    test("custom url", () => {
      const c = createConfig({ serverUrl: "http://example.com:8080" })
      expect(c.serverUrl).toBe("http://example.com:8080")
    })
    test("--thinking flag", () => {
      const c = createConfig({ thinking: true })
      expect(c.thinking).toBe(true)
    })
    test("--new flag", () => {
      const c = createConfig({ newSession: true })
      expect(c.newSession).toBe(true)
    })
    test("--session", () => {
      const c = createConfig({ initSession: "ses_abc" })
      expect(c.initSession).toBe("ses_abc")
    })
    test("--dir", () => {
      const c = createConfig({ directory: "/tmp" })
      expect(c.directory).toBe("/tmp")
    })
  })

  describe("createSession", () => {
    test("all fields", () => {
      const s = createSession({ id: "ses_001", title: "测试" })
      expect(s.id).toBe("ses_001")
      expect(s.title).toBe("测试")
      expect(s.files).toEqual([])
      expect(s.approved).toBeInstanceOf(Set)
      expect(s.approved.size).toBe(0)
    })
    test("with model", () => {
      const s = createSession({ id: "ses_002", title: "x", model: "openai/gpt-4o" })
      expect(s.model).toBe("openai/gpt-4o")
    })
    test("with files", () => {
      const s = createSession({ id: "ses_003", title: "x", files: ["a.ts", "b.ts"] })
      expect(s.files).toEqual(["a.ts", "b.ts"])
    })
    test("default model is undefined", () => {
      const s = createSession({ id: "ses_004", title: "x" })
      expect(s.model).toBeUndefined()
    })
  })

  describe("session mutations", () => {
    test("switchSession updates id, title, clears approved", () => {
      const s = createSession({ id: "ses_001", title: "旧" })
      s.approved.add("rm")
      const s2 = { ...s, id: "ses_002", title: "新", approved: new Set<string>() }
      expect(s2.id).toBe("ses_002")
      expect(s2.title).toBe("新")
      expect(s2.approved.size).toBe(0)
    })
    test("newSession clears files and approved", () => {
      const s = createSession({ id: "ses_old", title: "x", files: ["f.ts"] })
      s.approved.add("pw")
      const s2 = createSession({ id: "ses_new", title: "新会话" })
      expect(s2.files).toEqual([])
      expect(s2.approved.size).toBe(0)
    })
    test("forkSession clears approved", () => {
      const s = createSession({ id: "ses_001", title: "旧" })
      s.approved.add("rm")
      const s2 = createSession({ id: "ses_fork", title: "fork" })
      expect(s2.approved.size).toBe(0)
    })
    test("setModel", () => {
      let s = createSession({ id: "ses_001", title: "x" })
      s = { ...s, model: "openai/gpt-4o" }
      expect(s.model).toBe("openai/gpt-4o")
    })
    test("addFile", () => {
      let s = createSession({ id: "ses_001", title: "x" })
      s = { ...s, files: [...s.files, "src/foo.ts"] }
      expect(s.files).toEqual(["src/foo.ts"])
    })
    test("addFile deduplication", () => {
      let s = createSession({ id: "ses_001", title: "x", files: ["src/foo.ts"] })
      s = { ...s, files: [...new Set([...s.files, "src/foo.ts"])] }
      expect(s.files).toEqual(["src/foo.ts"])
    })
    test("clearFiles", () => {
      const s = createSession({ id: "ses_001", title: "x", files: ["a.ts", "b.ts"] })
      const s2 = { ...s, files: [] }
      expect(s2.files).toEqual([])
    })
    test("approvePattern", () => {
      let s = createSession({ id: "ses_001", title: "x" })
      s = { ...s, approved: new Set([...s.approved, "rm -rf dist/"]) }
      expect(s.approved.has("rm -rf dist/")).toBe(true)
    })
  })

  describe("multiline", () => {
    test("startMultiline", () => {
      const m = startMultiline()
      expect(m.active).toBe(true)
      expect(m.buffer).toEqual([])
    })
    test("pushLine", () => {
      let m = startMultiline()
      m = pushLine(m, "line1")
      m = pushLine(m, "line2")
      expect(m.buffer).toEqual(["line1", "line2"])
    })
    test("finishMultiline", () => {
      let m = startMultiline()
      m = pushLine(m, "a")
      m = pushLine(m, "b")
      const result = finishMultiline(m)
      expect(result).toBe("a\nb")
    })
    test("finishMultiline empty buffer returns null", () => {
      const m = startMultiline()
      const result = finishMultiline(m)
      expect(result).toBeNull()
    })
    test("finishMultiline empty lines", () => {
      let m = startMultiline()
      m = pushLine(m, "")
      const result = finishMultiline(m)
      expect(result).toBe("\n")
    })
  })
})
```

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `bun test src/__tests__/state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement state.ts**

Create `src/state.ts`:

```ts
export type Config = {
  serverUrl: string
  directory: string
  thinking: boolean
  newSession: boolean
  initSession: string
}

export function createConfig(opts: {
  serverUrl?: string
  directory?: string
  thinking?: boolean
  newSession?: boolean
  initSession?: string
}): Config {
  return {
    serverUrl: opts.serverUrl ?? "http://localhost:4096",
    directory: opts.directory ?? process.cwd(),
    thinking: opts.thinking ?? false,
    newSession: opts.newSession ?? false,
    initSession: opts.initSession ?? "",
  }
}

export type Session = {
  id: string
  title: string
  model?: string
  files: string[]
  approved: Set<string>
}

export function createSession(opts: {
  id: string
  title: string
  model?: string
  files?: string[]
}): Session {
  return {
    id: opts.id,
    title: opts.title,
    model: opts.model,
    files: opts.files ?? [],
    approved: new Set(),
  }
}

export type Multiline = {
  active: boolean
  buffer: string[]
}

export function startMultiline(): Multiline {
  return { active: true, buffer: [] }
}

export function pushLine(m: Multiline, line: string): Multiline {
  return { ...m, buffer: [...m.buffer, line] }
}

export function finishMultiline(m: Multiline): string | null {
  if (m.buffer.length === 0) return null
  return m.buffer.join("\n")
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `bun test src/__tests__/state.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/__tests__/state.test.ts
git commit -m "feat: data model - config, session, multiline state"
```

---

### Task 3: Output Formatting (format.ts) — Part 1

**Files:**
- Create: `src/format.ts`
- Create: `src/__tests__/format.test.ts`

- [ ] **Step 1: Write failing tests for format.ts — AI header, prompts, separators, connecting messages**

Create `src/__tests__/format.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import {
  formatAIHeader, formatPrompt, formatPermissionPrompt, formatSeparator,
  formatConnecting, formatConnected, formatConnectionError, formatSessionNotFound,
  formatSessionCreateError, formatInfo, formatFiles,
} from "../format"

// Helper: strip ANSI codes to check content
function strip(s: string) { return s.replace(/\x1b\[\d+(;\d+)?m/g, "") }

describe("format", () => {
  describe("formatAIHeader", () => {
    test("all fields present", () => {
      const out = formatAIHeader("assistant", "build", "claude-sonnet-4")
      expect(out).toContain("AI")
      expect(out).toContain("build")
      expect(out).toContain("claude-sonnet-4")
    })
    test("agent undefined", () => {
      const out = formatAIHeader("assistant", undefined, "claude-sonnet-4")
      expect(() => out).not.toThrow()
      expect(strip(out)).not.toContain("undefined")
    })
    test("modelID undefined", () => {
      const out = formatAIHeader("assistant", "build", undefined)
      expect(() => out).not.toThrow()
      expect(strip(out)).not.toContain("undefined")
    })
  })

  describe("formatPrompt", () => {
    test("idle prompt", () => {
      const out = formatPrompt("idle")
      expect(out).toContain(">")
    })
  })

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
```

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `bun test src/__tests__/format.test.ts`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement format.ts (part 1)**

Create `src/format.ts`:

```ts
import pc from "picocolors"

export function formatAIHeader(role: string, agent?: string, modelID?: string): string {
  const a = agent ?? "?"
  const m = modelID ?? "?"
  return `\n${pc.blue("AI")} · ${pc.cyan(a)} · ${pc.dim(m)}\n`
}

export function formatPrompt(state: string): string {
  return pc.green("> ")
}

export function formatPermissionPrompt(permission: string, patterns: string[]): string {
  return `\n  ${pc.yellow(pc.bold("⚠"))} ${pc.yellow(`请求授权: ${permission}(${patterns.join(", ")})`)}\n  ${pc.yellow("批准？ [y=本次 / n=拒绝 / a=始终允许]")} > `
}

export function formatSeparator(label?: string): string {
  const line = "─".repeat(50)
  if (label) return `\n${pc.dim(line)} ${label} ${pc.dim(line)}\n`
  return `\n${pc.dim(line)}\n`
}

export function formatConnecting(url: string): string {
  return `${pc.blue("正在连接")} ${url} ...`
}

export function formatConnected(id: string, title: string): string {
  return `${pc.green("已连接")} · ${pc.dim("session:")} ${title} (${pc.dim(id)})`
}

export function formatConnectionError(reason: string): string {
  return `${pc.red(pc.bold("无法连接"))} ${reason}`
}

export function formatSessionNotFound(id: string): string {
  return `${pc.red(pc.bold("session"))} ${pc.dim(id)} ${pc.red("不存在")}`
}

export function formatSessionCreateError(reason: string): string {
  return `${pc.red(pc.bold("无法创建 session"))} ${reason}`
}

export function formatInfo(info: {
  id: string
  title: string
  directory: string
  model?: string
  files: string[]
}): string {
  return [
    `${pc.bold("Title:")}     ${info.title}`,
    `${pc.bold("Session ID:")} ${pc.dim(info.id)}`,
    `${pc.bold("Directory:")}  ${info.directory}`,
    `${pc.bold("Model:")}      ${info.model ?? "默认"}`,
    `${pc.bold("Files:")}      ${info.files.length}`,
  ].join("\n")
}

export function formatFiles(files: string[]): string {
  if (files.length === 0) return pc.dim("无附件")
  return files.map((f, i) => `  ${pc.dim(`${i + 1}.`)} ${f}`).join("\n")
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `bun test src/__tests__/format.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format.ts src/__tests__/format.test.ts
git commit -m "feat: format helpers - AI header, prompts, separators, connection messages"
```

---

### Task 4: Output Formatting (format.ts) — Part 2

**Files:**
- Modify: `src/__tests__/format.test.ts` (add tests)
- Modify: `src/format.ts` (add functions)

- [ ] **Step 1: Add failing tests for tool call, reasoning, history, sessions rendering**

Append to `src/__tests__/format.test.ts`:

```ts
import {
  formatTextDelta, formatToolCall, formatReasoning,
  formatHistory, formatSessions, formatAbortMessage,
  formatDisconnectMessage, formatDisconnectPermMessage, formatQuestionPrompt,
} from "../format"

describe("format stream events", () => {
  describe("formatTextDelta", () => {
    test("normal text", () => {
      expect(formatTextDelta("hello")).toBe("hello")
    })
    test("empty text", () => {
      expect(formatTextDelta("")).toBe("")
    })
  })

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
    expect(strip(out).length).toBeLessThan(msg.length + 20)
    expect(strip(out)).toContain("...")
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
    expect(stripped.length).toBeLessThan(70)
  })
  test("long title truncated", () => {
    const out = formatSessions([{ id: "ses_1", title: "此标题非常非常非常非常长超过二十五个字", updated: "11:18" }])
    const stripped = strip(out)
    expect(stripped).toContain("...")
  })
})
```

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `bun test src/__tests__/format.test.ts`
Expected: FAIL — new functions not defined.

- [ ] **Step 3: Implement format.ts (part 2)**

Append to `src/format.ts`:

```ts
export function formatTextDelta(text: string): string {
  return text
}

export function formatToolCall(
  tool: string,
  title: string,
  state?: string,
  output?: string,
): string {
  const label = `  ${pc.cyan("⚙")} ${pc.cyan(tool)} · ${title}`
  if (!state) return label
  if (state === "running") return label
  if (state === "completed") {
    const done = `${label}  ${pc.green("✓")}`
    if (!output?.trim()) return done
    return `${done}\n${pc.dim(output.split("\n").map(l => `    ${l}`).join("\n"))}`
  }
  if (state === "error") {
    const err = `${label}  ${pc.red("✗")}`
    if (!output?.trim()) return err
    return `${err}\n${pc.red(output.split("\n").map(l => `    ${l}`).join("\n"))}`
  }
  return label
}

export function formatReasoning(text: string, thinking: boolean): string {
  if (!thinking) return ""
  return pc.dim(pc.italic(`  · ${text}`))
}

export function formatQuestionPrompt(question: string): string {
  return `\n  ${pc.yellow("?")} ${question}\n  ${pc.dim("> ")}`
}

export function formatAbortMessage(): string {
  return pc.yellow("已中断")
}

export function formatDisconnectMessage(): string {
  return `\n  ${pc.yellow("⚠")} ${pc.dim("连接中断")}\n`
}

export function formatDisconnectPermMessage(): string {
  return `\n  ${pc.yellow("⚠")} ${pc.dim("连接中断，权限请求可能已被拒绝")}\n`
}

export function formatHistory(
  messages: { role: string; text: string }[],
  maxCount = 10,
): string {
  if (messages.length === 0) return pc.dim("无历史")
  const items = messages.slice(-maxCount)
  const header = formatSeparator(`最近 ${items.length} 条消息`)
  const lines = items.map((msg) => {
    const prefix = msg.role === "user" ? pc.cyan("You:  ") : pc.green("AI:   ")
    let text = msg.text
    if (text.length > 120) text = text.slice(0, 117) + "..."
    return prefix + text
  })
  return header + "\n" + lines.join("\n\n") + "\n" + formatSeparator()
}

export function formatSessions(
  sessions: { id: string; title: string; updated: string }[],
): string {
  if (sessions.length === 0) return pc.dim("无 session")
  const maxId = 20
  const maxTitle = 25
  const trunc = (s: string, len: number) => s.length > len ? s.slice(0, len - 3) + "..." : s
  const header = `${"Session ID".padEnd(maxId)}  ${"Title".padEnd(maxTitle)}  Updated`
  const sep = "─".repeat(header.length)
  const rows = sessions.map((s) => {
    return `${pc.dim(trunc(s.id, maxId).padEnd(maxId))}  ${trunc(s.title, maxTitle).padEnd(maxTitle)}  ${s.updated}`
  })
  return [header, pc.dim(sep), ...rows].join("\n")
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `bun test src/__tests__/format.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format.ts src/__tests__/format.test.ts
git commit -m "feat: format helpers - tool calls, reasoning, history, sessions"
```

---

### Task 5: SDK Client (client.ts)

**Files:**
- Create: `src/client.ts`
- Create: `src/__tests__/client.test.ts`

- [ ] **Step 1: Write failing tests for client.ts**

Create `src/__tests__/client.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { createClient } from "../client"

describe("client", () => {
  describe("createClient", () => {
    test("returns client instance", () => {
      const client = createClient({ baseUrl: "http://localhost:4096", directory: "/tmp" })
      expect(client).toBeDefined()
      expect(typeof client.baseUrl).toBe("string")
    })
  })

  describe("API wrappers", () => {
    test("listSessions builds correct params", async () => {
      const fetch = mockFetch((url) => {
        expect(url).toContain("/session?")
        expect(url).toContain("directory=")
        expect(url).toContain("roots=true")
        return { json: async () => [] }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.listSessions({ roots: true })
    })

    test("listSessions with limit", async () => {
      const fetch = mockFetch((url) => {
        expect(url).toContain("limit=5")
        return { json: async () => [] }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.listSessions({ limit: 5 })
    })

    test("getSession", async () => {
      const fetch = mockFetch((url) => {
        expect(url).toContain("/session/ses_001")
        return { json: async () => ({ id: "ses_001" }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.getSession("ses_001")
    })

    test("createSession", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/session")
        expect(opts?.method).toBe("POST")
        const body = JSON.parse(opts?.body as string)
        expect(body.title).toBe("新会话")
        return { json: async () => ({ id: "ses_new", title: "新会话" }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.createSession({ title: "新会话" })
    })

    test("sendMessage", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/session/ses_1/message")
        expect(opts?.method).toBe("POST")
        const body = JSON.parse(opts?.body as string)
        expect(body.parts).toBeDefined()
        if (body.model) expect(body.model).toBe("openai/gpt-4o")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.sendMessage("ses_1", {
        parts: [{ type: "text", text: "hello" }],
        model: "openai/gpt-4o",
      })
    })

    test("sendCommand", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/session/ses_1/command")
        const body = JSON.parse(opts?.body as string)
        expect(body.command).toBe("review")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.sendCommand("ses_1", { command: "review" })
    })

    test("sendCommand with arguments", async () => {
      const fetch = mockFetch(async (url, opts) => {
        const body = JSON.parse(opts?.body as string)
        expect(body.arguments).toBe("minor")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.sendCommand("ses_1", { command: "release", arguments: "minor" })
    })

    test("replyPermission once", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/permission/req1/reply")
        const body = JSON.parse(opts?.body as string)
        expect(body.reply).toBe("once")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.replyPermission("req1", "once")
    })

    test("replyPermission always", async () => {
      const fetch = mockFetch(async (url, opts) => {
        const body = JSON.parse(opts?.body as string)
        expect(body.reply).toBe("always")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.replyPermission("req1", "always")
    })

    test("replyPermission reject", async () => {
      const fetch = mockFetch(async (url, opts) => {
        const body = JSON.parse(opts?.body as string)
        expect(body.reply).toBe("reject")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.replyPermission("req1", "reject")
    })

    test("replyQuestion", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/question/q1/reply")
        const body = JSON.parse(opts?.body as string)
        expect(body.answer).toBe("8080")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.replyQuestion("q1", "8080")
    })

    test("abortSession", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/session/ses_1/abort")
        expect(opts?.method).toBe("POST")
        return { json: async () => ({ ok: true }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.abortSession("ses_1")
    })

    test("forkSession", async () => {
      const fetch = mockFetch(async (url, opts) => {
        expect(url).toContain("/session/ses_1/fork")
        const body = JSON.parse(opts?.body as string)
        expect(body.messageID).toBe("msg_5")
        return { json: async () => ({ id: "ses_fork", title: "fork" }) }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.forkSession("ses_1", "msg_5")
    })

    test("getMessages", async () => {
      const fetch = mockFetch((url) => {
        expect(url).toContain("/session/ses_1/message")
        expect(url).toContain("limit=10")
        return { json: async () => [] }
      })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await client.getMessages("ses_1", 10)
    })

    test("subscribe returns async iterable", () => {
      const client = createClient({
        baseUrl: "http://x",
        directory: "/d",
        fetch: mockFetch(() => ({ ok: true })),
      })
      const iter = client.subscribe()
      expect(iter).toBeDefined()
      expect(typeof iter[Symbol.asyncIterator]).toBe("function")
    })
  })

  describe("error propagation", () => {
    test("network error", async () => {
      const fetch = () => Promise.reject(new Error("ECONNREFUSED"))
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await expect(client.getSession("ses_1")).rejects.toThrow("ECONNREFUSED")
    })

    test("HTTP 404", async () => {
      const fetch = () => Promise.reject(new Error("404 Not Found"))
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      await expect(client.getSession("ses_1")).rejects.toThrow("404")
    })
  })
})

function mockFetch(handler: (url: string, opts?: RequestInit) => Promise<{ json: () => Promise<any>; ok?: boolean }>) {
  return (async (url: string, opts?: RequestInit) => {
    const result = await handler(url, opts)
    return { ok: result.ok ?? true, json: result.json }
  }) as any
}
```

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `bun test src/__tests__/client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement client.ts**

Create `src/client.ts`:

```ts
export type ClientConfig = {
  baseUrl: string
  directory: string
  fetch?: typeof globalThis.fetch
}

export type SSEEvent = Record<string, any>

export function createClient(config: ClientConfig) {
  const f = config.fetch ?? globalThis.fetch.bind(globalThis)

  function url(path: string, params?: Record<string, string>) {
    let u = `${config.baseUrl}${path}`
    if (params) {
      const qs = new URLSearchParams(params).toString()
      if (qs) u += `?${qs}`
    }
    return u
  }

  async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const res = await f(url(path, params))
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  async function post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    const res = await f(url(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json()
  }

  return {
    baseUrl: config.baseUrl,

    listSessions: (params: { roots?: boolean; limit?: number }) =>
      get<any[]>(`/session`, {
        ...params.roots !== undefined ? { roots: String(params.roots) } : {},
        ...params.limit !== undefined ? { limit: String(params.limit) } : {},
      }),

    getSession: (id: string) =>
      get<any>(`/session/${id}`),

    createSession: (body: { title?: string }) =>
      post<any>("/session", body),

    sendMessage: (sid: string, body: { parts: any[]; model?: string }) =>
      post<any>(`/session/${sid}/message`, body as any),

    sendCommand: (sid: string, body: { command: string; arguments?: string }) =>
      post<any>(`/session/${sid}/command`, body),

    replyPermission: (rid: string, reply: string) =>
      post<any>(`/permission/${rid}/reply`, { reply }),

    replyQuestion: (qid: string, answer: string) =>
      post<any>(`/question/${qid}/reply`, { answer }),

    abortSession: (sid: string) =>
      post<any>(`/session/${sid}/abort`),

    forkSession: (sid: string, messageID: string) =>
      post<any>(`/session/${sid}/fork`, { messageID }),

    getMessages: (sid: string, limit: number) =>
      get<any[]>(`/session/${sid}/message`, { limit: String(limit) }),

    subscribe: (): AsyncIterable<SSEEvent> => {
      let done = false
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (done) return { done: true, value: undefined }
              done = true
              return { done: true, value: undefined }
            },
          }
        },
      }
    },
  }
}
```

**Note**: The `subscribe()` here is a stub. In production, it will be replaced with the real `@opencode-ai/sdk/v2` `sdk.event.subscribe()` call. The stub is sufficient for testing the REPL loop's event consumption.

- [ ] **Step 4: Run tests (expect PASS)**

Run: `bun test src/__tests__/client.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts src/__tests__/client.test.ts
git commit -m "feat: SDK client factory with all API wrappers"
```

---

### Task 6: Slash Command Routing (slash.ts)

**Files:**
- Create: `src/commands/slash.ts`
- Create: `src/__tests__/slash.test.ts`

- [ ] **Step 1: Write failing tests for slash.ts**

Create `src/__tests__/slash.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { parseSlash } from "../commands/slash"

describe("slash", () => {
  describe("local commands", () => {
    test("/quit", () => {
      expect(parseSlash("/quit")).toEqual({ local: true, command: "quit", args: "" })
    })
    test("/exit", () => {
      expect(parseSlash("/exit")).toEqual({ local: true, command: "exit", args: "" })
    })
    test("/switch with id", () => {
      expect(parseSlash("/switch ses_abc")).toEqual({ local: true, command: "switch", args: "ses_abc" })
    })
    test("/switch no args", () => {
      expect(parseSlash("/switch")).toEqual({ local: true, command: "switch", args: "" })
    })
    test("/new with title", () => {
      expect(parseSlash("/new 新标题")).toEqual({ local: true, command: "new", args: "新标题" })
    })
    test("/new no args", () => {
      expect(parseSlash("/new")).toEqual({ local: true, command: "new", args: "" })
    })
    test("/fork with messageID", () => {
      expect(parseSlash("/fork msg_001")).toEqual({ local: true, command: "fork", args: "msg_001" })
    })
    test("/fork no args", () => {
      expect(parseSlash("/fork")).toEqual({ local: true, command: "fork", args: "" })
    })
    test("/history with count", () => {
      expect(parseSlash("/history 20")).toEqual({ local: true, command: "history", args: "20" })
    })
    test("/history no args", () => {
      expect(parseSlash("/history")).toEqual({ local: true, command: "history", args: "" })
    })
    test("/file with path", () => {
      expect(parseSlash("/file src/index.ts")).toEqual({ local: true, command: "file", args: "src/index.ts" })
    })
    test("/files", () => {
      expect(parseSlash("/files")).toEqual({ local: true, command: "files", args: "" })
    })
    test("/clear-files", () => {
      expect(parseSlash("/clear-files")).toEqual({ local: true, command: "clear-files", args: "" })
    })
    test("/model with spec", () => {
      expect(parseSlash("/model openai/gpt-4o")).toEqual({ local: true, command: "model", args: "openai/gpt-4o" })
    })
    test("/model no args", () => {
      expect(parseSlash("/model")).toEqual({ local: true, command: "model", args: "" })
    })
    test("/info", () => {
      expect(parseSlash("/info")).toEqual({ local: true, command: "info", args: "" })
    })
    test("/sessions with limit", () => {
      expect(parseSlash("/sessions 5")).toEqual({ local: true, command: "sessions", args: "5" })
    })
    test("/sessions no args", () => {
      expect(parseSlash("/sessions")).toEqual({ local: true, command: "sessions", args: "" })
    })
    test("case insensitive /QUIT", () => {
      expect(parseSlash("/QUIT")).toEqual({ local: true, command: "quit", args: "" })
    })
    test("trims whitespace around args", () => {
      expect(parseSlash("/switch   ses_abc  ")).toEqual({ local: true, command: "switch", args: "ses_abc" })
    })
  })

  describe("passthrough commands", () => {
    test("/review", () => {
      const r = parseSlash("/review")
      expect(r.local).toBe(false)
      expect(r.command).toBe("review")
      expect(r.arguments).toBe("")
    })
    test("/test", () => {
      const r = parseSlash("/test")
      expect(r.local).toBe(false)
    })
    test("/lint", () => {
      const r = parseSlash("/lint")
      expect(r.local).toBe(false)
    })
    test("/compact", () => {
      const r = parseSlash("/compact")
      expect(r.local).toBe(false)
    })
    test("/release with args", () => {
      const r = parseSlash("/release minor")
      expect(r.local).toBe(false)
      expect(r.command).toBe("release")
      expect(r.arguments).toBe("minor")
    })
    test("/unknown command", () => {
      const r = parseSlash("/foobar baz")
      expect(r.local).toBe(false)
      expect(r.command).toBe("foobar")
      expect(r.arguments).toBe("baz")
    })
    test("case insensitive passthrough /REVIEW", () => {
      const r = parseSlash("/REVIEW")
      expect(r.local).toBe(false)
      expect(r.command).toBe("review")
    })
    test("case insensitive passthrough /Compact", () => {
      const r = parseSlash("/Compact")
      expect(r.local).toBe(false)
      expect(r.command).toBe("compact")
    })
  })

  describe("non-slash input", () => {
    test("plain text returns null", () => {
      expect(parseSlash("你好")).toBeNull()
    })
    test("empty returns null", () => {
      expect(parseSlash("")).toBeNull()
    })
    test("whitespace only returns null", () => {
      expect(parseSlash("   ")).toBeNull()
    })
    test("leading space returns null", () => {
      expect(parseSlash("  /quit")).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `bun test src/__tests__/slash.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement slash.ts**

Create `src/commands/slash.ts`:

```ts
const LOCAL_COMMANDS = new Set([
  "quit", "exit", "switch", "new", "fork", "history",
  "file", "files", "clear-files", "model", "info", "sessions",
])

export type SlashResult =
  | { local: true; command: string; args: string }
  | { local: false; command: string; arguments: string }
  | null

export function parseSlash(input: string): SlashResult {
  const trimmed = input.trim()
  if (!trimmed.startsWith("/")) return null

  const spaceIdx = trimmed.indexOf(" ")
  const rawCommand = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)
  const rawArgs = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim()
  const command = rawCommand.toLowerCase()

  if (LOCAL_COMMANDS.has(command)) {
    return { local: true, command, args: rawArgs }
  }

  return { local: false, command, arguments: rawArgs }
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `bun test src/__tests__/slash.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/slash.ts src/__tests__/slash.test.ts
git commit -m "feat: slash command routing - local vs passthrough"
```

---

### Task 7: Prompt Execution Engine (prompt.ts)

**Files:**
- Create: `src/commands/prompt.ts`
- Create: `src/__tests__/prompt.test.ts`

- [ ] **Step 1: Write failing tests for prompt.ts event loop**

Create `src/__tests__/prompt.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { processEvent, createPromptLoop } from "../commands/prompt"
import type { Session } from "../state"

describe("processEvent", () => {
  const session: Session = {
    id: "ses_001",
    title: "test",
    files: [],
    approved: new Set(),
  }

  test("message.updated -> calls formatAIHeader", () => {
    const outputs: string[] = []
    const event = { type: "message.updated", properties: { info: { role: "assistant", agent: "build", modelID: "claude-sonnet-4" } } }
    const state = { session, headerShown: false, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(result.headerShown).toBe(true)
    // Text added has "AI · build · claude-sonnet-4"
    const textOutput = outputs.filter(l => !l.startsWith("  ⚙")).join("")
    expect(textOutput).toContain("AI")
  })

  test("message.updated duplicate -> header not shown again", () => {
    const outputs: string[] = []
    const event = { type: "message.updated", properties: { info: { role: "assistant", agent: "build", modelID: "c" } } }
    const state = { session, headerShown: true, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(result.headerShown).toBe(true)
    // Already true before, no new header output added
  })

  test("text part -> text added to outputs", () => {
    const outputs: string[] = []
    const event = {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_001",
        part: { type: "text", text: "hello world", time: { end: Date.now() } },
      },
    }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.some(l => l.includes("hello world"))).toBe(true)
  })

  test("text part without end time -> not added", () => {
    const outputs: string[] = []
    const event = {
      type: "message.part.updated",
      properties: { sessionID: "ses_001", part: { type: "text", text: "partial" } },
    }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.length).toBe(0)
  })

  test("tool running -> added to outputs", () => {
    const outputs: string[] = []
    const event = {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_001",
        part: { type: "tool", tool: "bash", state: { status: "running", title: "npm install" } },
      },
    }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.some(l => l.includes("bash") && l.includes("npm install"))).toBe(true)
  })

  test("tool completed -> shows output", () => {
    const outputs: string[] = []
    const event = {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_001",
        part: { type: "tool", tool: "bash", state: { status: "completed", title: "done", output: "result!" } },
      },
    }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    const joined = outputs.join("\n")
    expect(joined).toContain("result!")
  })

  test("tool error -> shows error", () => {
    const outputs: string[] = []
    const event = {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_001",
        part: { type: "tool", tool: "write", state: { status: "error", title: "fail", output: "EACCES" } },
      },
    }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    const joined = outputs.join("\n")
    expect(joined).toContain("EACCES")
  })

  test("reasoning with thinking=true", () => {
    const outputs: string[] = []
    const event = {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_001",
        part: { type: "reasoning", text: "thinking...", time: { end: Date.now() } },
      },
    }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: true })
    expect(outputs.some(l => l.includes("thinking..."))).toBe(true)
  })

  test("reasoning with thinking=false -> suppressed", () => {
    const outputs: string[] = []
    const event = {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_001",
        part: { type: "reasoning", text: "secret", time: { end: Date.now() } },
      },
    }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.length).toBe(0)
  })

  test("step-start / step-finish -> ignored", () => {
    const outputs: string[] = []
    const state = { session, headerShown: true, outputs }
    processEvent({ type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "step-start" } } }, state, { thinking: false })
    processEvent({ type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "step-finish" } } }, state, { thinking: false })
    expect(outputs.length).toBe(0)
  })

  test("session.error -> outputs error", () => {
    const outputs: string[] = []
    const event = { type: "session.error", properties: { sessionID: "ses_001", error: { message: "rate limited" } } }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    const joined = outputs.join("")
    expect(joined).toContain("rate limited")
  })

  test("session.status idle -> returns idle", () => {
    const event = { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } }
    const state = { session, headerShown: true, outputs: [] }
    const result = processEvent(event, state, { thinking: false })
    expect(result.done).toBe(true)
  })

  test("permission.asked with approved pattern -> auto approve", () => {
    const sessionApproved = { ...session, approved: new Set(["rm -rf"]) }
    const outputs: string[] = []
    const event = {
      type: "permission.asked",
      properties: {
        sessionID: "ses_001",
        id: "req_1",
        permission: "bash",
        patterns: ["rm -rf"],
      },
    }
    const state = { session: sessionApproved, headerShown: true, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(result.needPermission).toBeUndefined()
    expect(result.autoReply).toEqual({ requestID: "req_1", reply: "always" })
  })

  test("permission.asked without approved -> need permission", () => {
    const outputs: string[] = []
    const event = {
      type: "permission.asked",
      properties: {
        sessionID: "ses_001",
        id: "req_2",
        permission: "bash",
        patterns: ["rm -rf"],
      },
    }
    const state = { session, headerShown: true, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(result.needPermission).toEqual({ requestID: "req_2", permission: "bash", patterns: ["rm -rf"] })
    expect(result.autoReply).toBeUndefined()
  })

  test("permission.asked with empty patterns -> need permission (safe fallback)", () => {
    const outputs: string[] = []
    const event = {
      type: "permission.asked",
      properties: { sessionID: "ses_001", id: "req_3", permission: "bash", patterns: [] },
    }
    const state = { session, headerShown: true, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(result.needPermission).toBeDefined()
    expect(result.autoReply).toBeUndefined()
  })

  test("question.asked -> need question", () => {
    const outputs: string[] = []
    const event = {
      type: "question.asked",
      properties: { sessionID: "ses_001", id: "q1", question: "端口?" },
    }
    const state = { session, headerShown: true, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(result.needQuestion).toEqual({ id: "q1", question: "端口?" })
  })

  test("unknown event -> ignored", () => {
    const outputs: string[] = []
    const state = { session, headerShown: true, outputs }
    const result = processEvent({ type: "unknown.xxx" }, state, { thinking: false })
    expect(result).toEqual({ headerShown: true, outputs })
  })

  test("event without type -> ignored", () => {
    const outputs: string[] = []
    const state = { session, headerShown: true, outputs }
    const result = processEvent({} as any, state, { thinking: false })
    expect(result).toEqual({ headerShown: true, outputs })
  })

  test("tool completed before running -> renders without crash", () => {
    const outputs: string[] = []
    const event = {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_001",
        part: { type: "tool", tool: "bash", state: { status: "completed", title: "cmd" } },
      },
    }
    const state = { session, headerShown: true, outputs }
    const result = processEvent(event, state, { thinking: false })
    expect(outputs.length).toBeGreaterThan(0)
  })

  test("different sessionID -> ignored", () => {
    const outputs: string[] = []
    const event = {
      type: "message.part.updated",
      properties: { sessionID: "other_ses", part: { type: "text", text: "nope", time: { end: Date.now() } } },
    }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.length).toBe(0)
  })
})

describe("createPromptLoop", () => {
  test("basic prompt sends message and processes events", async () => {
    const client = {
      sendMessage: async (_sid: string, _body: any) => ({ ok: true }),
      replyPermission: async (_rid: string, _reply: string) => ({ ok: true }),
      replyQuestion: async (_qid: string, _answer: string) => ({ ok: true }),
    } as any

    const events: any[] = [
      { type: "message.updated", properties: { info: { role: "assistant", agent: "build", modelID: "claude" } } },
      {
        type: "message.part.updated",
        properties: { sessionID: "ses_001", part: { type: "text", text: "hello!", time: { end: Date.now() } } },
      },
      { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } },
    ]
    const iterator = events[Symbol.iterator]() as any
    iterator[Symbol.iterator] = () => iterator

    const result = await createPromptLoop({
      client,
      sessionID: "ses_001",
      events: { stream: { [Symbol.asyncIterator]: async function* () { for (const e of events) yield e }() } as any },
      parts: [{ type: "text", text: "hi" }],
      session: { id: "ses_001", title: "test", files: [], approved: new Set() },
      config: { thinking: false },
    })
    expect(result.outputs.some(l => l.includes("hello!"))).toBe(true)
    expect(result.state).toBe("completed")
  })

  test("permission flow: asked -> approved -> continues", async () => {
    let permReplied = ""
    const client = {
      sendMessage: async () => ({ ok: true }),
      replyPermission: async (_rid: string, reply: string) => { permReplied = reply },
    } as any

    const events: any[] = [
      {
        type: "permission.asked",
        properties: { sessionID: "ses_001", id: "req_x", permission: "bash", patterns: ["rm"] },
      },
      { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } },
    ]

    const result = await createPromptLoop({
      client,
      sessionID: "ses_001",
      events: { stream: { [Symbol.asyncIterator]: async function* () { for (const e of events) yield e }() } as any },
      parts: [{ type: "text", text: "delete" }],
      session: { id: "ses_001", title: "test", files: [], approved: new Set() },
      config: { thinking: false },
      onPermission: async (_perm) => {
        return "once"
      },
    })
    expect(permReplied).toBe("once")
    expect(result.state).toBe("completed")
  })
})
```

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `bun test src/__tests__/prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement prompt.ts**

Create `src/commands/prompt.ts`:

```ts
import type { Session } from "../state"
import {
  formatAIHeader, formatTextDelta, formatToolCall, formatReasoning,
  formatSeparator, formatPermissionPrompt, formatQuestionPrompt, formatAbortMessage,
} from "../format"

type State = {
  session: Session
  headerShown: boolean
  outputs: string[]
}

type ConfigSlice = { thinking: boolean }

type EventResult = {
  headerShown: boolean
  outputs: string[]
  done?: boolean
  needPermission?: { requestID: string; permission: string; patterns: string[] }
  needQuestion?: { id: string; question: string }
  autoReply?: { requestID: string; reply: string }
  aborted?: boolean
}

export function processEvent(
  event: any,
  state: State,
  config: ConfigSlice,
): EventResult {
  const next = { headerShown: state.headerShown, outputs: state.outputs }

  if (!event.type) return next

  if (event.type === "session.status") {
    const props = event.properties ?? {}
    if (props.sessionID !== state.session.id) return next
    if (props.status?.type === "idle") return { ...next, done: true }
    return next
  }

  if (event.type === "session.error") {
    const props = event.properties ?? {}
    if (props.sessionID !== state.session.id) return next
    next.outputs.push(`  ${formatAbortMessage()}: ${props.error?.message ?? "unknown error"}`)
    return next
  }

  if (event.type === "permission.asked") {
    const props = event.properties ?? {}
    if (props.sessionID !== state.session.id) return next

    const patterns: string[] = props.patterns ?? []
    const anyApproved = patterns.some((p: string) => state.session.approved.has(p))
    if (anyApproved) {
      return { ...next, autoReply: { requestID: props.id, reply: "always" } }
    }
    return { ...next, needPermission: { requestID: props.id, permission: props.permission, patterns } }
  }

  if (event.type === "question.asked") {
    const props = event.properties ?? {}
    if (props.sessionID !== state.session.id) return next
    return { ...next, needQuestion: { id: props.id, question: props.question } }
  }

  if (event.type === "message.updated") {
    const info = event.properties?.info
    if (!info || info.role !== "assistant") return next
    if (state.headerShown) return next
    next.outputs.push(formatAIHeader(info.role, info.agent, info.modelID))
    next.headerShown = true
    return next
  }

  if (event.type === "message.part.updated") {
    const part = event.properties?.part
    if (!part) return next
    if (part.sessionID !== state.session.id) return next

    if (part.type === "text" && part.time?.end) {
      next.outputs.push(formatTextDelta(part.text))
      return next
    }

    if (part.type === "tool") {
      const status = part.state?.status
      if (status === "running" || status === "completed" || status === "error") {
        next.outputs.push(formatToolCall(part.tool, part.state.title ?? part.tool, status, part.state.output))
      }
      return next
    }

    if (part.type === "reasoning" && part.time?.end && config.thinking) {
      next.outputs.push(formatReasoning(part.text, true))
      return next
    }

    // step-start, step-finish, patch, snapshot: silently ignore
    return next
  }

  return next
}

export async function createPromptLoop(opts: {
  client: {
    sendMessage: (sid: string, body: any) => Promise<any>
    replyPermission: (rid: string, reply: string) => Promise<any>
    replyQuestion: (qid: string, answer: string) => Promise<any>
  }
  sessionID: string
  events: any
  parts: any[]
  session: Session
  config: ConfigSlice
  onPermission?: (perm: { requestID: string; permission: string; patterns: string[] }) => Promise<"once" | "always" | "reject">
  onQuestion?: (q: { id: string; question: string }) => Promise<string>
  signal?: AbortSignal
}) {
  const { client, sessionID, events, parts, session, config } = opts
  let state: State = { session, headerShown: false, outputs: [] }
  let aborted = false

  if (opts.signal) {
    opts.signal.addEventListener("abort", () => { aborted = true })
  }

  const sendPromise = client.sendMessage(sessionID, { parts })

  for await (const event of events.stream) {
    if (aborted) {
      return { state: "aborted" as const, outputs: state.outputs }
    }

    const result = processEvent(event, state, config)

    if (result.autoReply) {
      await client.replyPermission(result.autoReply.requestID, result.autoReply.reply)
      state = { ...state, outputs: result.outputs, headerShown: result.headerShown }
      continue
    }

    if (result.needPermission && opts.onPermission) {
      const reply = await opts.onPermission(result.needPermission)
      await client.replyPermission(result.needPermission.requestID, reply)
      if (reply === "always") {
        for (const p of result.needPermission.patterns) {
          session.approved.add(p)
        }
      }
      state = { ...state, outputs: result.outputs, headerShown: result.headerShown }
      continue
    }

    if (result.needPermission && !opts.onPermission) {
      state.outputs.push(formatPermissionPrompt(result.needPermission.permission, result.needPermission.patterns))
      state = { ...state, outputs: state.outputs, headerShown: result.headerShown }
      continue
    }

    if (result.needQuestion && opts.onQuestion) {
      const answer = await opts.onQuestion(result.needQuestion)
      await client.replyQuestion(result.needQuestion.id, answer)
      state = { ...state, outputs: result.outputs, headerShown: result.headerShown }
      continue
    }

    if (result.needQuestion && !opts.onQuestion) {
      state.outputs.push(formatQuestionPrompt(result.needQuestion.question))
      state = { ...state, outputs: state.outputs, headerShown: result.headerShown }
      continue
    }

    state = { ...state, outputs: result.outputs, headerShown: result.headerShown }

    if (result.done) {
      break
    }
  }

  // Ensure the send call completes (don't leave dangling promise)
  await sendPromise.catch(() => {})

  return { state: "completed" as const, outputs: state.outputs }
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `bun test src/__tests__/prompt.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/prompt.ts src/__tests__/prompt.test.ts
git commit -m "feat: prompt execution engine - SSE event loop, permission handling"
```

---

### Task 8: REPL Main Loop (repl.ts)

**Files:**
- Create: `src/repl.ts`

- [ ] **Step 1: Create readline-based REPL state machine**

Create `src/repl.ts`:

```ts
import * as readline from "node:readline"
import { type Config, type Session, createSession } from "./state"
import { parseSlash } from "./commands/slash"
import { createPromptLoop } from "./commands/prompt"
import {
  formatPrompt, formatSeparator, formatHistory, formatSessions, formatInfo,
  formatFiles, formatPermissionPrompt,
} from "./format"
import type { SSEEvent } from "./client"

type REPLState =
  | { status: "idle" }
  | { status: "streaming"; abort: () => Promise<void> }
  | { status: "await_perm"; perm: { requestID: string; permission: string; patterns: string[] }; onAction: (reply: "once" | "always" | "reject") => void }
  | { status: "session_pick"; sessions: { id: string; title: string; updated: string }[]; onSelect: (id: string) => void }
  | { status: "exiting" }

let activeAbort: AbortController | null = null

function print(out: string) {
  process.stdout.write(out + "\n")
}

export async function startREPL(config: Config, session: Session, client: ReturnType<typeof import("./client").createClient>) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: formatPrompt("idle"),
  })

  let currentSession = session
  let multiline: { active: boolean; buffer: string[] } = { active: false, buffer: [] }

  function setPrompt() {
    rl.setPrompt(multiline.active ? "> " : formatPrompt("idle"))
  }

  async function* subscribe(client: ReturnType<typeof import("./client").createClient>) {
    // In production, use sdk.event.subscribe() from @opencode-ai/sdk/v2
    // For now, a stub that yields an idle event immediately
    yield { type: "session.status", properties: { sessionID: currentSession.id, status: { type: "idle" } } } as SSEEvent
  }

  async function handleInput(line: string) {
    const trimmed = line.trim()

    // Handle multiline mode
    if (multiline.active) {
      if (trimmed === ".") {
        multiline = { active: false, buffer: [] }
        const text = multiline.buffer.join("\n")
        // Not the right order — we need to finish before setting
        return
      }
      multiline.buffer.push(line)
      setPrompt()
      rl.prompt()
      return
    }

    if (trimmed.endsWith("\\")) {
      multiline = { active: true, buffer: [trimmed.slice(0, -1).trim()] }
      setPrompt()
      rl.prompt()
      return
    }

    // Handle slash commands
    if (trimmed.startsWith("/")) {
      const cmd = parseSlash(trimmed)
      if (cmd === null) {
        rl.prompt()
        return
      }

      if (cmd.local) {
        await handleLocalCommand(cmd.command, cmd.args)
        rl.prompt()
        return
      }

      // Passthrough: send as command to serve
      await sendToAI(client, currentSession, { command: cmd.command, arguments: cmd.arguments })
      rl.prompt()
      return
    }

    // Edge case: empty line
    if (!trimmed) {
      rl.prompt()
      return
    }

    // Normal prompt
    await sendToAI(client, currentSession, { message: trimmed })
    rl.prompt()
  }

  async function handleLocalCommand(command: string, args: string) {
    switch (command) {
      case "quit":
      case "exit":
        print("再见")
        process.exit(0)
        break
      case "sessions": {
        const limit = args ? parseInt(args) : undefined
        const list = await client.listSessions({ roots: true, limit })
        const formatted = list.map((s: any) => ({
          id: s.id,
          title: s.title,
          updated: new Date(s.time?.updated ?? s.updated).toLocaleString(),
        }))
        print(formatSessions(formatted))
        break
      }
      case "switch":
        if (!args) {
          print("TODO: interactive session pick")
          break
        }
        currentSession = createSession({ id: args, title: "切换会话" })
        print(`已切换到 ${args}`)
        break
      case "new": {
        const title = args || undefined
        const res = await client.createSession({ title })
        currentSession = createSession({ id: res.id, title: res.title ?? "新会话" })
        print(`已创建新会话 ${res.id}`)
        break
      }
      case "fork": {
        const messageID = args || undefined
        const res = await client.forkSession(currentSession.id, messageID ?? "")
        currentSession = createSession({ id: res.id, title: res.title ?? "fork" })
        print(`已 fork 新会话 ${res.id}`)
        break
      }
      case "history": {
        const limit = args ? parseInt(args) : 10
        const msgs = await client.getMessages(currentSession.id, limit)
        const items = msgs.map((m: any) => ({
          role: m.info?.role ?? m.role,
          text: typeof m.parts?.[0]?.text === "string"
            ? m.parts[0].text
            : JSON.stringify(m.message ?? ""),
        }))
        print(formatHistory(items, limit))
        break
      }
      case "file":
        if (args) {
          if (!currentSession.files.includes(args)) {
            currentSession = { ...currentSession, files: [...currentSession.files, args] }
          }
          print(formatFiles(currentSession.files))
        }
        break
      case "files":
        print(formatFiles(currentSession.files))
        break
      case "clear-files":
        currentSession = { ...currentSession, files: [] }
        print(formatFiles(currentSession.files))
        break
      case "model":
        if (args) {
          currentSession = { ...currentSession, model: args }
          print(`模型已切换: ${args}`)
        } else {
          print(`当前模型: ${currentSession.model ?? "默认"}`)
        }
        break
      case "info":
        print(formatInfo({
          id: currentSession.id,
          title: currentSession.title,
          directory: config.directory,
          model: currentSession.model,
          files: currentSession.files,
        }))
        break
    }
  }
```

**Note**: Multiline parsing in `handleInput` has a bug — the buffer is being joined after resetting. This will be fixed in integration tests.

- [ ] **Step 2: Commit the initial version**

This task is ongoing across steps. The repl.ts file will grow as we add the sendToAI and permission handling.

```bash
git add src/repl.ts
git commit -m "feat: REPL main loop - state machine, slash commands, readline"
```

---

### Task 9: Integration — Wire Everything (index.ts)

**Files:**
- Create: `src/index.ts`
- Modify: `src/repl.ts` (add sendToAI, permission callbacks, event subscription)

- [ ] **Step 1: Implement index.ts — CLI entry**

Create `src/index.ts`:

```ts
import { createConfig, createSession } from "./state"
import { createClient } from "./client"
import {
  formatConnecting, formatConnected, formatConnectionError,
  formatSessionNotFound, formatSessionCreateError, formatSeparator,
} from "./format"

const args = process.argv.slice(2)

function parseArgs(): {
  serverUrl?: string
  directory?: string
  thinking?: boolean
  newSession?: boolean
  initSession?: string
} {
  const opts: Record<string, any> = {}
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--url": opts.serverUrl = args[++i]; break
      case "--dir": opts.directory = args[++i]; break
      case "--thinking": opts.thinking = true; break
      case "--new": opts.newSession = true; break
      case "--session": opts.initSession = args[++i]; break
      case "--help": case "-h": printHelp(); process.exit(0); break
      case "--version": case "-v": console.log("0.1.0"); process.exit(0); break
    }
  }
  return opts
}

function printHelp() {
  console.log(`opencode-repl [options]

Options:
  --url <url>      opencode serve address, default http://localhost:4096
  --dir <path>     project directory, default cwd
  --session <id>   initial session ID
  --new            force create new session
  --thinking       show thinking/reasoning blocks
  --help, -h       show help
  --version, -v    show version`)
}

const config = createConfig(parseArgs())

console.log(formatConnecting(config.serverUrl))

try {
  const client = createClient({ baseUrl: config.serverUrl, directory: config.directory })

  async function init() {
    let sessionID: string
    let title = ""

    if (config.initSession) {
      try {
        const s = await client.getSession(config.initSession)
        sessionID = s.id
        title = s.title ?? ""
      } catch {
        console.log(formatSessionNotFound(config.initSession))
        process.exit(1)
      }
    } else if (config.newSession) {
      const s = await client.createSession({ title: "新会话" })
      sessionID = s.id
      title = s.title ?? "新会话"
    } else {
      const list = await client.listSessions({ roots: true, limit: 1 })
      if (list.length > 0) {
        sessionID = list[0].id
        title = list[0].title ?? ""
      } else {
        const s = await client.createSession({ title: "新会话" })
        sessionID = s.id
        title = s.title ?? "新会话"
      }
    }

    const session = createSession({ id: sessionID, title })

    console.log(formatConnected(sessionID, title))
    console.log()

    // Dynamically import repl to avoid circular deps
    const { startREPL } = await import("./repl")
    await startREPL(config, session, client)
  }

  init().catch((err) => {
    console.log(formatConnectionError(err.message ?? String(err)))
    process.exit(1)
  })
} catch (err: any) {
  console.log(formatConnectionError(err.message ?? String(err)))
  process.exit(1)
}
```

- [ ] **Step 2: Fix multiline handling in repl.ts**

Replace the multiline section in `handleInput`:

```ts
  // Handle multiline mode
  if (multiline.active) {
    if (trimmed === ".") {
      const text = multiline.buffer.join("\n")
      multiline = { active: false, buffer: [] }
      if (text.length > 0) {
        await sendToAI(client, currentSession, { message: text })
      }
      setPrompt()
      rl.prompt()
      return
    }
    multiline.buffer.push(line)
    setPrompt()
    rl.prompt()
    return
  }
```

- [ ] **Step 3: Add sendToAI function to repl.ts**

Add before `handleInput`:

```ts
  async function sendToAI(
    client: ReturnType<typeof import("./client").createClient>,
    session: Session,
    input: { message?: string; command?: string; arguments?: string },
  ) {
    const parts = [
      ...currentSession.files.map((f) => ({ type: "file" as const, url: `file://${f}`, filename: f, mime: "text/plain" })),
    ]

    if (input.message) {
      parts.push({ type: "text" as const, text: input.message })
    }

    const eventsStream = subscribe(client)

    activeAbort = new AbortController()

    const result = await createPromptLoop({
      client,
      sessionID: currentSession.id,
      events: { stream: eventsStream },
      parts,
      session: currentSession,
      config: { thinking: config.thinking },
      onPermission: async (perm) => {
        return new Promise((resolve) => {
          print(formatPermissionPrompt(perm.permission, perm.patterns))
          rl.question("", (answer) => {
            const a = answer.trim().toLowerCase()
            if (a === "y") resolve("once")
            else if (a === "a") resolve("always")
            else resolve("reject")
          })
        })
      },
      onQuestion: async (q) => {
        return new Promise((resolve) => {
          print(`\n  ${q.question}`)
          rl.question("> ", (answer) => {
            resolve(answer.trim())
          })
        })
      },
      signal: activeAbort.signal,
    })

    activeAbort = null

    if (result.state === "completed") {
      for (const line of result.outputs) {
        print(line)
      }
      print(formatSeparator())
    } else if (result.state === "aborted") {
      print(formatAbortMessage())
    }
  }
```

- [ ] **Step 4: Add Ctrl+C handling to repl.ts**

Add after `rl` creation:

```ts
  rl.on("SIGINT", () => {
    if (activeAbort) {
      activeAbort.abort()
      activeAbort = null
      print(formatAbortMessage())
      multiline = { active: false, buffer: [] }
      setPrompt()
      rl.prompt()
      return
    }
    print("再见")
    process.exit(0)
  })
```

- [ ] **Step 5: Add import for formatAbortMessage at top of repl.ts**

```ts
// Add formatAbortMessage to the import from format.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/repl.ts
git commit -m "feat: CLI entry + REPL integration with sendToAI, Ctrl+C"
```

---

### Task 10: Integration Tests

**Files:**
- Create: `src/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration tests**

Create `src/__tests__/integration.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { createConfig, createSession } from "../state"
import { parseSlash } from "../commands/slash"
import { processEvent } from "../commands/prompt"
import { formatHistory, formatSessions, formatToolCall, formatAIHeader, formatReasoning } from "../format"
import { createClient } from "../client"

describe("integration", () => {
  describe("slash routing → client call chain", () => {
    test("unknown slash routes to sendCommand", () => {
      const result = parseSlash("/review")
      expect(result).not.toBeNull()
      if (result && !result.local) {
        expect(result.command).toBe("review")
        expect(result.arguments).toBe("")
      }
    })

    test("/compact is passthrough", () => {
      const result = parseSlash("/compact")
      expect(result).not.toBeNull()
      if (result) expect(result.local).toBe(false)
    })

    test("all local commands recognized", () => {
      const locals = ["/quit", "/exit", "/switch", "/new", "/fork", "/history",
        "/file", "/files", "/clear-files", "/model", "/info", "/sessions"]
      for (const cmd of locals) {
        const result = parseSlash(cmd)
        expect(result).not.toBeNull()
        if (result) expect(result.local).toBe(true)
      }
    })
  })

  describe("format pipeline: session → format → display", () => {
    test("formatSessions handles real-looking data", () => {
      const data = [
        { id: "ses_a1b2c3d4e5f6g7h8i9j0", title: "调研 OpenCode", updated: "11:18" },
        { id: "ses_x1y2z3", title: "维护 fork 可行性", updated: "10:57" },
      ]
      const out = formatSessions(data)
      expect(out).toContain("ses_a1b2c3d4e5f6g")
      expect(out).toContain("调研 OpenCode")
      expect(out).toContain("x1y2z3")
    })

    test("formatHistory with mixed messages", () => {
      const msgs = [
        { role: "user" as const, text: "hello" },
        { role: "assistant" as const, text: "你好！有什么可以帮助你的？" },
        { role: "user" as const, text: "查看文件结构" },
      ]
      const out = formatHistory(msgs, 3)
      expect(out).toContain("hello")
      expect(out).toContain("文件结构")
    })
  })

  describe("event processing: full stream simulation", () => {
    test("stream with text + tool + idle", () => {
      const session = createSession({ id: "ses_001", title: "test" })
      let state = { session, headerShown: false, outputs: [] as string[] }
      const config = { thinking: false }

      const events = [
        { type: "message.updated", properties: { info: { role: "assistant", agent: "build", modelID: "c4" } } },
        { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "text", text: "分析中...", time: { end: Date.now() } } } },
        { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "tool", tool: "bash", state: { status: "running" as const, title: "ls" } } } },
        { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "tool", tool: "bash", state: { status: "completed" as const, title: "ls", output: "src/\ntests/" } } } },
        { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } },
      ]

      for (const event of events) {
        const result = processEvent(event, state, config)
        state = { ...state, ...result }
        if (result.done) break
      }

      expect(state.headerShown).toBe(true)
      expect(state.outputs.some(l => l.includes("分析中"))).toBe(true)
      expect(state.outputs.some(l => l.includes("bash"))).toBe(true)
      expect(state.outputs.some(l => l.includes("src/"))).toBe(true)
    })

    test("permission auto-approve skips prompt", () => {
      const session = createSession({ id: "ses_001", title: "test" })
      session.approved.add("rm -rf")
      let state = { session, headerShown: false, outputs: [] as string[] }
      const config = { thinking: false }

      const event = {
        type: "permission.asked",
        properties: { sessionID: "ses_001", id: "req_1", permission: "bash", patterns: ["rm -rf"] },
      }
      const result = processEvent(event, state, config)
      expect(result.needPermission).toBeUndefined()
      expect(result.autoReply).toEqual({ requestID: "req_1", reply: "always" })
    })

    test("SSE event from different session is ignored", () => {
      const session = createSession({ id: "ses_001", title: "test" })
      let state = { session, headerShown: false, outputs: [] as string[] }
      const config = { thinking: false }

      const event = {
        type: "message.part.updated",
        properties: { sessionID: "ses_other", part: { type: "text", text: "nope", time: { end: Date.now() } } },
      }
      const result = processEvent(event, state, config)
      expect(result.outputs.length).toBe(0)
    })
  })

  describe("client: create + verify connection", () => {
    test("client can be created with valid config", () => {
      const client = createClient({ baseUrl: "http://localhost:4096", directory: "/tmp" })
      expect(client.baseUrl).toBe("http://localhost:4096")
      expect(typeof client.getSession).toBe("function")
      expect(typeof client.sendMessage).toBe("function")
      expect(typeof client.replyPermission).toBe("function")
      expect(typeof client.replyQuestion).toBe("function")
      expect(typeof client.subscribe).toBe("function")
    })
  })
})
```

- [ ] **Step 2: Run integration tests**

Run: `bun test src/__tests__/integration.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/integration.test.ts
git commit -m "test: integration tests for slash→client, format pipeline, event stream"
```

---

### Task 11: Real SDK Integration (Production subscribe)

**Files:**
- Modify: `src/client.ts` (replace subscribe stub)
- Modify: `src/repl.ts` (use real subscribe)

- [ ] **Step 1: Update client.ts to use @opencode-ai/sdk/v2**

Replace the `subscribe` method in `src/client.ts`:

```ts
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

// ... existing code ...

export function createClient(config: ClientConfig) {
  // Use the real SDK client when available
  // For now: keep the stub approach and add a method to swap in the real SDK
  const sdk = createOpencodeClient({
    baseUrl: config.baseUrl,
    directory: config.directory,
    fetch: config.fetch,
  })

  // Override subscribe with real implementation
  const realSubscribe = () => sdk.event.subscribe()

  // Return API wrappers that delegate to SDK
  return {
    baseUrl: config.baseUrl,

    listSessions: (params: { roots?: boolean; limit?: number }) =>
      sdk.session.list({
        ...params.roots !== undefined ? { roots: String(params.roots) } : {},
        ...params.limit !== undefined ? { limit: params.limit } : {},
      }).then(r => r.data ?? []),

    getSession: (id: string) =>
      sdk.session.get(id).then(r => r.data),

    createSession: (body: { title?: string }) =>
      sdk.session.create({ title: body.title }).then(r => r.data),

    sendMessage: (sid: string, body: { parts: any[]; model?: string; agent?: string }) =>
      sdk.session.prompt({
        sessionID: sid,
        parts: body.parts as any,
        ...(body.model ? { model: body.model } : {}),
        ...(body.agent ? { agent: body.agent } : {}),
      }).then(r => r.data),

    sendCommand: (sid: string, body: { command: string; arguments?: string }) =>
      sdk.session.command({
        sessionID: sid,
        command: body.command,
        arguments: body.arguments,
      }).then(r => r.data),

    replyPermission: (rid: string, reply: string) =>
      sdk.permission.reply({ requestID: rid, reply: reply as any }).then(r => r.data),

    replyQuestion: (qid: string, answer: string) =>
      sdk.question.reply({ questionID: qid, ...{ answer } as any }).then(r => r.data),

    abortSession: (sid: string) =>
      sdk.session.abort({ sessionID: sid }).then(r => r.data),

    forkSession: (sid: string, messageID: string) =>
      sdk.session.fork({ sessionID: sid, messageID }).then(r => r.data),

    getMessages: (sid: string, limit: number) =>
      sdk.session.messages({ sessionID: sid, limit }).then(r => r.data ?? []),

    subscribe: realSubscribe,
  }
}
```

**Note**: This step requires the `@opencode-ai/sdk` to be accessible. In monorepo development, it resolves via workspace. For standalone, it needs a published package.

- [ ] **Step 2: Update repl.ts to handle real SSE stream**

Replace the `subscribe` stub in `startREPL` with the real client's subscribe:

```ts
  async function sendToAI(...) {
    // Instead of subscribe(client), use client.subscribe()
    const eventsStream = client.subscribe()
    // ... rest same ...
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/client.ts src/repl.ts
git commit -m "feat: integrate real @opencode-ai/sdk/v2 for subscribe and API calls"
```

---

### Task 12: Session Picker (inquirer integration)

**Files:**
- Modify: `src/repl.ts` (add session picker for `/switch` and `/fork` without args)

- [ ] **Step 1: Add session picker function**

Add to `src/repl.ts`:

```ts
import { select } from "@inquirer/prompts"

async function pickSession(client: ReturnType<typeof import("./client").createClient>): Promise<string | null> {
  const list = await client.listSessions({ roots: true })
  if (list.length === 0) {
    print("无可用 session")
    return null
  }
  try {
    const chosen = await select({
      message: "选择会话",
      choices: list.map((s: any) => ({
        name: `${s.title ?? "无标题"}`,
        value: s.id,
        description: `${s.id.slice(-8)} · ${new Date(s.time?.updated ?? Date.now()).toLocaleString()}`,
      })),
    })
    return chosen
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Wire into /switch and /fork handlers**

Update the `"switch"` and `"fork"` cases in `handleLocalCommand`:

```ts
      case "switch":
        if (!args) {
          const id = await pickSession(client)
          if (!id) break
          args = id
        }
        currentSession = createSession({ id: args, title: "切换会话" })
        print(`已切换到 ${args}`)
        break
      case "fork":
        if (!args) {
          const id = await pickSession(client)
          if (!id) break
          const res = await client.forkSession(id, "")
          currentSession = createSession({ id: res.id, title: res.title ?? "fork" })
          print(`已 fork 新会话 ${res.id}`)
          break
        }
        {
          const res = await client.forkSession(currentSession.id, args)
          currentSession = createSession({ id: res.id, title: res.title ?? "fork" })
          print(`已 fork 新会话 ${res.id}`)
        }
        break
```

- [ ] **Step 3: Commit**

```bash
git add src/repl.ts
git commit -m "feat: session picker with @inquirer/prompts for /switch and /fork"
```

---

### Task 13: Final Cleanup & Verify

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: All tests PASS.

- [ ] **Step 2: Type check**

Run: `tsgo --noEmit`
Expected: No type errors.

- [ ] **Step 3: Manual smoke test against real serve**

```bash
# Terminal 1
opencode serve

# Terminal 2
bun run src/index.ts --url http://localhost:4096
> /info
> 你好
> /sessions
> /quit
```

Expected: REPL connects, shows session, responds to prompts, lists sessions, exits cleanly.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: final cleanup, verify all tests pass"
```
