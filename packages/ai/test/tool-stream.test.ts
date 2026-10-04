import { describe, expect, test } from "bun:test"
import { AIError } from "../src/schema/index.js"
import { ToolStream } from "../src/protocols/utils/tool-stream.js"

const ADAPTER = "test-route"

describe("ToolStream", () => {
  test("starts from OpenAI-style deltas and finalizes parsed input", () => {
    const first = ToolStream.appendOrStart(
      ADAPTER,
      ToolStream.empty<number>(),
      0,
      { id: "call_1", name: "lookup", text: '{"query"' },
      "missing tool",
    )
    if (ToolStream.isError(first)) throw first
    const second = ToolStream.appendOrStart(ADAPTER, first.tools, 0, { text: ':"weather"}' }, "missing tool")
    if (ToolStream.isError(second)) throw second
    const finished = ToolStream.finish(ADAPTER, second.tools, 0)
    if (ToolStream.isError(finished)) throw finished

    expect(first.events).toEqual([
      { type: "tool-input-start", id: "call_1", name: "lookup" },
      { type: "tool-input-delta", id: "call_1", name: "lookup", text: '{"query"', input: {} },
    ])
    expect(second.events).toEqual([
      { type: "tool-input-delta", id: "call_1", name: "lookup", text: ':"weather"}', input: { query: "weather" } },
    ])
    expect(finished).toEqual({
      tools: {},
      events: [
        { type: "tool-input-end", id: "call_1", name: "lookup" },
        { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
      ],
    })
  })

  test("exposes cumulative partial string values", () => {
    const result = ToolStream.appendOrStart(
      ADAPTER,
      ToolStream.empty<number>(),
      0,
      { id: "call_1", name: "lookup", text: '{"query":"wea' },
      "missing tool",
    )
    if (ToolStream.isError(result)) throw result

    expect(result.events.at(-1)).toEqual({
      type: "tool-input-delta",
      id: "call_1",
      name: "lookup",
      text: '{"query":"wea',
      input: { query: "wea" },
    })
  })

  test("defaults partial input to an empty object when the accumulated value cannot be parsed", () => {
    const result = ToolStream.appendOrStart(
      ADAPTER,
      ToolStream.empty<number>(),
      0,
      { id: "call_1", name: "lookup", text: "x" },
      "missing tool",
    )
    if (ToolStream.isError(result)) throw result

    expect(result.events).toEqual([
      { type: "tool-input-start", id: "call_1", name: "lookup" },
      { type: "tool-input-delta", id: "call_1", name: "lookup", text: "x", input: {} },
    ])
  })

  test("keeps accumulated identity when later deltas contain empty strings", () => {
    const first = ToolStream.appendOrStart(
      ADAPTER,
      ToolStream.empty<number>(),
      0,
      { id: "call_1", name: "lookup", text: '{"query"' },
      "missing tool",
    )
    if (ToolStream.isError(first)) throw first
    const second = ToolStream.appendOrStart(
      ADAPTER,
      first.tools,
      0,
      { id: "", name: "", text: ':"weather"}' },
      "missing tool",
    )
    if (ToolStream.isError(second)) throw second
    const finished = ToolStream.finish(ADAPTER, second.tools, 0)
    if (ToolStream.isError(finished)) throw finished

    expect(finished.events).toEqual([
      { type: "tool-input-end", id: "call_1", name: "lookup" },
      { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
    ])
  })

  test("fails appendExisting when the provider skipped the tool start", () => {
    const error = ToolStream.appendExisting(ADAPTER, ToolStream.empty<number>(), 0, "{}", "missing tool")

    expect(error).toBeInstanceOf(AIError)
    if (ToolStream.isError(error)) expect(error.message).toBe("missing tool")
  })

  test("uses final input override without losing accumulated deltas", () => {
    const tools = ToolStream.start(ToolStream.empty<string>(), "item_1", {
      id: "call_1",
      name: "lookup",
      input: '{"query":"partial"}',
    })
    const finished = ToolStream.finishWithInput(ADAPTER, tools, "item_1", '{"query":"final"}')
    if (ToolStream.isError(finished)) throw finished

    expect(finished).toEqual({
      tools: {},
      events: [
        { type: "tool-input-end", id: "call_1", name: "lookup" },
        { type: "tool-call", id: "call_1", name: "lookup", input: { query: "final" } },
      ],
    })
  })

  test("finalizes incomplete local input using the partial JSON parser", () => {
    const tools = ToolStream.start(ToolStream.empty<string>(), "item_1", {
      id: "call_1",
      name: "lookup",
      input: '{"query":"partial',
    })
    const finished = ToolStream.finish(ADAPTER, tools, "item_1")
    if (ToolStream.isError(finished)) throw finished

    expect(finished).toEqual({
      tools: {},
      events: [
        { type: "tool-input-end", id: "call_1", name: "lookup" },
        { type: "tool-call", id: "call_1", name: "lookup", input: { query: "partial" } },
      ],
    })
  })

  test("repairs malformed string escapes in final local input", () => {
    const tools = ToolStream.start(ToolStream.empty<string>(), "item_1", {
      id: "call_1",
      name: "lookup",
      input: '{"path":"A\\H","text":"first\tsecond"}',
    })
    const finished = ToolStream.finish(ADAPTER, tools, "item_1")
    if (ToolStream.isError(finished)) throw finished

    expect(finished.events).toEqual([
      { type: "tool-input-end", id: "call_1", name: "lookup" },
      { type: "tool-call", id: "call_1", name: "lookup", input: { path: "A\\H", text: "first\tsecond" } },
    ])
  })

  test("defaults unrecoverable local input to an empty object", () => {
    const tools = ToolStream.start(ToolStream.empty<string>(), "item_1", {
      id: "call_1",
      name: "lookup",
      input: "invalid",
    })
    const finished = ToolStream.finish(ADAPTER, tools, "item_1")
    if (ToolStream.isError(finished)) throw finished

    expect(finished.events).toEqual([
      { type: "tool-input-end", id: "call_1", name: "lookup" },
      { type: "tool-call", id: "call_1", name: "lookup", input: {} },
    ])
  })

  test("recovers incomplete input alongside valid parallel tool calls", () => {
    const valid = ToolStream.start(ToolStream.empty<number>(), 0, {
      id: "call_valid",
      name: "lookup",
      input: '{"query":"weather"}',
    })
    const tools = ToolStream.start(valid, 1, {
      id: "call_invalid",
      name: "lookup",
      input: '{"query":"partial',
    })
    const finished = ToolStream.finishAll(ADAPTER, tools)
    if (ToolStream.isError(finished)) throw finished

    expect(finished).toEqual({
      tools: {},
      events: [
        { type: "tool-input-end", id: "call_valid", name: "lookup" },
        { type: "tool-call", id: "call_valid", name: "lookup", input: { query: "weather" } },
        { type: "tool-input-end", id: "call_invalid", name: "lookup" },
        { type: "tool-call", id: "call_invalid", name: "lookup", input: { query: "partial" } },
      ],
    })
  })

  test("keeps malformed provider-executed input terminal", () => {
    const tools = ToolStream.start(ToolStream.empty<string>(), "item_1", {
      id: "call_1",
      name: "web_search",
      input: '{"query":"partial',
      providerExecuted: true,
    })
    const result = ToolStream.finish(ADAPTER, tools, "item_1")

    expect(result).toBeInstanceOf(AIError)
  })

  test("preserves providerExecuted and clears all tools", () => {
    const first: ToolStream.State<number> = ToolStream.start(ToolStream.empty<number>(), 0, {
      id: "call_1",
      name: "lookup",
      input: "{}",
    })
    const tools = ToolStream.start(first, 1, {
      id: "call_2",
      name: "web_search",
      input: '{"query":"docs"}',
      providerExecuted: true,
    })
    const finished = ToolStream.finishAll(ADAPTER, tools)
    if (ToolStream.isError(finished)) throw finished

    expect(finished).toEqual({
      tools: {},
      events: [
        { type: "tool-input-end", id: "call_1", name: "lookup" },
        { type: "tool-call", id: "call_1", name: "lookup", input: {} },
        { type: "tool-input-end", id: "call_2", name: "web_search" },
        {
          type: "tool-call",
          id: "call_2",
          name: "web_search",
          input: { query: "docs" },
          providerExecuted: true,
        },
      ],
    })
  })
})
