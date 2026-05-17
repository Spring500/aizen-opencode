import pc from "picocolors"
import stringWidth from "string-width"

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })

function truncateByWidth(str: string, maxWidth: number): string {
  let result = ""
  let width = 0
  for (const { segment } of segmenter.segment(str)) {
    const segWidth = stringWidth(segment)
    if (width + segWidth > maxWidth) break
    result += segment
    width += segWidth
  }
  return result
}

function fitColumn(str: string, maxWidth: number): string {
  const sw = stringWidth(str)
  if (sw <= maxWidth) return str + " ".repeat(maxWidth - sw)
  const truncated = truncateByWidth(str, maxWidth - 3) + "..."
  return truncated + " ".repeat(maxWidth - stringWidth(truncated))
}

// Spec §7.1 定义三参数 (role, agent, modelID)，但 role 信息已通过调用上下文隐含
// （仅在 message.updated role==="assistant" 时调用），故保留两参数签名。
export function formatAIHeader(agent?: string, modelID?: string): string {
  const a = agent ?? "?"
  const m = modelID ?? "?"
  return `\n${pc.blue("AI")} · ${pc.cyan(a)} · ${pc.dim(m)}\n`
}

export function formatPrompt(): string {
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

export function formatSessionNotFound(id: string, detail?: string): string {
  const base = `${pc.red(pc.bold("session"))} ${pc.dim(id)} ${pc.red("不存在")}`
  return detail ? `${base} — ${detail}` : base
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

/**
 * 设置终端标题 — 通过 ANSI OSC (Operating System Command) 转义序列
 * 格式: ESC ] 0 ; <title> BEL
 * 几乎所有现代终端（Windows Terminal、iTerm2、GNOME Terminal 等）均支持
 * 在项目启动、切换/新建/fork 会话时调用，使终端标签页显示当前会话名
 */
export function setTerminalTitle(title: string) {
  process.stdout.write(`\x1b]0;${title}\x07`)
}

export function formatDisconnectMessage(): string {
  return `\n  ${pc.yellow("⚠")} ${pc.dim("连接中断")}\n`
}

export function formatDisconnectPermMessage(): string {
  return `\n  ${pc.yellow("⚠")} ${pc.dim("连接中断，权限请求可能已被拒绝")}\n`
}

export function formatHistory(
  entries: Array<{ role: string; lines: Array<{ type: "text" | "reasoning" | "tool" | "tool-output"; content: string }> }>,
  maxCount = 10,
): string {
  if (entries.length === 0) return pc.dim("无历史")
  const items = entries.slice(-maxCount)
  const header = formatSeparator(`最近 ${items.length} 条消息`)

  const blocks: string[] = []
  for (const entry of items) {
    const roleColor = entry.role === "user" ? pc.cyan : pc.green
    const reasoningColor = (s: string) => pc.dim(pc.italic(s))
    const toolColor = pc.yellow
    const outputColor = pc.dim
    const prefix = entry.role === "user" ? "You:  " : "AI:   "

    const entryLines: string[] = []
    for (let i = 0; i < entry.lines.length; i++) {
      const line = entry.lines[i]
      const indent = i === 0 ? prefix : "      "
      if (line.type === "text") {
        entryLines.push(roleColor(indent + line.content))
      } else if (line.type === "reasoning") {
        entryLines.push(reasoningColor(indent + "· " + line.content))
      } else if (line.type === "tool") {
        entryLines.push(toolColor(indent + line.content))
      } else {
        entryLines.push(outputColor(indent + "→ " + line.content))
      }
    }
    blocks.push(entryLines.join("\n"))
  }

  return header + "\n" + blocks.join("\n\n") + "\n" + formatSeparator()
}

export function formatSessions(
  sessions: { id: string; title: string; updated: string }[],
): string {
  if (sessions.length === 0) return pc.dim("无 session")
  const maxId = 20
  const maxTitle = 25
  const header = `${fitColumn("Session ID", maxId)}  ${fitColumn("Title", maxTitle)}  Updated`
  const sep = "─".repeat(header.length)
  const rows = sessions.map((s) => {
    return `${pc.dim(fitColumn(s.id, maxId))}  ${fitColumn(s.title, maxTitle)}  ${s.updated}`
  })
  return [header, pc.dim(sep), ...rows].join("\n")
}
