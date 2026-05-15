const LOCAL_COMMANDS = new Set([
  "quit", "exit", "switch", "new", "fork", "history",
  "file", "files", "clear-files", "model", "info", "sessions",
])

export type SlashResult =
  | { local: true; command: string; args: string }
  | { local: false; command: string; arguments: string }
  | null

export function parseSlash(input: string): SlashResult {
  if (!input.startsWith("/")) return null

  const spaceIdx = input.indexOf(" ")
  const rawCommand = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx)
  const rawArgs = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim()
  const command = rawCommand.toLowerCase()

  if (LOCAL_COMMANDS.has(command)) {
    return { local: true, command, args: rawArgs }
  }

  return { local: false, command, arguments: rawArgs }
}
