# Windows: connect unmodified 9Router to this fork

This is an **add-on** for `EmpRider/codex-chatgpt-web`. It does not install a provider inside 9Router, edit 9Router source, replace the native Codex route, or install an MCP server in the coding agent. It uses the **Custom OpenAI Compatible → Responses API** provider already built into 9Router.

## 1. Prepare the ChatGPT Web fork

1. Install/run this **fork's** launcher, not a public upstream build that lacks the integration. Follow this repository's [README](../../README.md) for the launcher installation/build steps. **A packaged installer is not necessary for local source testing**: from a checked-out fork, run `bun run app` to start the normal production-profile launcher with Vite as its UI. Close an installed launcher first, because both share the same normal profile. `bun run launcher:dev` is the isolated DEV harness and does **not** expose the 9Router Responses listener.
2. Sign in to ChatGPT in the launcher's managed browser, then choose **Full harness** and **Automatic** browser mode.
3. Complete the launcher's **MCP** setup with the *existing official OpenAI tunnel* and its `Codex Native2` custom ChatGPT connector. Verify the tunnel/connector is healthy in the launcher first. The OpenAI tunnel is used between ChatGPT and this local fork; 9Router is **not** its replacement.
4. On a trusted Windows user account, run in PowerShell:

   ```powershell
   codex-chatgpt-web 9router-key create
   codex-chatgpt-web 9router-key path
   ```

   If running from a source checkout rather than a packaged command:

   ```powershell
   bun src/cli.ts 9router-key create
   bun src/cli.ts 9router-key path
   ```

   The key file is in the same user profile as the launcher, normally `$env:USERPROFILE\.codex-chatgpt-web\integrations\nine-router-key.json`. If you use `CODEX_CHATGPT_WEB_HOME`, use the path returned by the command instead. **Do not commit, paste into an issue, or print this key in logs.**

5. Restart the launcher/daemon after provisioning. The provider is disabled by default until a valid key exists **and** Full/Automatic mode is enabled.

   When running from source, you can simply stop `bun run app` and start it again; do not
   open a second copy. `http://127.0.0.1:4178` is only the Vite UI and the DevTools port is
   only for browser debugging. Neither hosts `/integrations/9router/v1/models`.

## 2. Test the local fork endpoint without exposing the key

The standard daemon port in this source tree is `17841`. If your launcher configuration chooses another port, substitute its actual port.

```powershell
$nineRouterKeyPath = (codex-chatgpt-web 9router-key path).Trim()
$nineRouterApiKey = (Get-Content -Raw -LiteralPath $nineRouterKeyPath | ConvertFrom-Json).apiKey
$nineRouterBase = 'http://127.0.0.1:17841/integrations/9router/v1'
$nineRouterHeaders = @{ Authorization = "Bearer $nineRouterApiKey" }
$nineRouterModels = Invoke-RestMethod -Method Get -Uri "$nineRouterBase/models" -Headers $nineRouterHeaders
$nineRouterModels.data | Select-Object -ExpandProperty id
```

This only tests key authentication and model discovery. A listed model **does not** prove that the ChatGPT account/tunnel is ready for real tool calls. Choose an ID returned by your actual `/models` result; do not assume the examples below are always enabled.

## 3. Create a provider in unmodified 9Router

In the existing 9Router dashboard:

1. Go to **Providers → Add OpenAI Compatible**.
2. Name: `ChatGPT Web (fork)`; Prefix: `ccw` (choose another unique prefix if already taken).
3. Set **API Type = Responses API** (not Chat Completions).
4. Set **Base URL** to `http://127.0.0.1:17841/integrations/9router/v1` (no trailing `/responses`). 9Router's unchanged Responses executor appends `/responses` itself.
5. Create the provider, then open it and add an **API Key** connection. Supply only the dedicated `nine-router-key.json` **apiKey value** from step 2, not any ChatGPT cookies, tunnel credentials or Codex private tokens. The create-provider form's optional **API Key (for Check)** field is a *validation input*, not the durable connection; add the connection on the provider detail page.
6. On that provider's model section, use **Import models** from its `/models` endpoint, or add an exact returned model ID such as `chatgpt-web/gpt-5.6-luna`. It appears to 9Router clients with your prefix: e.g. `ccw/chatgpt-web/gpt-5.6-luna`.
7. In 9Router's **CLI Tools** page, configure your intended client (Claude Code, OpenCode, Codex, etc.) to call **9Router's local gateway** and select the new `ccw/...` model. Use 9Router's normal client-specific setup instructions for the gateway key and URL; do not point the coding agent directly at this fork's `/integrations/9router/v1` endpoint.

The separate credentials have separate roles:

| Credential | Where it is used | Never reuse as |
| --- | --- | --- |
| ChatGPT login | Fork launcher browser session | 9Router provider key |
| Official OpenAI tunnel credentials | Fork's launcher/MCP/ChatGPT connector | 9Router provider key |
| Fork's dedicated 9Router API key | 9Router's custom provider **API Key connection** | Coding-agent gateway key |
| 9Router gateway API key | Claude Code/Codex/OpenCode client configuration | Fork's API key |

## 4. How tool calls actually work

