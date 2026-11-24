import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  dataFileUrl,
  engineFetch,
  engineToken,
  engineWebSocket,
  fetchAccessMe,
  prepareEngine,
  setEngineToken,
} from '../engine'

/** An engine at `host`: its capabilities say `access`; other routes answer `status`. */
function stubEngine(host: string, access: unknown, status = 200, body: unknown = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url === `http://${host}/node-flow/capabilities`) {
      return { ok: true, status: 200, json: async () => ({ engine: '1.3.0', access }) }
    }
    return { ok: status < 400, status, json: async () => body }
  })
  return calls
}

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  }
}

const authorization = (init?: RequestInit) => new Headers(init?.headers).get('Authorization')

describe('engine entrance', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends no token to an engine that wants none', async () => {
    const calls = stubEngine('a:1', undefined)
    vi.stubGlobal('localStorage', memoryStorage())
    await engineFetch('a:1', '/node-flow/graphs')
    expect(calls.at(-1)!.url).toBe('http://a:1/node-flow/graphs')
    expect(calls.at(-1)!.init).toBeUndefined()
  })

  it('presents the token as a header, and drops it when the engine no longer knows it', async () => {
    const calls = stubEngine('b:1', { id: 'list-b', anonymous_level: 'none' }, 401)
    vi.stubGlobal('localStorage', memoryStorage())
    await prepareEngine('b:1')
    setEngineToken('b:1', 'nnt_b')
    expect(engineToken('b:1')).toBe('nnt_b')
    const res = await engineFetch('b:1', '/node-flow/graphs', { method: 'GET' })
    expect(res.status).toBe(401)
    expect(authorization(calls.at(-1)!.init)).toBe('Bearer nnt_b')
    expect(engineToken('b:1')).toBeNull()
  })

  it('keeps tokens per engine: the same address with another list is another engine', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    stubEngine('c:1', { id: 'list-1', anonymous_level: 'none' })
    await prepareEngine('c:1')
    setEngineToken('c:1', 'nnt_c')
    const stored = JSON.parse(storage.getItem('nonoha.engine-tokens')!)
    expect(stored).toEqual({ 'http://c:1 list-1': 'nnt_c' })
  })

  it('keeps a token for this page only when asked', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    stubEngine('d:1', { id: 'list-d', anonymous_level: 'none' })
    await prepareEngine('d:1')
    setEngineToken('d:1', 'nnt_d', false)
    expect(engineToken('d:1')).toBe('nnt_d')
    expect(storage.getItem('nonoha.engine-tokens')).toBeNull()
  })

  it('offers the token to a WebSocket as a subprotocol', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    stubEngine('e:1', { id: 'list-e', anonymous_level: 'none' })
    await prepareEngine('e:1')
    setEngineToken('e:1', 'nnt_e')
    const opened: unknown[][] = []
    class FakeSocket {
      constructor(...args: unknown[]) {
        opened.push(args)
      }
    }
    engineWebSocket('e:1', '/node-flow/graphs/g/endpoint/ws', FakeSocket as unknown as typeof WebSocket)
    expect(opened[0]).toEqual(['ws://e:1/node-flow/graphs/g/endpoint/ws', ['nonoha', 'nonoha.token.nnt_e']])
  })

  it('takes a token handed over in the page address, for the page own engine only', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const replaced: string[] = []
    vi.stubGlobal('location', { origin: 'http://f:1', hash: '#nonoha-token=nnt_f&tab=2', pathname: '/app/', search: '' })
    vi.stubGlobal('history', { state: null, replaceState: (_: unknown, __: string, url: string) => replaced.push(url) })
    stubEngine('f:1', { id: 'list-f', anonymous_level: 'none' })
    await prepareEngine('f:1')
    expect(engineToken('f:1')).toBe('nnt_f')
    expect(replaced).toEqual(['/app/#tab=2'])

    stubEngine('g:1', { id: 'list-g', anonymous_level: 'none' })
    await prepareEngine('g:1') // another engine than the page's: the address's token is not for it
    expect(engineToken('g:1')).toBeNull()
  })

  it('says who the client is; an engine before access says everyone may do everything', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    stubEngine('h:1', undefined, 404)
    await expect(fetchAccessMe('h:1')).resolves.toEqual({ level: 'full', id: null, name: null, rejected: false })
  })

  it('opens data through a signed link with a token, through the data route without one', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    stubEngine('i:1', undefined)
    await expect(dataFileUrl('i:1', 'main', 'reports/a b.md')).resolves.toBe(
      'http://i:1/node-flow/graphs/main/data/reports/a%20b.md?raw',
    )
    const calls = stubEngine('j:1', { id: 'list-j', anonymous_level: 'none' }, 200, { url: '/node-flow/data-links/L/reports/' })
    await prepareEngine('j:1')
    setEngineToken('j:1', 'nnt_j')
    await expect(dataFileUrl('j:1', 'main', 'reports/')).resolves.toBe('http://j:1/node-flow/data-links/L/reports/')
    expect(calls.at(-1)!.url).toBe('http://j:1/node-flow/graphs/main/data-links')
    expect(JSON.parse(String(calls.at(-1)!.init!.body))).toEqual({ path: 'reports/', seconds: 3600 })
  })
})
