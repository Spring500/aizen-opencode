import { createConfig, createSession } from "./state"
import { createClient } from "./client"
import {
  formatConnecting, formatConnected, formatConnectionError,
  formatSessionNotFound, formatSessionCreateError,
} from "./format"

const pkg = await Bun.file(new URL("../package.json", import.meta.url).pathname).json()
const VERSION = pkg.version

function parseArgs(): Record<string, string | boolean> {
  const args = process.argv.slice(2)
  const opts: Record<string, string | boolean> = {}
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--url": opts.serverUrl = args[++i]; break
      case "--dir": opts.directory = args[++i]; break
      case "--thinking": opts.thinking = true; break
      case "--new": opts.newSession = true; break
      case "--session": opts.initSession = args[++i]; break
      case "--help": case "-h": console.log(`opencode-repl [options]
  --url <url>      serve address, default http://localhost:4096
  --dir <path>     project directory
  --session <id>   initial session ID
  --new            force new session
  --thinking       show thinking blocks
  --help, -h       show help
  --version, -v    show version`); process.exit(0)
      case "--version": case "-v": console.log(VERSION); process.exit(0)
    }
  }
  return opts
}

const config = createConfig(parseArgs() as any)

console.log(`opencode-repl v${VERSION}`)
console.log(formatConnecting(config.serverUrl))

async function init() {
  const client = createClient({ baseUrl: config.serverUrl, directory: config.directory })

  if (config.initSession) {
    try {
      const s = await client.getSession(config.initSession)
      const session = createSession({ id: s.id, title: s.title ?? "" })
      console.log(formatConnected(s.id, s.title ?? ""))
      const { startREPL } = await import("./repl")
      await startREPL(config, session, client)
    } catch {
      console.log(formatSessionNotFound(config.initSession))
      process.exit(1)
    }
    return
  }

  if (config.newSession) {
    try {
      const s = await client.createSession({ title: "新会话" })
      const session = createSession({ id: s.id, title: s.title ?? "新会话" })
      console.log(formatConnected(s.id, s.title ?? "新会话"))
      const { startREPL } = await import("./repl")
      await startREPL(config, session, client)
    } catch (err) {
      console.log(formatSessionCreateError((err as Error).message))
      process.exit(1)
    }
    return
  }

  const list = await client.listSessions({ roots: true, limit: 1 })
  if (list.length > 0) {
    const s = list[0]
    const session = createSession({ id: s.id, title: s.title ?? "" })
    console.log(formatConnected(s.id, s.title ?? ""))
    const { startREPL } = await import("./repl")
    await startREPL(config, session, client)
    return
  }

  try {
    const s = await client.createSession({})
    const session = createSession({ id: s.id, title: s.title ?? "新会话" })
    console.log(formatConnected(s.id, s.title ?? "新会话"))
    const { startREPL } = await import("./repl")
    await startREPL(config, session, client)
  } catch (err) {
    console.log(formatSessionCreateError((err as Error).message))
    process.exit(1)
  }
}

init().catch((err: Error) => { console.log(formatConnectionError(err.message)); process.exit(1) })
