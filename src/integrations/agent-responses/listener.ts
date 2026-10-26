import type { AgentResponsesProvider } from "./routes";

export type AgentResponsesListenerState =
  | { status: "disabled"; server?: never }
  | { status: "ready"; server: { stop(force?: boolean): unknown }; port: number }
  | { status: "bind_failed"; server?: never; port: number };

type Serve = (options: {
  hostname: "127.0.0.1";
  port: number;
  idleTimeout: number;
  fetch(request: Request): Response | Promise<Response>;
}) => { stop(force?: boolean): unknown };

/** An optional in-process socket: callers must explicitly select a non-native port. */
export function startAgentResponsesListener(options: {
  port?: number;
  provider: AgentResponsesProvider;
  serve?: Serve;
  isDraining?: () => boolean;
}): AgentResponsesListenerState {
  if (options.port === undefined || !options.provider.enabled) return { status: "disabled" };
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535 || options.port === 17_841) {
    throw new RangeError("Generic Responses requires an explicit valid port different from native 17841");
  }
  try {
    const serve: Serve = options.serve ?? (Bun.serve as unknown as Serve);
    const server = serve({ hostname: "127.0.0.1", port: options.port, idleTimeout: 0,
      // Evaluate drain at admission, after body parsing, not before a slow upload.
      fetch: request => options.provider.handle(request, new URL(request.url).pathname, options.isDraining),
    });
    return { status: "ready", port: options.port, server };
  } catch (error) {
    // A refused/occupied generic bind must not kill the native 17841 listener.
    const rawCode = (error as { code?: unknown } | null)?.code;
    const code = rawCode === "EADDRINUSE" || rawCode === "EACCES" || rawCode === "EADDRNOTAVAIL"
      ? rawCode : "unknown";
    console.warn(`[agent-responses] listener_bind_failed port=${options.port} code=${code}`);
    return { status: "bind_failed", port: options.port };
  }
}
