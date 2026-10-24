# Proposed external protocol: examples and limits

**Design examples only — not implemented, not live-verified.** The final wire contract must follow pinned, unmodified 9Router behavior and the fixtures created in R9-002.

## 1. Generic provider registration

In 9Router, create a **Custom OpenAI-compatible** provider node with:

| Setting | Example |
| --- | --- |
| name | ChatGPT Web |
| prefix | ccw |
| apiType | responses |
| baseUrl | http://127.0.0.1:17841/integrations/9router/v1 |
| provider API key | Dedicated integration key generated and stored by the fork |
| exposed model | ccw/chatgpt-web/MODEL_SLUG |

9Router appends /responses to the configured base URL for a Responses-compatible node. Its model prefix is gateway routing metadata; the fork must receive and validate the actual ChatGPT Web route. The port/model are placeholders until setup and model-discovery tasks finish.

## 2. Initial Responses request after 9Router translation

Example JSON shape that the fork is expected to support:

    {
      "model": "chatgpt-web/MODEL_SLUG",
      "instructions": "You are the coding assistant...",
      "input": [
        {"role": "user", "content": [{"type": "input_text", "text": "Read src/index.ts"}]}
      ],
      "tools": [
        {
          "type": "function",
          "name": "Read",
          "description": "Read a local file in the agent environment",
          "parameters": {
            "type": "object",
            "properties": {"file_path": {"type": "string"}},
            "required": ["file_path"]
          }
        }
      ],
      "stream": true
    }

Important: The tool declaration is **not** permission for the fork to read a file. It describes a tool the calling coding agent has advertised. The fork may only request that tool and return its call through the same session.

## 3. Model requests a tool

The fork streams normal Responses function_call events (SSE event sequence illustrated below; other standard framing fields may be required by the actual implementation):

    event: response.output_item.added
    data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_example","call_id":"call_example","name":"Read","arguments":"","status":"in_progress"}}

    event: response.function_call_arguments.delta
    data: {"type":"response.function_call_arguments.delta","item_id":"fc_example","output_index":0,"delta":"{\"file_path\":\"src/index.ts\"}"}

    event: response.output_item.done
    data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_example","call_id":"call_example","name":"Read","arguments":"{\"file_path\":\"src/index.ts\"}","status":"completed"}}

9Router must translate this into Claude tool_use for Claude Code, or preserve the appropriate OpenAI tool format for other clients. Native Codex special events custom_tool_call/tool_search_call are **not** assumed to survive the generic Claude translator.

## 4. Agent returns a result

After the agent executes its own Read function, 9Router sends a Responses function_call_output record back to the fork. It may include the reconstructed conversation rather than native Codex turn metadata:

    {
      "model": "chatgpt-web/MODEL_SLUG",
      "input": [
        {"role": "user", "content": "Read src/index.ts"},
        {"type": "function_call", "call_id": "call_example", "name": "Read", "arguments": "{\"file_path\":\"src/index.ts\"}"},
        {"type": "function_call_output", "call_id": "call_example", "output": "export const value = 1;"}
      ],
      "stream": true
    }

The fork must authenticate and match call_example to a pending request in **that caller's** live broker session, resolve the already-waiting ChatGPT MCP tool invocation, and resume the same browser response. A call ID alone is not sufficient authorization; the server must also bind it to its owning authenticated session.

Do not assume forwarded custom headers or native Codex thread_id/turn_id. R9-014 must establish a robust continuation mechanism from what unmodified 9Router actually sends, and reject ambiguous identity.

## 5. Tool errors, parallel calls and termination

- If the executing agent reports an error, the ChatGPT MCP connector must receive an error result. Never fabricate tool success or automatically rerun a possibly mutating tool.
- Parallel calls each carry distinct call IDs; results must be matched by ID, not arrival order.
- Stream disconnect, tab close, aborted session, expired capability or lost broker state must produce a clear terminal error and clean up pending calls.
- ChatGPT's final assistant text becomes a normal Responses message and is translated by 9Router for the original agent.
- Rich images, Claude-specific blocks, freeform/custom tools and skills/hooks may require special compatibility handling. Test and document these separately.

## 6. Tool ownership and permissions

- Claude Code / OpenCode / Codex decide whether a tool exists and whether the local OS/sandbox allows running it.
- The fork does not install MCP servers, plugins or skills inside the coding agent.
- The selected ChatGPT custom MCP connector and official outbound tunnel remain the established transport for **ChatGPT → local TurnBroker**.
- 9Router is the additional transport for **coding agent ↔ fork Responses API**. It does not replace the OpenAI tunnel.

## 7. Protocol validation references

- [9Router Claude-to-OpenAI translator](https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js)
- [9Router Responses request translator](https://github.com/decolua/9router/blob/master/open-sse/translator/request/openai-responses.js)
- [9Router Responses streaming translator](https://github.com/decolua/9router/blob/master/open-sse/translator/response/openai-responses.js)
- [Fork Responses bridge](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/bridge.ts)
- [Fork broker and browser continuation](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/index.ts)
