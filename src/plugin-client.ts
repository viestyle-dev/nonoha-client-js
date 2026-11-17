/** A plugin the engine loaded (GET /node-flow/plugins). */
export interface PluginInfo {
  /** Module name, e.g. "cv_nodes". */
  id: string
  name?: string
  /** Built into the engine (a frozen build) rather than loaded from plugins/. */
  builtin: boolean
  version: string | null
  /** Path where the engine serves the plugin's static folder, e.g. "/plugins/cv_nodes/static/", or null without one. */
  static: string | null
  /** Revision of the static folder, for cache-busting URLs. */
  rev?: string | null
}

/** Plugins loaded by the engine; [] when the engine has no plugin list (before 1.1). */
export async function fetchPlugins(engineGatewayUrl: string): Promise<PluginInfo[]> {
  const res = await fetch(`http://${engineGatewayUrl}/node-flow/plugins`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`plugins: HTTP ${res.status}`)
  return (await res.json()) as PluginInfo[]
}
