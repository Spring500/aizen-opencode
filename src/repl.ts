import * as readline from "node:readline"
import { type Config, type Session, createSession } from "./state"
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

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: formatPrompt() })

  function setPrompt() {
    rl.setPrompt(multiline.active ? "> " : formatPrompt())
  }
  setPrompt()
  rl.prompt()

  function print(out: string) { process.stdout.write(out + "\n") }

  async function sendToAI(input: { message?: string; command?: string; arguments?: string }) {
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
        return new Promise<string>((resolve) => {
          print(formatPermissionPrompt(perm.permission, perm.patterns))
          rl.question("", (answer: string) => {
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
      if (err.name !== "AbortError") print(formatDisconnectMessage())
      return { state: "aborted" as const, outputs: [] as string[] }
    })

    activeAbort = null

    if (result.state === "completed") {
      for (const line of result.outputs) print(line)
      print(formatSeparator())
    } else if (result.state === "aborted") {
      print(formatAbortMessage())
    }
    setPrompt()
    rl.prompt()
  }

  async function handleLocalCommand(command: string, args: string) {
    switch (command) {
      case "quit": case "exit": print("再见"); process.exit(0)
      case "sessions": {
        const limit = args ? parseInt(args) : undefined
        const list = await client.listSessions({ roots: true, limit })
        const formatted = list.map((s: any) => ({ id: s.id, title: s.title, updated: new Date(s.time?.updated ?? s.updated ?? Date.now()).toLocaleString() }))
        print(formatSessions(formatted))
        break
      }
      case "switch":
        if (!args) { print("用法: /switch <sessionID>"); break }
        currentSession = createSession({ id: args, title: "已切换" })
        print(`已切换到 ${args}`)
        break
      case "new": {
        const title = args || undefined
        const res = await client.createSession({ title })
        currentSession = createSession({ id: res.id, title: res.title ?? "新会话" })
        print(`已创建新会话: ${res.id}`)
        break
      }
      case "fork": {
        const res = await client.forkSession(currentSession.id, args || "")
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
      default:
        await client.sendCommand(currentSession.id, { command, arguments: args })
        await sendToAI({})
    }
  }

  rl.on("line", async (line: string) => {
    const trimmed = line.trimEnd()

    if (multiline.active) {
      if (trimmed === ".") {
        const text = multiline.buffer.join("\n")
        multiline = { active: false, buffer: [] }
        if (text.trim()) await sendToAI({ message: text })
        else { setPrompt(); rl.prompt() }
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
      if (cmd.local) { await handleLocalCommand(cmd.command, cmd.args); rl.prompt(); return }
      await client.sendCommand(currentSession.id, { command: cmd.command, arguments: cmd.arguments })
      await sendToAI({})
      rl.prompt()
      return
    }

    if (!trimmed) { rl.prompt(); return }
    await sendToAI({ message: trimmed })
  })

  rl.on("SIGINT", () => {
    if (activeAbort) { activeAbort.abort(); activeAbort = null; print(formatAbortMessage()); multiline = { active: false, buffer: [] }; setPrompt(); rl.prompt(); return }
    print("再见"); process.exit(0)
  })
}
