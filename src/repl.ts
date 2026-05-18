import * as readline from "node:readline"
import { select, checkbox } from "@inquirer/prompts"
import { type Config, type Session, ReplState, createSession } from "./state"
import { parseSlash, type CommandDef } from "./commands/slash"
import { createPromptLoop } from "./commands/prompt"
import {
  formatPrompt, formatSeparator, formatHistory, formatSessions, formatInfo,
  formatFiles, formatPermissionPrompt, formatQuestionPrompt, formatAbortMessage,
  formatConnected, formatDisconnectMessage, formatDisconnectPermMessage,
  setTerminalTitle,
} from "./format"

export function extractMessageContent(m: any, visibleTypes?: Set<string>): { role: string; lines: Array<{ type: "text" | "reasoning" | "tool" | "tool-output"; content: string }> } {
  const role = m.info?.role ?? m.role
  const lines: Array<{ type: "text" | "reasoning" | "tool" | "tool-output"; content: string }> = []

  for (const part of (m.parts ?? [])) {
    if (visibleTypes && !visibleTypes.has(part.type)) continue
    if (part.type === "text" && typeof part.text === "string" && part.text) {
      lines.push({ type: "text", content: part.text })
    } else if (part.type === "reasoning" && typeof part.text === "string" && part.text) {
      lines.push({ type: "reasoning", content: part.text })
    } else if (part.type === "tool") {
      const st = part.state?.status ?? "unknown"
      const name = part.tool
      const title = part.state?.title ?? name
      const icons: Record<string, string> = { running: "⚙", completed: "✓", error: "✗", pending: "…" }
      const icon = icons[st] ?? "?"
      lines.push({ type: "tool", content: `${icon} [${name}] ${title} (${st})` })
      if (st === "completed" || st === "error") {
        const output = (part.state?.output ?? part.state?.error ?? "")
        if (output) {
          const truncated = output.length > 200 ? output.slice(0, 200) + "..." : output
          lines.push({ type: "tool-output", content: truncated })
        }
      }
    }
  }

  if (lines.length === 0) {
    lines.push({ type: "text", content: "(no text)" })
  }

  return { role, lines }
}

