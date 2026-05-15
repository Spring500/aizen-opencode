import { createConfig, createSession } from "./state"
import { createClient } from "./client"
import {
  formatConnecting, formatConnected, formatConnectionError,
  formatSessionNotFound,
} from "./format"

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
      case "--version": case "-v": console.log("0.1.0"); process.exit(0)
    }
  }
  return opts
}

const config = createConfig(parseArgs() as any)

console.log(formatConnecting(config.serverUrl))

async function init() {
  const client = createClient({ baseUrl: config.serverUrl, directory: config.directory })
  let sessionID: string, title = ""

  if (config.initSession) {
    try { const s = await client.getSession(config.initSession); sessionID = s.id; title = s.title ?? "" }
    catch { console.log(formatSessionNotFound(config.initSession)); process.exit(1) }
  } else if (config.newSession) {
    const s = await client.createSession({ title: "新会话" }); sessionID = s.id; title = s.title ?? "新会话"
  } else {
    const list = await client.listSessions({ roots: true, limit: 1 })
    if (list.length > 0) { sessionID = list[0].id; title = list[0].title ?? "" }
    else { const s = await client.createSession({}); sessionID = s.id; title = s.title ?? "新会话" }
  }

  const session = createSession({ id: sessionID, title })
  console.log(formatConnected(sessionID, title))
  const { startREPL } = await import("./repl")
  await startREPL(config, session, client)
}

init().catch((err: Error) => { console.log(formatConnectionError(err.message)); process.exit(1) })
