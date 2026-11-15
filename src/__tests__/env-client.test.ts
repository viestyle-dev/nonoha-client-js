import { afterEach, describe, expect, it, vi } from 'vitest'

import { EnvError, clearEnv, fetchEnvStatus, setEnv } from '../env-client'

const status = { file: '/ws/.env', writable: true, items: [] }

function stubFetch(response: { ok: boolean; status: number; body: unknown }) {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('env client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the status', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: status })
    await expect(fetchEnvStatus('127.0.0.1:8000')).resolves.toEqual(status)
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8000/node-flow/env', undefined)
  })

  it('writes a value as JSON and removes one', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: status })
    await setEnv('127.0.0.1:8000', 'GEMINI_API_KEY', 'k')
    expect(fetchMock).toHaveBeenLastCalledWith('http://127.0.0.1:8000/node-flow/env/GEMINI_API_KEY', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"value":"k"}',
    })
    await clearEnv('127.0.0.1:8000', 'A B')
    expect(fetchMock).toHaveBeenLastCalledWith('http://127.0.0.1:8000/node-flow/env/A%20B', { method: 'DELETE' })
  })

  it('turns refusals into EnvError with the engine reason', async () => {
    stubFetch({ ok: false, status: 403, body: { detail: 'Set in the OS environment, which takes precedence' } })
    const error = await setEnv('h:1', 'K', 'v').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EnvError)
    expect((error as EnvError).status).toBe(403)
    expect((error as EnvError).message).toContain('OS environment')
  })
})
