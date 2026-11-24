/**
 * The one way to talk to an engine: every HTTP request and WebSocket goes
 * through here and carries the engine's token when one is known.
 *
 * An engine may want a token (engine 1.3+, "Access" in its docs): a client
 * presents it as `Authorization: Bearer <token>`; a browser WebSocket, which
 * cannot set headers, offers the subprotocols `nonoha` and
 * `nonoha.token.<token>`. A client without a token gets what the engine
 * allows anyone (`anonymous_level`): `full` on an engine that wants none.
 *
 * Tokens are kept per engine: its address and its access id together (the
 * same address can be another engine later, e.g. another workspace on the
 * same port). Kept in `localStorage`, or only for this page.
 */
import { httpBase, wsBase } from './gateway'

export type AccessLevel = 'none' | 'use' | 'full'

/** What an engine says about its access (`capabilities.access`). */
export interface EngineAccess {
  /** Identifies the engine's tokens; null when it has no token list. */
  id: string | null
  /** What a client without a token may do. */
  anonymous_level: AccessLevel
}

/** Who this client is to the engine (`GET /node-flow/tokens/me`). */
export interface AccessMe {
  level: AccessLevel
  id: string | null
  name: string | null
  /** The token presented is not known to the engine (revoked): it was dropped. */
  rejected: boolean
}

const STORE_KEY = 'nonoha.engine-tokens'
const FRAGMENT_KEY = 'nonoha-token'
/** null: an engine without access (before 1.3): every request goes without a token. */
const accessOf = new Map<string, Promise<EngineAccess | null>>()
const knownAccess = new Map<string, EngineAccess | null>()
const pageTokens = new Map<string, string>()

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null
  } catch {
    return null // storage blocked (private mode, sandboxed frame)
  }
}

