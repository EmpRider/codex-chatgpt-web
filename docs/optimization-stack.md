# Managed optimization stack

Codex Web GPT can manage optional optimization components directly from **Settings → Optimization**. The launcher owns installation, updates, configuration, health checks, repair, and process lifecycle. Users do not need to install plugins, edit Codex configuration, or run side-tool setup commands.

## Codex remains untouched

The optimization manager does **not** install or edit:

- Codex plugins or skills
- `AGENTS.md`
- Codex MCP configuration
- `~/.codex/config.toml`
- other files in the user's Codex installation

Codex continues to act as the client. Optimization happens inside the Codex Web GPT bridge and its app-owned runtime.

## Components

| Component | Purpose | Default |
| --- | --- | --- |
| **Jev** | Chooses an eligible ChatGPT Web route/reasoning effort before normal routing. Requires a TypeSafe key and never changes Zero Risk/manual routing. | Off |
| **i-have-adhd** | Action-first, bounded response/execution structure using the managed upstream skill rules. | On / Always |
| **RTK** | Compresses supported native command output before it returns to ChatGPT. Exact filters are used when the command is known; other output uses RTK auto-detection. | On |
| **Headroom** | Compresses older context and large command output through a private loopback `/v1/compress` service. | On, code-aware |
| **Caveman** | Controls terse response style. | Lite |
| **Ponytail** | Biases implementation toward minimal, reusable code and YAGNI. | Full |

Headroom ML/Kompress support is optional and is not downloaded until enabled.

## Runtime provisioning

Third-party tools are not embedded in the packaged executable. The launcher downloads them into the app-owned optimization runtime under the Codex Web GPT home:

```text
<CODEX_CHATGPT_WEB_HOME>/
├── optimization/
│   ├── settings.json
│   └── versions.json
└── optimization-runtime/
    ├── components/
    ├── runtimes/
    ├── downloads/
    ├── staging/
    └── cache/
```

Settings and runtime dependencies are kept separate. Managed component paths are constrained to `optimization-runtime`; records that are unhealthy or outside that root are ignored.

## Updates and self-repair

With **Automatic optimizer updates** enabled (the default), every launcher startup:

1. starts a valid last-known-good local Headroom runtime immediately when enabled;
2. checks the configured upstream source for each managed component;
3. downloads updates into staging/private version directories;
4. verifies checksums, executable versions, package health, or skill content as applicable;
5. activates only a verified installation;
6. keeps the previous working version if an update or health check fails.

Use **Check & update** in Settings to run the same process manually.

Stable GitHub releases are preferred when an upstream project publishes them. Components without releases are tracked by exact upstream commit SHA.

## Failure behavior

Optimization is fail-open:

- unavailable RTK → original command result;
- unsupported or larger RTK result → original command result;
- command/session metadata → preserved byte-exact;
- unavailable Headroom → original context/output;
- invalid Headroom structure → original context;
- unavailable/invalid Jev decision → existing ChatGPT Web routing;
- missing managed policy snapshot → built-in conservative fallback policy.

Errors in an optional optimizer must not prevent the normal ChatGPT Web task from running.

## Security notes

- downloads use HTTPS and platform-specific verification where upstream provides digests/checksums;
- Headroom listens only on loopback;
- the Jev/TypeSafe key is stored through Electron `safeStorage` and injected only into the managed bridge process environment;
- secrets and full prompt contents are not written to optimizer status logs;
- runtime paths are validated before executables or policy files are loaded;
- the launcher stops managed sidecars during normal quit and fatal startup cleanup.

Third-party components keep their upstream licenses and attribution in their managed runtime snapshots/packages.
