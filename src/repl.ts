import * as readline from "node:readline"
import { select } from "@inquirer/prompts"
import { type Config, type Session, ReplState, createSession } from "./state"
import { parseSlash, LOCAL_COMMANDS } from "./commands/slash"
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
  let state = ReplState.Connecting

  // --- Tab 补全：用户输入 "/" 后按 Tab 键，自动补全或列出所有可用的 slash 命令 ---
  // 补全候选列表：将 LOCAL_COMMANDS 集合转为 "/command" 格式的数组
  const slashCompletions = Array.from(LOCAL_COMMANDS).map(c => `/${c}`)

  // readline completer 函数
  // 参数 line 为当前输入行的全部文本
  // 返回值 [matches, substring]：matches 是匹配的候选项数组，substring 是用于匹配的前缀
  function completer(line: string): [string[], string] {
    // 仅在输入以 "/" 开头时触发补全
    if (line.startsWith("/")) {
      // 只对命令部分做补全（取空格前的部分），已带参数的不再补全命令名
      const spaceIdx = line.indexOf(" ")
      if (spaceIdx !== -1) return [[], line]

      const hits = slashCompletions.filter(c => c.startsWith(line))
      // 如果有匹配，返回匹配项；否则返回全部候选，让用户看到所有可用命令
      return [hits.length ? hits : slashCompletions, line]
    }
    // 非 "/" 开头的输入不做补全
    return [[], line]
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: formatPrompt(), completer })

  function setPrompt() {
    rl.setPrompt(multiline.active ? "> " : formatPrompt())
  }

  function toIdle() {
    state = ReplState.Idle
    setPrompt()
    rl.prompt()
  }

  toIdle()

  function print(out: string) { process.stdout.write(out + "\n") }

  async function sendToAI(input: { message?: string; command?: string; arguments?: string }) {
    state = ReplState.Streaming

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
      session: currentSession,
      config: { thinking: config.thinking },
      onPermission: async (perm: any) => {
        state = ReplState.AwaitPerm
        return new Promise<string>((resolve) => {
          print(formatPermissionPrompt(perm.permission, perm.patterns))
          rl.question("", (answer: string) => {
            state = ReplState.Streaming
            const a = answer.trim().toLowerCase()
            if (a === "y") resolve("once")
            else if (a === "a") resolve("always")
            else resolve("reject")
          })
        })
      },
      onQuestion: async (q: any) => {
        return new Promise<string>((resolve) => {
          print(formatQuestionPrompt(q.question))
          rl.question("> ", (answer: string) => { resolve(answer.trim()) })
        })
      },
      signal: activeAbort.signal,
    }).catch((err: Error) => {
      if (err.name !== "AbortError") {
        print(state === ReplState.AwaitPerm ? formatDisconnectPermMessage() : formatDisconnectMessage())
        console.error(err.stack)
      }
      return { state: "aborted" as const, outputs: [] as string[] }
    })

    activeAbort = null

    if (result.state === "completed") {
      for (const line of result.outputs) print(line)
      print(formatSeparator())
    }
    if (result.state === "aborted") print(formatAbortMessage())
    toIdle()
  }

  async function pickSession(client: any): Promise<string | null> {
    const prev = state
    state = ReplState.SessionPick
    const list = await client.listSessions({ roots: true, directory: config.directory })
    if (list.length === 0) { state = prev; print("无可用 session"); return null }
    const chosen = await select({
      message: "选择会话",
      choices: list.map((s: any) => ({
        name: `${s.title ?? "无标题"}`,
        value: s.id,
        description: `${s.id.slice(-8)} · ${new Date(s.time?.updated ?? Date.now()).toLocaleString()}`,
      })),
    })
    return chosen as string
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
      case "switch":
        if (!args) {
          const id = await pickSession(client)
          if (!id) break
          args = id
        }
        try {
          const sessionInfo = await client.getSession(args)
          currentSession = createSession({ id: args, title: sessionInfo.title ?? args })
          print(`已切换到 ${args}`)
        } catch (err) {
          const e = err as Error
          print(`切换失败: ${e.message}`)
          console.error(e.stack)
        }
        break
      case "new": {
        const title = args || undefined
        try {
          const res = await client.createSession({ title })
          currentSession = createSession({ id: res.id, title: res.title ?? "新会话" })
          print(`已创建新会话: ${res.id}`)
        } catch (err) {
          const e = err as Error
          print(`创建失败: ${e.message}`)
          console.error(e.stack)
        }
        break
      }
      case "fork": {
        try {
          if (!args) {
            const id = await pickSession(client)
            if (!id) break
            const res = await client.forkSession(id)
            currentSession = createSession({ id: res.id, title: res.title ?? "fork" })
            print(`已 fork: ${res.id}`)
            break
          }
          const res = await client.forkSession(currentSession.id, args)
          currentSession = createSession({ id: res.id, title: res.title ?? "fork" })
          print(`已 fork: ${res.id}`)
        } catch (err) {
          const e = err as Error
          print(`fork 失败: ${e.message}`)
          console.error(e.stack)
        }
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
        if (args) {
          currentSession = { ...currentSession, model: args }
          await client.sendCommand(currentSession.id, { command: "model", arguments: args, model: args })
          print(`模型: ${args}`)
        }
        else print(`当前模型: ${currentSession.model ?? "默认"}`)
        break
      case "info": print(formatInfo({
        id: currentSession.id, title: currentSession.title, directory: config.directory,
        model: currentSession.model, files: currentSession.files,
      })); break
    }
  }

  rl.on("line", async (line: string) => {
    const trimmed = line.trimEnd()

    if (multiline.active) {
      if (trimmed === ".") {
        const text = multiline.buffer.join("\n")
        multiline = { active: false, buffer: [] }
        if (text.trim()) await sendToAI({ message: text })
        else toIdle()
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
      if (cmd === null) { toIdle(); return }
      if (cmd.local) { await handleLocalCommand(cmd.command, cmd.args); toIdle(); return }
      await client.sendCommand(currentSession.id, { command: cmd.command, arguments: cmd.arguments })
      await sendToAI({})
      return
    }

    if (!trimmed) { toIdle(); return }
    await sendToAI({ message: trimmed })
  })

  rl.on("SIGINT", () => {
    if (activeAbort) {
      activeAbort.abort()
      activeAbort = null
      print(formatAbortMessage())
      multiline = { active: false, buffer: [] }
      toIdle()
      return
    }
    state = ReplState.Exiting
    print("再见")
    process.exit(0)
  })
}
