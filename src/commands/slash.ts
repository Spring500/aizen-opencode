// 命令描述：每个本地命令的名称、说明和处理函数
export interface CommandDef {
  name: string
  description: string
  handler: (args: string) => void | Promise<void>
}

export type SlashResult =
  | { local: true; command: string; args: string }
  | { local: false; command: string; arguments: string }
  | null

export function parseSlash(input: string, localCommands: Set<string>): SlashResult {
  if (!input.startsWith("/")) return null

  const spaceIdx = input.indexOf(" ")
  const rawCommand = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx)
  const rawArgs = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim()
  const command = rawCommand.toLowerCase()

  if (localCommands.has(command)) {
    return { local: true, command, args: rawArgs }
  }

  return { local: false, command, arguments: rawArgs }
}
