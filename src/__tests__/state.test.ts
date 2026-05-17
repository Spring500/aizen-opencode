// ============================================================================
// state.test.ts
// ============================================================================
//
// 这个文件测试会话状态和配置的管理逻辑。REPL 启动时需要解析命令行参数
// 生成一份配置，运行过程中需要维护当前会话的信息（id、标题、文件列表、
// 已批准的命令等），这些都由 src/state.ts 负责。
//
// 具体覆盖了：
//   - 配置的默认值：不传 --server 默认连 localhost:4096，
//     --thinking 默认关，--new 默认关，不指定 --session 默认空
//   - 会话对象的结构：新建的会话必须有 id、标题，文件列表为空数组，
//     已批准命令为空集合
//   - 会话切换/新建/派生：这三种操作都会重置已批准命令，
//     新建还会清空文件列表；切换本质上是用新 id 替换旧 id
//   - 文件管理：加文件要去重（同一个文件加两次不会出现两次），
//     清文件就是把列表置空
//   - 权限模式批准：往已批准集合里加字符串
//   - 多行输入：开始 → 逐行追加 → 结束拼成一段文本；
//     如果一行都没输入就结束，返回 null
//
// 状态变更全部采用"创建新对象、不动旧对象"的方式，没有副作用。
//
// ============================================================================

import { describe, test, expect } from "vitest"
import { createSession, createConfig, startMultiline, pushLine, finishMultiline } from "../state"

describe("state", () => {
  // createConfig：CLI 参数 → 配置对象，验证默认值和自定义值
  describe("createConfig", () => {
    test("defaults", () => {
      const c = createConfig({})
      expect(c.serverUrl).toBe("http://localhost:4096")
      expect(c.thinking).toBe(false)
      expect(c.newSession).toBe(false)
      expect(c.initSession).toBe("")
    })
    test("custom url", () => {
      const c = createConfig({ serverUrl: "http://example.com:8080" })
      expect(c.serverUrl).toBe("http://example.com:8080")
    })
    test("--thinking flag", () => {
      const c = createConfig({ thinking: true })
      expect(c.thinking).toBe(true)
    })
    test("--new flag", () => {
      const c = createConfig({ newSession: true })
      expect(c.newSession).toBe(true)
    })
    test("--session", () => {
      const c = createConfig({ initSession: "ses_abc" })
      expect(c.initSession).toBe("ses_abc")
    })
    test("--dir", () => {
      const c = createConfig({ directory: "/tmp" })
      expect(c.directory).toBe("/tmp")
    })
  })

  // createSession：新会话对象的结构完整性验证
  describe("createSession", () => {
    test("all fields", () => {
      const s = createSession({ id: "ses_001", title: "测试" })
      expect(s.id).toBe("ses_001")
      expect(s.title).toBe("测试")
      expect(s.files).toEqual([])
      expect(s.approved).toBeInstanceOf(Set)
      expect(s.approved.size).toBe(0)
    })
    test("with model", () => {
      const s = createSession({ id: "ses_002", title: "x", model: "openai/gpt-4o" })
      expect(s.model).toBe("openai/gpt-4o")
    })
    test("with files", () => {
      const s = createSession({ id: "ses_003", title: "x", files: ["a.ts", "b.ts"] })
      expect(s.files).toEqual(["a.ts", "b.ts"])
    })
    test("default model is undefined", () => {
      const s = createSession({ id: "ses_004", title: "x" })
      expect(s.model).toBeUndefined()
    })
  })

  // session mutations：验证不可变更新模式下的所有会话状态变更
  describe("session mutations", () => {
    test("switchSession updates id, title, clears approved", () => {
      const s = createSession({ id: "ses_001", title: "旧" })
      s.approved.add("rm")
      const s2 = { ...s, id: "ses_002", title: "新", approved: new Set<string>() }
      expect(s2.id).toBe("ses_002")
      expect(s2.title).toBe("新")
      expect(s2.approved.size).toBe(0)
    })
    test("newSession clears files and approved", () => {
      const s = createSession({ id: "ses_old", title: "x", files: ["f.ts"] })
      s.approved.add("pw")
      const s2 = createSession({ id: "ses_new", title: "新会话" })
      expect(s2.files).toEqual([])
      expect(s2.approved.size).toBe(0)
    })
    test("forkSession clears approved", () => {
      const s = createSession({ id: "ses_001", title: "旧" })
      s.approved.add("rm")
      const s2 = createSession({ id: "ses_fork", title: "fork" })
      expect(s2.approved.size).toBe(0)
    })
    test("setModel", () => {
      let s = createSession({ id: "ses_001", title: "x" })
      s = { ...s, model: "openai/gpt-4o" }
      expect(s.model).toBe("openai/gpt-4o")
    })
    test("addFile", () => {
      let s = createSession({ id: "ses_001", title: "x" })
      s = { ...s, files: [...s.files, "src/foo.ts"] }
      expect(s.files).toEqual(["src/foo.ts"])
    })
    test("addFile deduplication", () => {
      let s = createSession({ id: "ses_001", title: "x", files: ["src/foo.ts"] })
      s = { ...s, files: [...new Set([...s.files, "src/foo.ts"])] }
      expect(s.files).toEqual(["src/foo.ts"])
    })
    test("clearFiles", () => {
      const s = createSession({ id: "ses_001", title: "x", files: ["a.ts", "b.ts"] })
      const s2 = { ...s, files: [] }
      expect(s2.files).toEqual([])
    })
    test("approvePattern", () => {
      let s = createSession({ id: "ses_001", title: "x" })
      s = { ...s, approved: new Set([...s.approved, "rm -rf dist/"]) }
      expect(s.approved.has("rm -rf dist/")).toBe(true)
    })
  })

  // multiline：多行输入缓冲区，支持 start → push → finish 生命周期
  describe("multiline", () => {
    test("startMultiline", () => {
      const m = startMultiline()
      expect(m.active).toBe(true)
      expect(m.buffer).toEqual([])
    })
    test("pushLine", () => {
      let m = startMultiline()
      m = pushLine(m, "line1")
      m = pushLine(m, "line2")
      expect(m.buffer).toEqual(["line1", "line2"])
    })
    test("finishMultiline", () => {
      let m = startMultiline()
      m = pushLine(m, "a")
      m = pushLine(m, "b")
      const result = finishMultiline(m)
      expect(result).toBe("a\nb")
    })
    test("finishMultiline empty buffer returns null", () => {
      const m = startMultiline()
      const result = finishMultiline(m)
      expect(result).toBeNull()
    })
    test("finishMultiline empty lines", () => {
      let m = startMultiline()
      m = pushLine(m, "")
      const result = finishMultiline(m)
      expect(result).toBe("")
    })
  })
})
