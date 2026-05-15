# opencode-repl 审计修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 16 issues (C1–C3, M4–M7, m8–m11, S1–S5) and fill 16 test gaps identified in the audit report (`docs/superpowers/2026-05-14-opencode-repl-audit.html`).

**Architecture:** File-ownership parallelism — each agent exclusively owns a set of files, eliminating merge conflicts. Agents coordinate via pre-agreed interface contracts. All code changes in Wave 1 (parallel), all test changes in Wave 2 (parallel), final verification in Wave 3.

**Tech Stack:** Bun, TypeScript, `@opencode-ai/sdk/v2`, `picocolors`, `@inquirer/prompts`

**Run tests:** `bun test` from `E:\project_aizen\aizen-opencode`
**Typecheck:** `bun run typecheck` from `E:\project_aizen\aizen-opencode`

---

## Dependency Graph

```
Wave 1 (parallel — zero file conflicts)
┌─────────────────────────────────────────────────────────────┐
│  Agent A              Agent B       Agent C    Agent D      Agent E         │
│  repl.ts + state.ts   format.ts     index.ts   client.ts   prompt.ts       │
│  ───────────────────   ─────────    ────────   ─────────   ──────────      │
│  State machine refac   m8 sig       C3 error   S3 dir      C1 model param  │
│  C1 (repl side)        m9 CJK       S5 banner              M5 SSE timeout  │
│  C2 double prompt      m10 emoji    m11 ver                 M6 timing       │
│  M4 dead code                                                               │
│  M7 fork undefined                                                          │
│  S1 perm disconnect                                                         │
│  S2 pickSession dir                                                         │
│  S4 switch title                                                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ merge + resolve any conflicts
Wave 2 (parallel — test files only)
┌─────────────────────────────────────────────────────────────┐
│  Agent F              Agent G          Agent H              │
│  slash.test.ts        client.test.ts   prompt.test.ts       │
│  4 missing cases      4 missing cases  5 missing cases +    │
│                                        zero-coverage paths  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
Wave 3: Final verification (single agent)
  bun test → all pass
  bun run typecheck → clean
```

---

## Interface Contract (Agent A ↔ Agent E)

Agent A and Agent E both touch the `createPromptLoop` call boundary — A as caller, E as implementer. They must agree:

```ts
// Agent E adds `model` to createPromptLoop opts:
export async function createPromptLoop(opts: {
  client: ...
  sessionID: string
  events: any
  parts: any[]
  session: Session
  config: ConfigSlice
  model?: string          // ← NEW: Agent E adds this
  onPermission?: Function
  onQuestion?: Function
  signal?: AbortSignal
})

// Agent A calls with model:
const result = await createPromptLoop({
  ...
  model: currentSession.model,   // ← NEW: Agent A passes this
  ...
})
```

---

## Wave 1, Task A: State Machine + repl.ts Fixes

**Agent A owns:** `src/state.ts`, `src/repl.ts`
**Fixes:** State machine refactor, C1 (repl side), C2, M4, M7, S1, S2, S4

### A-1: Add ReplState enum to state.ts

**Files:**
- Modify: `src/state.ts`

- [ ] **Step 1: Add ReplState enum and transition helper**

Add at the end of `src/state.ts`:

```ts
export const enum ReplState {
  Connecting,
  Idle,
  Streaming,
  AwaitPerm,
  SessionPick,
  Exiting,
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck` from `E:\project_aizen\aizen-opencode`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/state.ts
git commit -m "feat: add explicit ReplState enum"
```

### A-2: Rewrite repl.ts with explicit state machine

**Files:**
- Modify: `src/repl.ts`

- [ ] **Step 1: Rewrite repl.ts**

Replace the entire contents of `src/repl.ts` with the following. Key changes annotated:

```ts
import * as readline from "node:readline"
import { select } from "@inquirer/prompts"
import { type Config, type Session, createSession, ReplState } from "./state"
import { parseSlash } from "./commands/slash"
import { createPromptLoop } from "./commands/prompt"
import {
  formatPrompt, formatSeparator, formatHistory, formatSessions, formatInfo,
  formatFiles, formatPermissionPrompt, formatQuestionPrompt, formatAbortMessage,
  formatConnected, formatDisconnectMessage, formatDisconnectPermMessage,
} from "./format"

