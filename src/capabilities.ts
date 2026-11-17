/** What an engine offers (`GET /node-flow/capabilities`). */
export interface EngineCapabilities {
  engine: string
  inspector?: { enabled: boolean; protocol: number }
  /** Plugins' static folders are served (see `fetchPlugins`, `pluginStaticUrl`). */
  plugin_static?: boolean
  /** `GET/PUT/DELETE /node-flow/env` (environment values; see env-client). */
  env_settings?: boolean
}

/**
 * Read `GET /node-flow/capabilities`. Engines before 1.1 have no such
 * endpoint: they return null (treat them as "1.0, inspector unavailable").
 */
export async function fetchEngineCapabilities(
  engineGatewayUrl: string,
  init?: RequestInit,
): Promise<EngineCapabilities | null> {
  const res = await fetch(`http://${engineGatewayUrl}/node-flow/capabilities`, init)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`capabilities: HTTP ${res.status}`)
  return (await res.json()) as EngineCapabilities
}