function readStore(): Record<string, string> {
  try {
    const parsed = JSON.parse(storage()?.getItem(STORE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(tokens: Record<string, string>): void {
  try {
    storage()?.setItem(STORE_KEY, JSON.stringify(tokens))
  } catch {
    // storage full or blocked: the token lives for this page only
  }
}

function tokenKey(engineGatewayUrl: string): string {
  const base = httpBase(engineGatewayUrl)
  return `${base} ${knownAccess.get(base)?.id ?? ''}`
}

/**
 * Learn how the engine wants to be talked to (once per engine; later calls
 * return the same answer). Run it before opening WebSockets: they take the
 * token when they open. A page served by the engine itself also takes a
 * token handed over in its address (`#nonoha-token=…`, as a launcher opens
 * it) and removes it from the address at once.
 */
export function prepareEngine(engineGatewayUrl: string): Promise<EngineAccess | null> {
  const base = httpBase(engineGatewayUrl)
  let pending = accessOf.get(base)
  if (pending === undefined) {
    pending = readAccess(base)
    accessOf.set(base, pending)
  }
  return pending
}

async function readAccess(base: string): Promise<EngineAccess | null> {
  let access: EngineAccess | null = null
  try {
    const res = await fetch(`${base}/node-flow/capabilities`)
    if (res.ok) access = ((await res.json()) as { access?: EngineAccess }).access ?? null
  } catch {
    // unreachable for now: requests go without a token and report their own errors
  }
  knownAccess.set(base, access)
  takeFragmentToken(base)
  return access
}

function takeFragmentToken(base: string): void {
  const location = (globalThis as { location?: Location }).location
  if (!location || location.origin !== base) return // the token is for the page's own engine
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''))
  const token = fragment.get(FRAGMENT_KEY)
  if (!token) return
  setEngineToken(base, token)
  fragment.delete(FRAGMENT_KEY)
  const rest = fragment.toString()
  const history = (globalThis as { history?: History }).history
  history?.replaceState(history.state, '', `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`)
}

/** The token this client has for the engine; null without one (or before `prepareEngine`). */
export function engineToken(engineGatewayUrl: string): string | null {
  const key = tokenKey(engineGatewayUrl)
  return pageTokens.get(key) ?? readStore()[key] ?? null
}

/** Keep a token for the engine: in this browser (`remember`), or for this page only. */
export function setEngineToken(engineGatewayUrl: string, token: string, remember = true): void {
  const key = tokenKey(engineGatewayUrl)
  const stored = readStore()
  if (remember) {
    pageTokens.delete(key)
    writeStore({ ...stored, [key]: token })
  } else {
    pageTokens.set(key, token)
    if (key in stored) {
      delete stored[key]
      writeStore(stored)
    }
  }
}

/** Drop the token for the engine (it was revoked, or the user signs out of it). */
export function forgetEngineToken(engineGatewayUrl: string): void {
  const key = tokenKey(engineGatewayUrl)
  pageTokens.delete(key)
  const stored = readStore()
  if (key in stored) {
    delete stored[key]
    writeStore(stored)
  }
}

/**
 * The `Authorization` header value for a request this module cannot send
 * itself (an upload with progress goes through XMLHttpRequest); null
 * without a token. Call after `prepareEngine`.
 */
export function engineAuthorization(engineGatewayUrl: string): string | null {
  const token = engineToken(engineGatewayUrl)
  return token === null ? null : `Bearer ${token}`
}

function withToken(init: RequestInit | undefined, token: string | null): RequestInit | undefined {
  if (token === null) return init
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return { ...init, headers }
}

/**
 * An HTTP request to the engine (`path` starts with "/"). A token the
 * engine no longer knows (401 to a request that carried it) is dropped.
 */
export async function engineFetch(engineGatewayUrl: string, path: string, init?: RequestInit): Promise<Response> {
  await prepareEngine(engineGatewayUrl)
  const token = engineToken(engineGatewayUrl)
  const res = await fetch(`${httpBase(engineGatewayUrl)}${path}`, withToken(init, token))
  if (res.status === 401 && token !== null) forgetEngineToken(engineGatewayUrl)
  return res
}

/** A WebSocket to the engine (`path` starts with "/"), offering the token when one is known. */
export function engineWebSocket(
  engineGatewayUrl: string,
  path: string,
  Impl: typeof WebSocket = WebSocket,
): WebSocket {
  const token = engineToken(engineGatewayUrl)
  const url = `${wsBase(engineGatewayUrl)}${path}`
  return token === null ? new Impl(url) : new Impl(url, ['nonoha', `nonoha.token.${token}`])
}

/** Who this client is to the engine; an engine without access says everyone may do everything. */
export async function fetchAccessMe(engineGatewayUrl: string): Promise<AccessMe> {
  const res = await engineFetch(engineGatewayUrl, '/node-flow/tokens/me')
  if (res.status === 404) return { level: 'full', id: null, name: null, rejected: false }
  if (!res.ok) throw new Error(`tokens/me: HTTP ${res.status}`)
  return (await res.json()) as AccessMe
}

function dataPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * An address that opens a data file (or, for a folder ending in "/", what
 * is below it) without a header: for an image, a video, a new tab. With a
 * token, a link the engine signed (it expires: `seconds`, at most a day);
 * without one, the data route itself.
 */
export async function dataFileUrl(
  engineGatewayUrl: string,
  graphName: string,
  path: string,
  seconds = 3600,
): Promise<string> {
  await prepareEngine(engineGatewayUrl)
  const base = httpBase(engineGatewayUrl)
  if (engineToken(engineGatewayUrl) === null) {
    return `${base}/node-flow/graphs/${encodeURIComponent(graphName)}/data/${dataPath(path)}?raw`
  }
  const res = await engineFetch(engineGatewayUrl, `/node-flow/graphs/${encodeURIComponent(graphName)}/data-links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, seconds }),
  })
  if (!res.ok) throw new Error(`data link: HTTP ${res.status}`)
  const { url } = (await res.json()) as { url: string }
  return `${base}${url}`
}
