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
