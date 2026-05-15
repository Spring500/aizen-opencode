import pc from "picocolors"

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