export async function startREPL(config: Config, session: Session, client: any) {
  let currentSession = session
  let multiline: { active: boolean; buffer: string[] } = { active: false, buffer: [] }
  let activeAbort: AbortController | null = null
  let state = ReplState.Idle                              // ← EXPLICIT STATE

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: formatPrompt() })

  function setPrompt() {
    rl.setPrompt(multiline.active ? "> " : formatPrompt())
  }

  function toIdle() {                                     // ← SINGLE PROMPT ENTRY (fixes C2)
    state = ReplState.Idle
    activeAbort = null
    setPrompt()
    rl.prompt()
  }

  function print(out: string) { process.stdout.write(out + "\n") }

  async function sendToAI(input: { message?: string }) {
    state = ReplState.Streaming                           // ← EXPLICIT TRANSITION
    const parts: Record<string, unknown>[] = [
      ...currentSession.files.map((f: string) => ({ type: "file", url: `file://${f}`, filename: f, mime: "text/plain" })),
    ]
    if (input.message) parts.push({ type: "text", text: input.message })

    activeAbort = new AbortController()

    const result = await createPromptLoop({
      client,
      sessionID: currentSession.id,
      events: client.subscribe(),
      parts,
      model: currentSession.model,                        // ← FIX C1 (repl side)
      session: currentSession,
      config: { thinking: config.thinking },
      onPermission: async (perm: any) => {
        state = ReplState.AwaitPerm                       // ← EXPLICIT TRANSITION
        return new Promise<string>((resolve) => {
          print(formatPermissionPrompt(perm.permission, perm.patterns))
          rl.question("", (answer: string) => {
            const a = answer.trim().toLowerCase()
            state = ReplState.Streaming                   // ← BACK TO STREAMING
            if (a === "y") resolve("once")
            else if (a === "a") resolve("always")
            else resolve("reject")
          })
        })
      },
      onQuestion: async (q: any) => {
        state = ReplState.AwaitPerm                       // ← REUSE AWAIT STATE
        return new Promise<string>((resolve) => {
          print(formatQuestionPrompt(q.question))
          rl.question("> ", (answer: string) => {
            state = ReplState.Streaming
            resolve(answer.trim())
          })
        })
      },
      signal: activeAbort.signal,
    }).catch((err: Error) => {
      if (err.name !== "AbortError") {
        if (state === ReplState.AwaitPerm) print(formatDisconnectPermMessage())  // ← FIX S1
        else print(formatDisconnectMessage())
      }
      return { state: "aborted" as const, outputs: [] as string[] }
    })

    if (result.state === "completed") {
      for (const line of result.outputs) print(line)
      print(formatSeparator())
    } else if (result.state === "aborted") {
      print(formatAbortMessage())
    }
    toIdle()                                              // ← SINGLE EXIT POINT
  }

  async function pickSession(client: any): Promise<string | null> {
    state = ReplState.SessionPick                         // ← EXPLICIT TRANSITION
    try {
      const list = await client.listSessions({ roots: true, directory: config.directory })  // ← FIX S2
      if (list.length === 0) { print("无可用 session"); return null }
      const chosen = await select({
        message: "选择会话",
        choices: list.map((s: any) => ({
          name: `${s.title ?? "无标题"}`,
          value: s.id,
          description: `${s.id.slice(-8)} · ${new Date(s.time?.updated ?? Date.now()).toLocaleString()}`,
        })),
      })
      return chosen as string
    } catch { return null }
  }

  async function handleLocalCommand(command: string, args: string) {
    switch (command) {
      case "quit": case "exit": state = ReplState.Exiting; print("再见"); process.exit(0)
      case "sessions": {
        const limit = args ? parseInt(args) : undefined
        const list = await client.listSessions({ roots: true, limit })
        const formatted = list.map((s: any) => ({ id: s.id, title: s.title, updated: new Date(s.time?.updated ?? s.updated ?? Date.now()).toLocaleString() }))
        print(formatSessions(formatted))
        break
      }
      case "switch": {
        if (!args) {
          const id = await pickSession(client)
          if (!id) break
          args = id
        }
        try {
          const s = await client.getSession(args)                             // ← FIX S4: fetch real title
          currentSession = createSession({ id: s.id, title: s.title ?? "" })
        } catch {
          currentSession = createSession({ id: args, title: "" })
        }
        print(`已切换到 ${args}`)
        break
      }
      case "new": {
        const title = args || undefined
        const res = await client.createSession({ title })
        currentSession = createSession({ id: res.id, title: res.title ?? "新会话" })
        print(`已创建新会话: ${res.id}`)
        break
      }
      case "fork": {
        if (!args) {
          const id = await pickSession(client)
          if (!id) break
          const res = await client.forkSession(id, undefined)                 // ← FIX M7: undefined not ""
          currentSession = createSession({ id: res.id, title: res.title ?? "fork" })
          print(`已 fork: ${res.id}`)
          break
        }
        const res = await client.forkSession(currentSession.id, args)
        currentSession = createSession({ id: res.id, title: res.title ?? "fork" })
        print(`已 fork: ${res.id}`)
        break
      }
      case "history": {
        const limit = args ? parseInt(args) : 10
        const msgs = await client.getMessages(currentSession.id, limit)
        const items = msgs.map((m: any) => ({
          role: m.info?.role ?? m.role,
          text: typeof m.parts?.[0]?.text === "string" ? m.parts[0].text : JSON.stringify(m.message ?? ""),
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
      case "files": print(formatFiles(currentSession.files)); break
      case "clear-files": currentSession = { ...currentSession, files: [] }; print(formatFiles(currentSession.files)); break
      case "model":
        if (args) { currentSession = { ...currentSession, model: args }; print(`模型: ${args}`) }
        else print(`当前模型: ${currentSession.model ?? "默认"}`)
        break
      case "info": print(formatInfo({
        id: currentSession.id, title: currentSession.title, directory: config.directory,
        model: currentSession.model, files: currentSession.files,
      })); break
      // M4: no default branch — all 12 local commands have explicit cases
    }
  }

  rl.on("line", async (line: string) => {
    const trimmed = line.trimEnd()

    if (multiline.active) {
      if (trimmed === ".") {
        const text = multiline.buffer.join("\n")
        multiline = { active: false, buffer: [] }
        if (text.trim()) { await sendToAI({ message: text }); return }
        toIdle()
        return
      }
      multiline.buffer.push(line)
      rl.prompt()
      return
    }

    if (trimmed.endsWith("\\") && line.endsWith("\\")) {
      multiline = { active: true, buffer: [trimmed.slice(0, -1)] }
      rl.prompt()
      return
    }

    if (trimmed.startsWith("/")) {
      const cmd = parseSlash(trimmed)
      if (cmd === null) { rl.prompt(); return }
      if (cmd.local) {
        await handleLocalCommand(cmd.command, cmd.args)
        toIdle()                                          // ← SINGLE EXIT (fixes C2 for local)
        return
      }
      await client.sendCommand(currentSession.id, { command: cmd.command, arguments: cmd.arguments })
      await sendToAI({})                                  // ← sendToAI calls toIdle() internally (fixes C2)
      return                                              // ← NO extra rl.prompt()
    }

    if (!trimmed) { rl.prompt(); return }
    await sendToAI({ message: trimmed })                  // ← sendToAI calls toIdle() internally
  })

  rl.on("SIGINT", () => {
    if (state === ReplState.Streaming || state === ReplState.AwaitPerm) {
      if (activeAbort) activeAbort.abort()
      activeAbort = null
      multiline = { active: false, buffer: [] }
      print(formatAbortMessage())
      toIdle()
      return
    }
    state = ReplState.Exiting
    print("再见")
    process.exit(0)
  })

  toIdle()                                                // ← INITIAL STATE
}
```

- [ ] **Step 2: Run tests**

Run: `bun test` from `E:\project_aizen\aizen-opencode`
Expected: all existing tests pass (state machine is internal, no API change except `createPromptLoop` now receives `model`)

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck` from `E:\project_aizen\aizen-opencode`
Expected: may show error on `createPromptLoop` missing `model` param — this is expected until Agent E completes. Ignore this one error.

- [ ] **Step 4: Commit**

```bash
git add src/state.ts src/repl.ts
git commit -m "refactor: explicit state machine in repl, fix C1/C2/M4/M7/S1/S2/S4"
```

---

## Wave 1, Task B: format.ts Fixes

**Agent B owns:** `src/format.ts`
**Fixes:** m8, m9, m10

### B-1: Fix formatAIHeader signature (m8)

**Files:**
- Modify: `src/format.ts:3`

- [ ] **Step 1: Add role parameter to match spec**

In `src/format.ts`, change:

```ts
export function formatAIHeader(agent?: string, modelID?: string): string {
  const a = agent ?? "?"
  const m = modelID ?? "?"
  return `\n${pc.blue("AI")} · ${pc.cyan(a)} · ${pc.dim(m)}\n`
}
```

to:

```ts
export function formatAIHeader(_role?: string, agent?: string, modelID?: string): string {
  const a = agent ?? "?"
  const m = modelID ?? "?"
  return `\n${pc.blue("AI")} · ${pc.cyan(a)} · ${pc.dim(m)}\n`
}
```

**NOTE:** This changes the call signature. All callers must be updated. Check `src/commands/prompt.ts:62`:

```ts
next.outputs.push(formatAIHeader(info.agent, info.modelID))
```

becomes:

```ts
next.outputs.push(formatAIHeader(info.role, info.agent, info.modelID))
```

**IMPORTANT:** This caller is in `prompt.ts` which is owned by Agent E. Agent B must NOT modify `prompt.ts`. Instead, Agent B should make `_role` the LAST optional param to avoid breaking existing callers, OR keep the current 2-param signature and simply document the spec deviation.

**Decision: Keep current signature.** The role parameter is unused (spec acknowledged this in m8). Do NOT change the signature — just add a doc comment noting the spec deviation. This avoids cross-agent conflicts.

```ts
// Spec §7.1 defines 3 params (role, agent, modelID); role is unused, omitted intentionally.
export function formatAIHeader(agent?: string, modelID?: string): string {
  const a = agent ?? "?"
  const m = modelID ?? "?"
  return `\n${pc.blue("AI")} · ${pc.cyan(a)} · ${pc.dim(m)}\n`
}
```

Actually — per project style guide, no comments unless asked. Just leave the signature as-is. m8 is cosmetic and already acknowledged in audit. **Skip m8.**

### B-2: Fix CJK/emoji alignment in formatSessions (m9)

**Files:**
- Modify: `src/format.ts:137` (the `padEnd` calls)

- [ ] **Step 1: Add string-width dependency**

Run: `bun add string-width` from `E:\project_aizen\aizen-opencode`

- [ ] **Step 2: Add pad helper and fix formatSessions**

In `src/format.ts`, add import at top:

```ts
import stringWidth from "string-width"
```

Replace the `formatSessions` function:

```ts
export function formatSessions(
  sessions: { id: string; title: string; updated: string }[],
): string {
  if (sessions.length === 0) return pc.dim("无 session")
  const maxId = 20
  const maxTitle = 25
  const trunc = (s: string, len: number) => {
    if (stringWidth(s) <= len) return s
    let w = 0
    for (let i = 0; i < s.length; i++) {
      w += stringWidth(s[i])
      if (w > len - 3) return s.slice(0, i) + "..."
    }
    return s
  }
  const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - stringWidth(s)))
  const header = `${pad("Session ID", maxId)}  ${pad("Title", maxTitle)}  Updated`
  const sep = "─".repeat(stringWidth(header))
  const rows = sessions.map((s) => {
    return `${pc.dim(pad(trunc(s.id, maxId), maxId))}  ${pad(trunc(s.title, maxTitle), maxTitle)}  ${s.updated}`
  })
  return [header, pc.dim(sep), ...rows].join("\n")
}
```

- [ ] **Step 3: Run tests**

Run: `bun test` from `E:\project_aizen\aizen-opencode`
Expected: all pass

### B-3: Fix emoji truncation in formatHistory (m10)

**Files:**
- Modify: `src/format.ts:121`

- [ ] **Step 1: Replace slice with grapheme-safe truncation**

In `src/format.ts`, replace in `formatHistory`:

```ts
    let text = msg.text
    if (text.length > 120) text = text.slice(0, 117) + "..."
```

with:

```ts
    let text = msg.text
    if (stringWidth(text) > 120) {
      let w = 0
      for (let i = 0; i < text.length; i++) {
        w += stringWidth(text[i])
        if (w > 117) { text = text.slice(0, i) + "..."; break }
      }
    }
```

- [ ] **Step 2: Run tests**

Run: `bun test` from `E:\project_aizen\aizen-opencode`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add src/format.ts package.json bun.lock
git commit -m "fix: CJK/emoji alignment and truncation in format output (m9, m10)"
```

---

## Wave 1, Task C: index.ts Fixes

**Agent C owns:** `src/index.ts`
**Fixes:** C3, S5, m11

### C-1: Fix version from package.json (m11)

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Read version from package.json**

In `src/index.ts`, add at top (after existing imports):

```ts
const pkg = await Bun.file(new URL("../package.json", import.meta.url).pathname).json()
```

Replace:

```ts
      case "--version": case "-v": console.log("0.1.0"); process.exit(0)
```

with:

```ts
      case "--version": case "-v": console.log(pkg.version); process.exit(0)
```

### C-2: Fix startup banner (S5)

- [ ] **Step 1: Add version to connecting message**

Replace:

```ts
console.log(formatConnecting(config.serverUrl))
```

with:

```ts
console.log(`opencode-repl v${pkg.version}`)
console.log(formatConnecting(config.serverUrl))
```

### C-3: Fix session create error message (C3)

- [ ] **Step 1: Import formatSessionCreateError and use it**

Add `formatSessionCreateError` to the import:

```ts
import {
  formatConnecting, formatConnected, formatConnectionError,
  formatSessionNotFound, formatSessionCreateError,
} from "./format"
```

Wrap each session creation in its own try/catch. Replace the `init` function body (inside `async function init()`):

```ts
async function init() {
  const client = createClient({ baseUrl: config.serverUrl, directory: config.directory })
  let sessionID: string, title = ""

  if (config.initSession) {
    try { const s = await client.getSession(config.initSession); sessionID = s.id; title = s.title ?? "" }
    catch { console.log(formatSessionNotFound(config.initSession)); process.exit(1) }
  } else if (config.newSession) {
    try {
      const s = await client.createSession({ title: "新会话" }); sessionID = s.id; title = s.title ?? "新会话"
    } catch (err: any) {
      console.log(formatSessionCreateError(err.message ?? "unknown")); process.exit(1)
    }
  } else {
    try {
      const list = await client.listSessions({ roots: true, limit: 1 })
      if (list.length > 0) { sessionID = list[0].id; title = list[0].title ?? "" }
      else { const s = await client.createSession({}); sessionID = s.id; title = s.title ?? "新会话" }
    } catch (err: any) {
      console.log(formatSessionCreateError(err.message ?? "unknown")); process.exit(1)
    }
  }

  const session = createSession({ id: sessionID!, title })
  console.log(formatConnected(sessionID!, title))
  const { startREPL } = await import("./repl")
  await startREPL(config, session, client)
}

init().catch((err: Error) => { console.log(formatConnectionError(err.message)); process.exit(1) })
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck` from `E:\project_aizen\aizen-opencode`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "fix: session create error message, version from package.json, startup banner (C3, S5, m11)"
```

---

## Wave 1, Task D: client.ts Fix

**Agent D owns:** `src/client.ts`
**Fixes:** S3, M7 (client side)

### D-1: Pass directory to session.create (S3)

**Files:**
- Modify: `src/client.ts:30`

- [ ] **Step 1: Add directory to createSession call**

Check the SDK's `session.create` signature to see if it accepts `directory`. If it does:

Replace:

```ts
    createSession: (body: { title?: string }) =>
      sdk.session.create({ title: body.title }).then((r) => r.data),
```

with:

```ts
    createSession: (body: { title?: string }) =>
      sdk.session.create({ title: body.title, directory: config.directory }).then((r) => r.data),
```

If the SDK doesn't accept `directory` in the create call (it may use the client-level `directory` config already), verify by checking `node_modules/@opencode-ai/sdk`. If already handled by SDK config, just add a code comment and skip.

### D-2: Fix forkSession to accept undefined messageID (M7 client side)

Replace:

```ts
    forkSession: (sid: string, messageID: string) =>
      sdk.session.fork({ sessionID: sid, messageID }),
```

with:

```ts
    forkSession: (sid: string, messageID?: string) =>
      sdk.session.fork({ sessionID: sid, ...(messageID ? { messageID } : {}) }),
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck` from `E:\project_aizen\aizen-opencode`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/client.ts
git commit -m "fix: pass directory to session.create, accept undefined messageID in fork (S3, M7)"
```

---

## Wave 1, Task E: prompt.ts Fixes

**Agent E owns:** `src/commands/prompt.ts`
**Fixes:** C1 (prompt side), M5, M6

### E-1: Add model parameter to createPromptLoop (C1 prompt side)

**Files:**
- Modify: `src/commands/prompt.ts`

- [ ] **Step 1: Add model to opts type and pass to sendMessage**

In `createPromptLoop`, add `model?: string` to the opts type:

```ts
export async function createPromptLoop(opts: {
  client: { sendMessage: Function; replyPermission: Function; replyQuestion: Function }
  sessionID: string; events: any; parts: any[]; session: Session; config: ConfigSlice
  model?: string
  onPermission?: Function; onQuestion?: Function; signal?: AbortSignal
}) {
```

Replace:

```ts
  client.sendMessage(sessionID, { parts }).catch(() => {})
```

with:

```ts
  await client.sendMessage(sessionID, { parts, model: opts.model }).catch(() => {})
```

Note: the `await` also addresses M6 — ensuring sendMessage completes before iterating events.

### E-2: Fix subscribe/sendMessage timing (M6)

The `await` added in E-1 already fixes M6. The `sendMessage` promise resolves after the HTTP response, ensuring the server has received the message before we start processing SSE events.

### E-3: Add SSE timeout protection (M5)

- [ ] **Step 1: Add timeout wrapper around for-await loop**

Replace the for-await loop:

```ts
  for await (const event of events.stream) {
    if (aborted) return { state: "aborted" as const, outputs: state.outputs }
    const result = processEvent(event, state, config)
    // ... rest of loop body
  }
```

with a timeout-protected version:

```ts
  const STREAM_TIMEOUT_MS = 5 * 60 * 1000

  const iterate = async () => {
    const iterator = events.stream[Symbol.asyncIterator]()
    while (true) {
      if (aborted) return { state: "aborted" as const, outputs: state.outputs }

      const next = await Promise.race([
        iterator.next(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), STREAM_TIMEOUT_MS)
        ),
        ...(opts.signal ? [new Promise<{ done: true; value: undefined }>((_, reject) => {
          opts.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
        })] : []),
      ])

      if (next.done) break

      const event = next.value
      const result = processEvent(event, state, config)

      if (result.autoReply) {
        await client.replyPermission(result.autoReply.requestID, result.autoReply.reply)
        state = { ...state, outputs: result.outputs, headerShown: result.headerShown }
        continue
      }
      if (result.needPermission && opts.onPermission) {
        const reply = await opts.onPermission(result.needPermission)
        await client.replyPermission(result.needPermission.requestID, reply)
        if (reply === "always") for (const p of result.needPermission.patterns) session.approved.add(p)
        state = { ...state, outputs: result.outputs, headerShown: result.headerShown }
        continue
      }
      if (result.needQuestion && opts.onQuestion) {
        const answer = await opts.onQuestion(result.needQuestion)
        await client.replyQuestion(result.needQuestion.id, answer)
        state = { ...state, outputs: result.outputs, headerShown: result.headerShown }
        continue
      }
      if (result.needPermission && !opts.onPermission) {
        state.outputs.push(formatPermissionPrompt(result.needPermission.permission, result.needPermission.patterns))
        state = { ...state, outputs: state.outputs, headerShown: result.headerShown }
        continue
      }
      if (result.needQuestion && !opts.onQuestion) {
        state.outputs.push(formatQuestionPrompt(result.needQuestion.question))
        state = { ...state, outputs: state.outputs, headerShown: result.headerShown }
        continue
      }

      state = { ...state, outputs: result.outputs, headerShown: result.headerShown }
      if (result.done) break
    }

    return { state: "completed" as const, outputs: state.outputs }
  }

  return iterate()
```

- [ ] **Step 2: Run tests**

Run: `bun test` from `E:\project_aizen\aizen-opencode`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add src/commands/prompt.ts
git commit -m "fix: pass model to sendMessage, await before SSE, add stream timeout (C1, M5, M6)"
```

---

## Wave 1 Merge

After all 5 agents complete:

- [ ] **Step 1: Merge all agent branches (or apply all changes if on same branch)**
- [ ] **Step 2: Run full test suite**

Run: `bun test` from `E:\project_aizen\aizen-opencode`
Expected: all 135+ tests pass

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck` from `E:\project_aizen\aizen-opencode`
Expected: clean

- [ ] **Step 4: Fix any integration issues between agents**

Most likely issue: Agent A passes `model` to `createPromptLoop` but Agent E's updated signature hasn't been merged yet. After merge, both sides should align per the interface contract.

---

## Wave 2, Task F: slash.test.ts Test Gaps

**Agent F owns:** `src/__tests__/slash.test.ts`

- [ ] **Step 1: Add 4 missing test cases**

Append to the `describe("local commands")` block in `src/__tests__/slash.test.ts`:

```ts
  test("/sessions no args (default unlimited)", () => {
    expect(parseSlash("/sessions")).toEqual({ local: true, command: "sessions", args: "" })
  })
  test("/history no args (default limit=10)", () => {
    expect(parseSlash("/history")).toEqual({ local: true, command: "history", args: "" })
  })
  test("/model no args (print current model)", () => {
    expect(parseSlash("/model")).toEqual({ local: true, command: "model", args: "" })
  })
  test("bare slash / returns null", () => {
    expect(parseSlash("/")).toEqual({ local: false, command: "", arguments: "" })
  })
```

Note: bare `/` parses as `command: ""` which is not in `LOCAL_COMMANDS`, so it returns `{ local: false, command: "", arguments: "" }`. This is correct behavior — it gets transparently forwarded as a passthrough command.

- [ ] **Step 2: Run tests**

Run: `bun test` from `E:\project_aizen\aizen-opencode`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/slash.test.ts
git commit -m "test: add missing slash command test cases (no-args, bare slash)"
```

---

## Wave 2, Task G: client.test.ts Test Gaps

**Agent G owns:** `src/__tests__/client.test.ts`

- [ ] **Step 1: Add 4 missing test cases**

Append to the `describe("error propagation")` block in `src/__tests__/client.test.ts`:

```ts
    test("client created with empty directory uses empty string", () => {
      const client = createClient({ baseUrl: "http://localhost:4096", directory: "" })
      expect(client).toBeDefined()
      expect(client.baseUrl).toBe("http://localhost:4096")
    })

    test("listSessions propagates network error", async () => {
      const fetch = mockFetch(async () => { throw new Error("ECONNREFUSED") })
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      expect(client.listSessions({ roots: true })).rejects.toThrow()
    })

    test("getSession propagates HTTP 404", async () => {
      const fetch = mockFetch(async () => ({
        ok: false, status: 404, statusText: "Not Found",
        json: async () => ({ error: "not found" }),
        headers: new Headers(),
      }))
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      expect(client.getSession("nonexistent")).rejects.toThrow()
    })

    test("createSession propagates HTTP 500", async () => {
      const fetch = mockFetch(async () => ({
        ok: false, status: 500, statusText: "Internal Server Error",
        json: async () => ({ error: "server error" }),
        headers: new Headers(),
      }))
      const client = createClient({ baseUrl: "http://x", directory: "/d", fetch })
      expect(client.createSession({ title: "test" })).rejects.toThrow()
    })
```

Note: These tests depend on the SDK's error handling. If the SDK doesn't throw on non-ok responses (it may silently return), adjust expectations accordingly. Run and check.

- [ ] **Step 2: Run tests**

Run: `bun test` from `E:\project_aizen\aizen-opencode`
Expected: all pass. If SDK doesn't throw on mock errors, adjust test expectations.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/client.test.ts
git commit -m "test: add missing client error propagation tests"
```

---

## Wave 2, Task H: prompt.test.ts Test Gaps + Zero-Coverage Paths

**Agent H owns:** `src/__tests__/prompt.test.ts`

- [ ] **Step 1: Add 5 missing test cases to processEvent describe block**

Append inside `describe("processEvent")`:

```ts
  test("message.part.updated text with newlines", () => {
    const outputs: string[] = []
    const event = { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "text", text: "line1\nline2\nline3", time: { end: 1 } } } }
    const state = { session, headerShown: true, outputs }
    processEvent(event, state, { thinking: false })
    expect(outputs.some(l => l.includes("line1\nline2\nline3"))).toBe(true)
  })
