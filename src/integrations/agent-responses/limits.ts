/** Bound large external coding-agent tool catalogs without silently dropping capabilities. */
export const MAX_EXTERNAL_AGENT_FUNCTIONS = 512;
/** Bound schema memory independently of the number of tools while preserving full definitions. */
export const MAX_EXTERNAL_AGENT_TOOL_SCHEMA_BYTES = 4 * 1024 * 1024;
export const MAX_EXTERNAL_AGENT_TOTAL_SCHEMA_BYTES = 32 * 1024 * 1024;
