import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { CodexJsonSchemaOutputFormat } from "../../types";
import { ChatGptWebAdapterError } from "./adapter-error";

export type ChatGptStructuredOutputValidator = (answer: string) => void;

const validators = new Map<string, { ajv: Ajv; validate: ValidateFunction; bytes: number }>();
const MAX_VALIDATORS = 16;
const MAX_SCHEMA_BYTES = 512 * 1024;
let retainedSchemaBytes = 0;

function compiledSchema(schema: object | boolean) {
  const key = JSON.stringify(schema);
  const cached = validators.get(key);
  if (cached) {
    validators.delete(key);
    validators.set(key, cached);
    return cached;
  }
  const ajv = new Ajv({
    allErrors: true, strict: false, coerceTypes: false,
    removeAdditional: false, useDefaults: false, validateFormats: true,
  });
  addFormats(ajv);
  // Detach from caller mutation; each distinct schema has its own AJV $id registry.
  const validate = ajv.compile(JSON.parse(key));
  const entry = { ajv, validate, bytes: key.length * 2 };
  if (entry.bytes <= MAX_SCHEMA_BYTES) {
    while (validators.size >= MAX_VALIDATORS || retainedSchemaBytes + entry.bytes > MAX_SCHEMA_BYTES) {
      const oldest = validators.keys().next().value!;
      retainedSchemaBytes -= validators.get(oldest)!.bytes;
      validators.delete(oldest);
    }
    validators.set(key, entry);
    retainedSchemaBytes += entry.bytes;
  }
  return entry;
}

function validationError(message: string): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(message, {
    status: 502,
    errorType: "server_error",
    code: "structured_output_validation_failed",
    retryable: false,
  });
}

export function createChatGptStructuredOutputValidator(
  format: CodexJsonSchemaOutputFormat | undefined,
): ChatGptStructuredOutputValidator | undefined {
  if (!format?.strict) return undefined;

  let ajv: Ajv;
  let validate: ValidateFunction;
  try {
    ({ ajv, validate } = compiledSchema(format.schema as object | boolean));
  } catch (cause) {
    throw new ChatGptWebAdapterError(
      `Codex supplied an invalid strict JSON schema ${JSON.stringify(format.name)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        status: 400,
        errorType: "invalid_request_error",
        code: "invalid_output_schema",
        retryable: false,
      },
    );
  }

  return (answer: string): void => {
    let value: unknown;
    try {
      value = JSON.parse(answer);
    } catch {
      throw validationError(
        `ChatGPT Web returned malformed JSON for strict Codex output schema ${JSON.stringify(format.name)}`,
      );
    }
    if (validate(value)) return;
    const detail = ajv.errorsText(validate.errors, { separator: "; " });
    throw validationError(
      `ChatGPT Web returned JSON that does not satisfy strict Codex output schema ${JSON.stringify(format.name)}${detail ? `: ${detail}` : ""}`,
    );
  };
}
