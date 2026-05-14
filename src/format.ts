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