1. Your coding agent sends a normal Messages/Responses request to 9Router, including the function tools **it chooses to advertise**.
2. Unmodified 9Router converts those ordinary tools to Responses format and calls this fork's `/integrations/9router/v1/responses` endpoint.
3. The fork submits the request to ChatGPT Web with an opaque turn token. ChatGPT uses the **already installed `Codex Native2` OpenAI Tunnel MCP connector** to inventory and call the explicitly advertised functions.
4. The originating coding agent receives the tool calls via 9Router and remains responsible for file access, shell execution, plugin/MCP invocation and approvals. The fork has **no authority to run the coding agent's tools locally**.
5. That agent returns a `function_call_output`; 9Router forwards it, and the fork completes the exact pending ChatGPT-side MCP invocation. ChatGPT continues the *same* browser turn.

Prompt text describing skills and plugins is preserved when forwarded by 9Router; **only declared callable functions** can be invoked remotely. Internal agent-only hooks, deferred-tool registries that were never advertised, native Codex `tool_search_call`, arbitrary custom/freeform tools, remote media links and other non-standard capabilities are **not guaranteed**. Unmodified 9Router currently drops Claude's `tool_choice` and `tool_result.is_error` flags in this conversion. This fork cannot recover those missing fields and will not pretend to.

## 5. Safe smoke tests and troubleshooting

- Start with a **text-only** coding-agent request. If it fails, confirm Full/Automatic mode, the correct fork version, the local `/models` test, the provider API Type, and the 9Router model prefix.
- Then use an agent-declared **read-only** tool (e.g. read a test file), and confirm its content returns to ChatGPT. Only after read-only success, try an edit operation with normal originating-agent approvals. Never assume an edit happened merely because ChatGPT described one.
- `401` from the fork: wrong **dedicated fork** provider key, missing 9Router key connection or stale key after rotation.
- `404` from the fork: integration not enabled, incorrect `/integrations/9router/v1` path, or Full/Automatic mode disabled.
- `409`: tool continuation belongs to another/expired/restarted session, duplicate output or missing result. Do **not** replay mutating tools; begin a new task after checking what already changed.
- `400` with `context_length_exceeded`: the full agent history exceeds the selected ChatGPT Web route. The provider now reports `Prompt is too long` in the message so Claude Code can recognize the rejection and attempt native compaction; 9Router keeps that text when translating the error. Recovery still depends on the running Claude Code version and settings. The fork does not truncate the caller's history or report false success.
- `413`/`422`: unsupported or oversized function, image, custom tool or other payload. The fork fails closed instead of silently dropping its semantics.
- `Agent context exceeds the safe ChatGPT Web composer budget`: the old inline transport is too large. Enable **Bigger Context (experimental)** in the fork launcher and restart its runtime. Supported 9Router model routes then send long Claude Code histories through the same **acknowledged 2-part or 6-part ChatGPT transport** as native Codex. A single oversized history item, unavailable GPT-6 Instant Bigger Context, or a context above the selected model's genuine limit still requires `/compact` in the originating coding agent.
- **Claude Code auto-compact with 9Router:** 9Router's `200K` setting writes the threshold into Claude Code's settings; 9Router does not call a compaction endpoint. Experimental GPT-6 Sol Bigger Context reserves a **110K-token pre-compaction target on Plus** and **220K on Pro**; standard mode and Instant are smaller. Configure **100K** for GPT-6 Sol Plus Bigger Context, fully restart Claude Code, and confirm `/autocompact`. This fork reports estimated usage and rejects oversized context before browser submission. On rejection, it sends HTTP 400 `Prompt is too long`, which compatible Claude Code versions can use for reactive native compaction. A 200K setting alone cannot fit 120K, and a recognized error is not proof that the session resumed; confirm live end-to-end recovery. A single huge tool result or a route below Claude Code's 100K minimum can still require manual intervention or changing models.
- No ChatGPT-side tool invocation: verify the exact official OpenAI tunnel connector is installed and available to ChatGPT under the launcher's MCP page; 9Router alone cannot make ChatGPT use external tools.
- Inspect fork logs prefixed `[9router]` and matching `[chatgpt-web] broker trace=` records. They contain request and session correlation IDs plus counts/stages, **not** prompt/tool data or keys. Match times with the 9Router dashboard logs, then redact before sharing.

### Disable or roll back only the added provider

1. In 9Router, deactivate/delete the `ccw` custom provider connection or select a different model in your coding agent.
2. Run `codex-chatgpt-web 9router-key disable`, then **restart the fork daemon**. It moves the key file to a timestamped `*.disabled-*` name; this does **not** erase ChatGPT cookies or OpenAI tunnel/Codex configurations. Treat the renamed file as sensitive until securely destroyed.
3. Existing native Codex use and the original launcher/browser/MCP connector remain intact. Re-enable later with `9router-key create` and a new API Key connection.

## Evidence and release caution

The provider's path, authentication header, model-discovery import and Responses event translation were checked against **unmodified 9Router v0.5.109 / commit `f39d8f07481ae8518e93175f0ecaaafa61573c6c`**, including real local API calls using a disposable 9Router database. Both a simulated OpenAI Responses agent and a simulated Claude Messages agent completed tool calls and returned results. The ChatGPT browser itself was mocked, and no Windows profile was used. **There is no claim yet of signed-in Windows ChatGPT Web → OpenAI Tunnel → live Claude Code end-to-end testing.** Complete the live acceptance checklist in [IMPLEMENTATION.md](IMPLEMENTATION.md) before publishing a production-ready release.
