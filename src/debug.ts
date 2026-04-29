const ENABLED =
  process.env.MCP_DEBUG === "true" || process.env.MCP_DEBUG === "1";

export function dbg(category: string, ...args: unknown[]): void {
  if (!ENABLED) return;
  process.stderr.write(
    `[${new Date().toISOString()}] [${category}] ${args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}\n`
  );
}

export const DEBUG = ENABLED;
