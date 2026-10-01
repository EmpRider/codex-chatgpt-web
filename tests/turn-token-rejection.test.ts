import { expect, test } from "bun:test";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";
import { throwIfCodexTurnTokenRejected } from "../src/adapters/chatgpt-web/index";

test.each([
  "Codex task not executed. Error from Codex Native2: turn token is invalid, expired, or revoked. Retry the task so the launcher supplies a fresh turn\\_token.",
  "Codex task could not start: provided turn token is invalid, expired, or revoked. Retry the Codex task so it generates a fresh turn token.",
  "No repository changes or commands were executed. Retry the Codex task so it supplies a fresh turn_token.",
  "No repository changes or commands were executed. Retry the Codex task so it supplies a fresh `turn\\_token`.",
  "This turn_token was issued for an earlier turn, which has already finished. This Codex Native action can no longer run. Retry the Codex task with a fresh turn_token.",
])("token rejection is a retryable adapter error: %s", answer => {
  let caught: unknown;
  try { throwIfCodexTurnTokenRejected(answer); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(ChatGptWebAdapterError);
  expect(caught).toMatchObject({ code: "codex_turn_token_rejected", retryable: true, status: 502 });
});

test.each([
  "No repository changes or commands were executed. The task was read-only.",
  "Retry the Codex task so it supplies a fresh turn_token.",
  "A fresh turn_token is generated for each task.",
])("ordinary token-related answers remain successful: %s", answer => {
  expect(() => throwIfCodexTurnTokenRejected(answer)).not.toThrow();
});
