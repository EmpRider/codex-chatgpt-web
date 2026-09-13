from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}\n--- needle ---\n{old}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/adapters/chatgpt-web/input-tokens.ts",
    '''  const acknowledgementTokens = compiled.multipart
    ? compiled.multipart.parts.slice(0, -1).reduce((total, payload, index) => total + estimateTokens(
      formatChatGptWebMultipartStage(
        payload,
        TOKEN_ESTIMATE_TRANSACTION,
        index + 1,
        compiled.multipart!.parts.length,
      ).acknowledgement,
      modelId,
    ), 0)
    : 0;
  return CHATGPT_WEB_PLATFORM_RESERVE_TOKENS + messageTokens + acknowledgementTokens + imageTokens;''',
    '''  const acknowledgementTokens = compiled.multipart
    ? compiled.multipart.parts.slice(0, -1).reduce((total, payload, index) => total + estimateTokens(
      formatChatGptWebMultipartStage(
        payload,
        TOKEN_ESTIMATE_TRANSACTION,
        index + 1,
        compiled.multipart!.parts.length,
      ).acknowledgement,
      modelId,
    ), 0)
    : 0;
  // Large Full-mode requests keep the canonical context out of Lexical and deliver it through
  // MCP tool results instead. It still enters the model context and must therefore count toward
  // Codex usage/compaction decisions even though it is absent from the visible browser message.
  const mcpContextTokens = compiled.contextTransport
    ? estimateTokens(compiled.contextTransport.text, modelId)
    : 0;
  return CHATGPT_WEB_PLATFORM_RESERVE_TOKENS
    + messageTokens
    + acknowledgementTokens
    + mcpContextTokens
    + imageTokens;''',
)

replace_once(
    "tests/dev-chat.test.ts",
    '''    expect(await callTurnBroker(transport.config.brokerSocketPath, { method: "owner_status" }))
      .toMatchObject({ protocolVersion: 5 });''',
    '''    expect(await callTurnBroker(transport.config.brokerSocketPath, { method: "owner_status" }))
      .toMatchObject({ protocolVersion: 6 });''',
)

replace_once(
    "tests/chatgpt-web-harness.test.ts",
    '''  test("keeps a large context inline and uploads only its referenced images", () => {
    const imageUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg==";
    const request = parsed();
    request.context.systemPrompt = ["d".repeat(70_000)];
    request.context.messages[0]!.content = [
      { type: "text", text: "Inspect the attached context and image" },
      { type: "image", imageUrl, detail: "high" },
    ];
    const compiled = compileChatGptWebPrompt(request, toolCapabilities, "turn_123456789012345678901234");
    const files = chatGptPromptFilePayloads(compiled);

    expect(compiled.text).toContain("d".repeat(70_000));
    expect(compiled.text).toContain("<codex_context_json>");
    expect(files.map(file => file.name)).toEqual(["codex-input-image-1.png"]);
    expect(files[0]!.mimeType).toBe("image/png");
  });''',
    '''  test("moves a large Full-mode context to MCP while uploading only its referenced images", () => {
    const imageUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg==";
    const request = parsed();
    request.context.systemPrompt = ["d".repeat(70_000)];
    request.context.messages[0]!.content = [
      { type: "text", text: "Inspect the attached context and image" },
      { type: "image", imageUrl, detail: "high" },
    ];
    const compiled = compileChatGptWebPrompt(request, toolCapabilities, "turn_123456789012345678901234");
    const files = chatGptPromptFilePayloads(compiled);

    expect(compiled.contextTransport).toBeDefined();
    expect(compiled.contextTransport!.text).toContain("d".repeat(70_000));
    expect(compiled.text).not.toContain("d".repeat(70_000));
    expect(compiled.text).toContain("codex_web_context_read");
    expect(compiled.text).not.toContain("<codex_context_json>");
    expect(files.map(file => file.name)).toEqual(["codex-input-image-1.png"]);
    expect(files[0]!.mimeType).toBe("image/png");
  });''',
)

print("Applied MCP context usage-accounting and stale-contract fixes")