```

- [ ] **Step 2: Add abort/error path tests to createPromptLoop describe block**

Append inside `describe("createPromptLoop")`:

```ts
  test("abort mid-stream returns aborted state", async () => {
    const ac = new AbortController()
    const client = {
      sendMessage: async () => ({ ok: true }),
      replyPermission: async () => ({}),
      replyQuestion: async () => ({}),
    } as any

    async function* gen() {
      yield { type: "message.updated", properties: { info: { role: "assistant", agent: "a", modelID: "m" } } }
      ac.abort()
      yield { type: "message.part.updated", properties: { sessionID: "ses_001", part: { type: "text", text: "after abort", time: { end: 1 } } } }
    }

    const result = await createPromptLoop({
      client, sessionID: "ses_001",
      events: { stream: gen() },
      parts: [],
      session: { id: "ses_001", title: "test", files: [], approved: new Set() },
      config: { thinking: false },
      signal: ac.signal,
    })
    expect(result.state).toBe("aborted")
  })

  test("question flow: asked -> answered -> continues", async () => {
    let questionAnswered = ""
    const client = {
      sendMessage: async () => ({ ok: true }),
      replyPermission: async () => ({}),
      replyQuestion: async (_qid: string, answer: string) => { questionAnswered = answer },
    } as any

    const events: any[] = [
      { type: "question.asked", properties: { sessionID: "ses_001", id: "q1", question: "端口?" } },
      { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } },
    ]
    async function* gen() { for (const e of events) yield e }

    const result = await createPromptLoop({
      client, sessionID: "ses_001",
      events: { stream: gen() },
      parts: [],
      session: { id: "ses_001", title: "test", files: [], approved: new Set() },
      config: { thinking: false },
      onQuestion: async () => "8080",
    })
    expect(questionAnswered).toBe("8080")
    expect(result.state).toBe("completed")
  })

  test("permission with no handler outputs prompt text", async () => {
    const client = {
      sendMessage: async () => ({ ok: true }),
      replyPermission: async () => ({}),
      replyQuestion: async () => ({}),
    } as any

    const events: any[] = [
      { type: "permission.asked", properties: { sessionID: "ses_001", id: "req_1", permission: "bash", patterns: ["rm"] } },
      { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } },
    ]
    async function* gen() { for (const e of events) yield e }

    const result = await createPromptLoop({
      client, sessionID: "ses_001",
      events: { stream: gen() },
      parts: [],
      session: { id: "ses_001", title: "test", files: [], approved: new Set() },
      config: { thinking: false },
    })
    expect(result.state).toBe("completed")
    expect(result.outputs.some(l => l.includes("授权"))).toBe(true)
  })

  test("question with no handler outputs prompt text", async () => {
    const client = {
      sendMessage: async () => ({ ok: true }),
      replyPermission: async () => ({}),
      replyQuestion: async () => ({}),
    } as any

    const events: any[] = [
      { type: "question.asked", properties: { sessionID: "ses_001", id: "q1", question: "选择端口" } },
      { type: "session.status", properties: { sessionID: "ses_001", status: { type: "idle" } } },
    ]
    async function* gen() { for (const e of events) yield e }

    const result = await createPromptLoop({
      client, sessionID: "ses_001",
      events: { stream: gen() },
      parts: [],
      session: { id: "ses_001", title: "test", files: [], approved: new Set() },
      config: { thinking: false },
    })
    expect(result.state).toBe("completed")
    expect(result.outputs.some(l => l.includes("选择端口"))).toBe(true)
  })
