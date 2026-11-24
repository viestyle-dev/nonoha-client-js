/**
 * The base URLs of an engine, from the `engineGatewayUrl` a client is given.
 *
 * The usual form is "host:port". The engine itself speaks plain HTTP, so it
 * is reached over http and ws. An engine behind a TLS front (a relay, a
 * reverse proxy) is reached over https and wss, in one of two ways:
 *
 * - a full origin: "https://host" or "https://host:port" ("http://…" is
 *   accepted too and means what "host:port" means);
 * - the page's own `location.host`, from a page that was loaded over https:
 *   such a page reaches the engine the way it was reached itself (it could
 *   not open ws:// or http:// anyway).
 */
function parts(engineGatewayUrl: string): { secure: boolean; host: string } {
  const origin = /^(https?):\/\/([^/]+)\/*$/.exec(engineGatewayUrl)
  if (origin) return { secure: origin[1] === 'https', host: origin[2] }
  const page = (globalThis as { location?: { protocol?: string; host?: string } }).location
  return { secure: page?.protocol === 'https:' && page.host === engineGatewayUrl, host: engineGatewayUrl }
}

/** "http://host:port" or "https://host": the base of the engine's HTTP API. */
export function httpBase(engineGatewayUrl: string): string {
  const { secure, host } = parts(engineGatewayUrl)
  return `${secure ? 'https' : 'http'}://${host}`
}

/** "ws://host:port" or "wss://host": the base of the engine's WebSocket endpoints. */
export function wsBase(engineGatewayUrl: string): string {
  const { secure, host } = parts(engineGatewayUrl)
  return `${secure ? 'wss' : 'ws'}://${host}`
}
