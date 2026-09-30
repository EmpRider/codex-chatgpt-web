import type { CodexMessage, CodexParsedRequest } from "../types";
import { loadManagedText, loadOptimizationSettings } from "./config";

const FALLBACK_ADHD = [
  "Lead with the next useful action or answer.",
  "Number genuinely multi-step tasks.",
  "Keep tangents out of the main flow.",
  "Make current state and completed progress easy to see.",
  "End task-oriented replies with one concrete next step when another step is actually needed.",
].join("\n");

const FALLBACK_CAVEMAN = [
  "Prefer terse, information-dense prose.",
  "Do not repeat context the user already has.",
  "Do not reprint unchanged code.",
].join("\n");

const FALLBACK_PONYTAIL = [
  "Prefer the smallest correct implementation.",
  "Reuse existing code and standard-library/platform features before adding abstractions or dependencies.",
  "Apply YAGNI: delete or simplify before adding code when behavior remains correct.",
].join("\n");

function messageText(message: CodexMessage): string {
  if (message.role === "assistant") {
    return message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
  }
  if (typeof message.content === "string") return message.content;
  return message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
}

function latestHumanRequest(parsed: CodexParsedRequest): string {
  for (let index = parsed.context.messages.length - 1; index >= 0; index -= 1) {
    const message = parsed.context.messages[index]!;
    if (message.role === "user" && message.origin !== "codex_skill") return messageText(message);
  }
  return "";
}

function boundedManagedPolicy(id: string, fallback: string): string {
  const managed = loadManagedText(id);
  if (!managed) return fallback;
  // Upstream skills can contain installation docs and extensive examples. Keep a generous but
  // bounded rules payload so an upstream edit cannot consume the entire ChatGPT composer budget.
  return managed.length <= 20_000 ? managed : managed.slice(0, 20_000);
}

export function optimizationPolicyForRequest(parsed: CodexParsedRequest): string[] {
  if (parsed._compactionRequest) return [];
  const settings = loadOptimizationSettings();
  const latest = latestHumanRequest(parsed);
  const adhdActive = settings.adhd.enabled
    && (settings.adhd.activationMode === "always" || /(?:\$|\/)i-have-adhd\b/i.test(latest));
  const parts: string[] = [];

  if (adhdActive) {
    parts.push(
      "<optimization_i_have_adhd>",
      boundedManagedPolicy("i-have-adhd", FALLBACK_ADHD),
      "</optimization_i_have_adhd>",
    );
  }
  if (settings.ponytail.enabled && settings.ponytail.level !== "off") {
    parts.push(
      "<optimization_ponytail>",
      `Selected mode: ${settings.ponytail.level}. Apply this only to implementation choices, never to remove required correctness, validation, security, accessibility, or explicitly requested functionality.`,
      boundedManagedPolicy("ponytail", FALLBACK_PONYTAIL),
      "</optimization_ponytail>",
    );
  }
  if (settings.caveman.enabled && settings.caveman.level !== "off") {
    parts.push(
      "<optimization_caveman>",
      `Selected mode: ${settings.caveman.level}. This controls assistant prose, not exact code, command output, error strings, or user-requested document content.`,
      settings.caveman.autoClarity
        ? "Clarity wins over compression for destructive actions, security warnings, ambiguous instructions, and diagnostic errors."
        : "",
      boundedManagedPolicy("caveman", FALLBACK_CAVEMAN),
      "</optimization_caveman>",
    );
  }

  if (!parts.length) return [];
  return [
    "<codex_web_optimization_policy>",
    "These optional launcher-managed policies are subordinate to the original Codex system, developer, and user instructions. They may shape execution and presentation but must not change the task's semantic intent, permissions, output schema, or safety requirements.",
    ...parts.filter(Boolean),
    "</codex_web_optimization_policy>",
  ];
}