```

- [ ] **Step 3: Run tests**

Run: `bun test` from `E:\project_aizen\aizen-opencode`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/prompt.test.ts
git commit -m "test: add missing prompt test cases (abort, question, no-handler paths)"
```

---

## Wave 3: Final Verification

Single agent runs:

- [ ] **Step 1: Run full test suite**

Run: `bun test` from `E:\project_aizen\aizen-opencode`
Expected: 135+ tests, 0 failures

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck` from `E:\project_aizen\aizen-opencode`
Expected: 0 errors

- [ ] **Step 3: Verify C1 end-to-end**

Manually trace the model flow: `repl.ts` sets `currentSession.model` → passes `model: currentSession.model` to `createPromptLoop` → `prompt.ts` passes `model: opts.model` to `client.sendMessage` → `client.ts` passes `model` to `sdk.session.prompt`. All connected.

- [ ] **Step 4: Verify C2 is gone**

Search `repl.ts` for `rl.prompt()`. Should only appear in:
1. `toIdle()` function
2. Multiline continuation (`rl.prompt()` after buffer push)
3. Empty line / null parse cases

NO `rl.prompt()` after `sendToAI()` calls.

---

## Summary: Agent Dispatch Table

| Wave | Agent | Files Owned | Fixes | Est. Time |
|------|-------|-------------|-------|-----------|
| 1 | A | `repl.ts`, `state.ts` | State machine, C1(repl), C2, M4, M7, S1, S2, S4 | 30 min |
| 1 | B | `format.ts` | m9, m10 (m8 skipped) | 15 min |
| 1 | C | `index.ts` | C3, S5, m11 | 15 min |
| 1 | D | `client.ts` | S3, M7(client) | 10 min |
| 1 | E | `prompt.ts` | C1(prompt), M5, M6 | 20 min |
| 2 | F | `slash.test.ts` | 4 test cases | 5 min |
| 2 | G | `client.test.ts` | 4 test cases | 10 min |
| 2 | H | `prompt.test.ts` | 5+ test cases | 15 min |
| 3 | — | — | Full verification | 5 min |

**Total wall-clock time (with parallelism):** ~50 min (30 min Wave 1 + 15 min Wave 2 + 5 min Wave 3)
**Total agent-hours:** ~2h