export async function startREPL(config: Config, session: Session, client: any) {
  let currentSession = session
  let multiline: { active: boolean; buffer: string[] } = { active: false, buffer: [] }
  let activeAbort: AbortController | null = null
  let state = ReplState.Connecting
  let visibleParts = new Set(["text", "reasoning", "tool"])

  // --- Tab 补全：由下方命令注册表动态生成候选列表 ---
  let commandMap = new Map<string, CommandDef>()
  let slashCompletions: string[] = []
  let localCommandNames = new Set<string>()

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

  // ========================================================================
  // readline 输入事件处理 — 提取为独立函数以支持重建 readline 接口
  //
  // @inquirer/prompts 的 select() 会接管 stdin 并设置 raw mode，
  // 返回后原 readline 实例无法通过 pause/resume 恢复，必须 close + 重建。
  // 事件处理器提取出来，重建时重新挂载即可。
  // ========================================================================

  // 主输入处理器：处理所有用户输入（消息、命令、多行模式）
  async function onLineInput(line: string) {
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
      const cmd = parseSlash(trimmed, localCommandNames)
      if (cmd === null) { toIdle(); return }
      if (cmd.local) { await handleLocalCommand(cmd.command, cmd.args); toIdle(); return }
      await client.sendCommand(currentSession.id, { command: cmd.command, arguments: cmd.arguments })
      await sendToAI({})
      return
    }

    if (!trimmed) { toIdle(); return }
    await sendToAI({ message: trimmed })
  }

  // Ctrl+C 处理器
  function onSIGINT() {
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
  }

  // 创建 readline 接口并挂载事件处理器
  function createReadline() {
    const rli = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: formatPrompt(), completer })
    rli.on("line", onLineInput)
    rli.on("SIGINT", onSIGINT)
    return rli
  }

  // 销毁当前 readline 实例并重建（用于 @inquirer/prompts 之后恢复 stdin 输入）
  function recreateReadline() {
    rl.close()
    rl = createReadline()
  }

  let rl = createReadline()

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

    try {
      const list = await client.listSessions({ roots: true, directory: config.directory })
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
    } finally {
      state = prev
      // @inquirer/prompts 的 select() 会接管 stdin raw mode，
      // 返回后原 readline 实例已无法恢复，必须 close + 重建
      recreateReadline()
    }
  }

  // ============================================================================
  // 命令注册表 — 每个命令自注册名称、说明和处理函数
  //
  // 新增命令只需在此注册，/help 自动列出，Tab 补全自动生效
  // 无需额外维护 switch-case 或命令名列表
  // ============================================================================
  {
    const commands: CommandDef[] = [
      {
        name: "help",
        description: "显示所有可用命令及说明",
        handler() {
          const maxLen = Math.max(...commands.map(c => c.name.length))
          const lines = commands.map(c => `  /${c.name.padEnd(maxLen + 2)}${c.description}`)
          print(`可用命令:\n${lines.join("\n")}`)
        },
      },
      {
        name: "quit",
        description: "退出程序",
        handler() { state = ReplState.Exiting; print("再见"); process.exit(0) },
      },
      {
        name: "exit",
        description: "退出程序（同 quit）",
        handler() { state = ReplState.Exiting; print("再见"); process.exit(0) },
      },
      {
        name: "sessions",
        description: "列出所有会话，可选参数限制数量",
        async handler(args) {
          const limit = args ? parseInt(args) : undefined
          const list = await client.listSessions({ roots: true, limit })
          const formatted = list.map((s: any) => ({ id: s.id, title: s.title, updated: new Date(s.time?.updated ?? s.updated ?? Date.now()).toLocaleString() }))
          print(formatSessions(formatted))
        },
      },
      {
        name: "switch",
        description: "切换会话，可选参数为会话 ID，无参数时交互选择",
        async handler(id) {
          try {
            if (!id) {
              const picked = await pickSession(client)
              if (!picked) return
              id = picked
            }
            const sessionInfo = await client.getSession(id)
            currentSession = createSession({ id, title: sessionInfo.title ?? id })
            // 切换会话后更新终端标题为新会话名
            setTerminalTitle(sessionInfo.title || id)
            print(`已切换到 ${id}`)
          } catch (err) {
            const e = err as Error
            print(`切换失败: ${e.message}`)
            console.error(e.stack)
          }
        },
      },
      {
        name: "new",
        description: "创建新会话，可选参数为标题",
        async handler(title) {
          try {
            const res = await client.createSession({ title: title || undefined })
            currentSession = createSession({ id: res.id, title: res.title ?? "新会话" })
            // 新建会话后更新终端标题为新会话名
            setTerminalTitle(res.title || "新会话")
            print(`已创建新会话: ${res.id}`)
          } catch (err) {
            const e = err as Error
            print(`创建失败: ${e.message}`)
            console.error(e.stack)
          }
        },
      },
      {
        name: "fork",
        description: "复制会话，可选参数为消息 ID 或目标会话 ID",
        async handler(args) {
          try {
            if (!args) {
              const picked = await pickSession(client)
              if (!picked) return
              const res = await client.forkSession(picked)
              currentSession = createSession({ id: res.id, title: res.title ?? "fork" })
              // fork 会话后更新终端标题为新会话名
              setTerminalTitle(res.title || "fork")
              print(`已 fork: ${res.id}`)
              return
            }
            const res = await client.forkSession(currentSession.id, args)
            currentSession = createSession({ id: res.id, title: res.title ?? "fork" })
            // fork 会话后更新终端标题为新会话名
            setTerminalTitle(res.title || "fork")
            print(`已 fork: ${res.id}`)
          } catch (err) {
            const e = err as Error
            print(`fork 失败: ${e.message}`)
            console.error(e.stack)
          }
        },
      },
      {
        name: "history",
        description: "查看对话历史，可选参数为条数限制",
        async handler(args) {
          const limit = args ? parseInt(args) : 10
          const msgs = await client.getMessages(currentSession.id, limit)
          const items = msgs.map((m: any) => extractMessageContent(m, visibleParts))
          print(formatHistory(items, limit))
        },
      },
      {
        name: "filter",
        description: "选择 /history 中显示的内容类型",
        async handler() {
          const prev = state
          state = ReplState.SessionPick
          try {
            const chosen = await checkbox({
              message: "选择要显示的内容类型 (空格切换，回车确认)",
              choices: [
                { name: "文本回复", value: "text", checked: visibleParts.has("text") },
                { name: "思考过程", value: "reasoning", checked: visibleParts.has("reasoning") },
                { name: "工具调用及结果", value: "tool", checked: visibleParts.has("tool") },
                { name: "步骤开始 (暂不显示)", value: "step-start", checked: visibleParts.has("step-start") },
                { name: "步骤结束 (暂不显示)", value: "step-finish", checked: visibleParts.has("step-finish") },
                { name: "文件引用 (暂不显示)", value: "file", checked: visibleParts.has("file") },
                { name: "快照 (暂不显示)", value: "snapshot", checked: visibleParts.has("snapshot") },
                { name: "补丁 (暂不显示)", value: "patch", checked: visibleParts.has("patch") },
                { name: "子代理 (暂不显示)", value: "agent", checked: visibleParts.has("agent") },
                { name: "重试 (暂不显示)", value: "retry", checked: visibleParts.has("retry") },
                { name: "压缩 (暂不显示)", value: "compaction", checked: visibleParts.has("compaction") },
                { name: "子任务 (暂不显示)", value: "subtask", checked: visibleParts.has("subtask") },
              ],
            })
            visibleParts = new Set(chosen as string[])
          } finally {
            state = prev
            recreateReadline()
          }
        },
      },
      {
        name: "info",
        description: "显示当前会话信息",
        handler() {
          print(formatInfo({
            id: currentSession.id, title: currentSession.title, directory: config.directory,
            model: currentSession.model, files: currentSession.files,
          }))
        },
      },
      {
        name: "model",
        description: "查看或切换模型，可选参数为模型 ID",
        async handler(args) {
          if (args) {
            currentSession = { ...currentSession, model: args }
            await client.sendCommand(currentSession.id, { command: "model", arguments: args, model: args })
            print(`模型: ${args}`)
          } else {
            print(`当前模型: ${currentSession.model ?? "默认"}`)
          }
        },
      },
      {
        name: "file",
        description: "添加附件文件，参数为文件路径",
        handler(args) {
          if (args) {
            if (!currentSession.files.includes(args)) {
              currentSession = { ...currentSession, files: [...currentSession.files, args] }
            }
            print(formatFiles(currentSession.files))
          }
        },
      },
      {
        name: "files",
        description: "列出当前会话已添加的文件",
        handler() { print(formatFiles(currentSession.files)) },
      },
      {
        name: "clear-files",
        description: "清除所有已添加的文件",
        handler() { currentSession = { ...currentSession, files: [] }; print(formatFiles(currentSession.files)) },
      },
    ]

    // 构建查找表 / 本地命令名集合 / Tab 补全候选列表
    commandMap = new Map(commands.map(c => [c.name, c]))
    localCommandNames = new Set(commands.map(c => c.name))
    slashCompletions = commands.map(c => `/${c.name}`)
  }

  // 根据命令名查找注册表并执行处理函数（替代原来的 switch-case）
  async function handleLocalCommand(command: string, args: string) {
    const def = commandMap.get(command)
    if (def) await def.handler(args)
  }
}
