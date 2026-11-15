/**
 * Environment values of an engine (API keys and other per-deployment
 * settings). The engine only ever returns names and status: a value can be
 * written or removed, never read back.
 */

export type EnvSource = 'os' | 'file' | 'none'

export interface EnvItem {
  name: string
  description: string
  /** Where to get the value (e.g. a provider's API key page); may be empty. */
  url: string
  /** Nodes that read this name, as `graph/node`. */
  declared_by: string[]
  set: boolean
  /** `os`: the OS environment (wins over the file); `file`: the engine's .env. */
  source: EnvSource
  writable: boolean
  /** Why it cannot be written, when `writable` is false. */
  reason?: string
}

export interface EnvStatus {
  /** The engine's .env path, or null when it has none. */
  file: string | null
  /** Whether that file can be written. */
  writable: boolean
  items: EnvItem[]
}

export class EnvError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'EnvError'
  }
}

async function requestEnv(url: string, init?: RequestInit): Promise<EnvStatus> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // not JSON
    }
    throw new EnvError(res.status, detail || `HTTP ${res.status}`)
  }
  return (await res.json()) as EnvStatus
}

function envUrl(engineGatewayUrl: string, name?: string): string {
  const base = `http://${engineGatewayUrl}/node-flow/env`
  return name === undefined ? base : `${base}/${encodeURIComponent(name)}`
}

/** Names the loaded graphs use and what is set (never the values). */
export function fetchEnvStatus(engineGatewayUrl: string): Promise<EnvStatus> {
  return requestEnv(envUrl(engineGatewayUrl))
}

/**
 * Store a value. Nodes see it at once; libraries and child processes after a
 * restart. Resolves to the new status.
 */
export function setEnv(engineGatewayUrl: string, name: string, value: string): Promise<EnvStatus> {
  return requestEnv(envUrl(engineGatewayUrl, name), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
}

/** Remove a value from the engine's .env. */
export function clearEnv(engineGatewayUrl: string, name: string): Promise<EnvStatus> {
  return requestEnv(envUrl(engineGatewayUrl, name), { method: 'DELETE' })
}
