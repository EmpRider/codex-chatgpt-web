import { expect, spyOn, test } from "bun:test";
import Ajv from "ajv";
import { createChatGptStructuredOutputValidator } from "../src/adapters/chatgpt-web/output-validation";

test("equivalent strict schemas compile once while request names remain independent", () => {
  const compile = spyOn(Ajv.prototype, "compile");
  const schema = { type: "object", properties: { cached_unique_value: { type: "integer" } }, required: ["cached_unique_value"] };
  try {
    const first = createChatGptStructuredOutputValidator({ type: "json_schema", name: "first", strict: true, schema });
    const calls = compile.mock.calls.length;
    const second = createChatGptStructuredOutputValidator({ type: "json_schema", name: "second", strict: true, schema: structuredClone(schema) });
    expect(compile.mock.calls.length).toBe(calls);
    expect(() => first!('{"cached_unique_value":1}')).not.toThrow();
    expect(() => second!('{}')).toThrow('"second"');
    expect(() => first!('{}')).toThrow('"first"');
    schema.properties.cached_unique_value.type = "string";
    const changed = createChatGptStructuredOutputValidator({ type: "json_schema", name: "changed", strict: true, schema });
    expect(() => changed!('{"cached_unique_value":1}')).toThrow();
    expect(() => first!('{"cached_unique_value":1}')).not.toThrow();
  } finally { compile.mockRestore(); }
});

test("schema cache evicts old validators and does not collide on reused schema IDs", () => {
  const compile = spyOn(Ajv.prototype, "compile");
  const unique = crypto.randomUUID();
  const format = (value: number) => ({ type: "json_schema" as const, name: "bounded", strict: true,
    schema: { $id: `urn:test:${unique}`, type: "number", const: value } });
  try {
    const original = createChatGptStructuredOutputValidator(format(0));
    for (let i = 1; i <= 16; i++) {
      const validator = createChatGptStructuredOutputValidator(format(i));
      expect(() => validator!(String(i))).not.toThrow();
      expect(() => validator!("0")).toThrow();
    }
    const calls = compile.mock.calls.length;
    createChatGptStructuredOutputValidator(format(0));
    expect(compile.mock.calls.length).toBe(calls + 1);
    expect(() => original!("0")).not.toThrow();
  } finally { compile.mockRestore(); }
});
