import { expect, test } from "bun:test";
import { classifyProviderChanges } from "../tasks/9router/check-upstream-safe.mjs";

test("upstream-safety guard permits only namespaced modules and four reviewed inherited seams", () => {
  expect(classifyProviderChanges([
    "src/integrations/nine-router/routes.ts", "src/server.ts", "src/cli.ts",
    "src/adapters/chatgpt-web/turn-broker.ts", "src/adapters/chatgpt-web/mcp-server.ts",
  ])).toMatchObject({ unexpected: [], inherited: [
    "src/server.ts", "src/cli.ts", "src/adapters/chatgpt-web/turn-broker.ts",
    "src/adapters/chatgpt-web/mcp-server.ts",
  ] });
  const changed = classifyProviderChanges([
    "src/adapters/chatgpt-web/browser-worker.ts", "src/native-provider.ts", "launcher/src/main.ts",
  ]);
  expect(changed.unexpected).toEqual([
    "src/adapters/chatgpt-web/browser-worker.ts", "src/native-provider.ts", "launcher/src/main.ts",
  ]);
});
