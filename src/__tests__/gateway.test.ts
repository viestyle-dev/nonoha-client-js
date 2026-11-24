import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpBase, wsBase } from '../gateway'
import { pluginStaticUrl } from '../plugin-client'

describe('the engine base URLs', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reaches "host:port" over http and ws', () => {
    expect(httpBase('localhost:8000')).toBe('http://localhost:8000')
    expect(wsBase('localhost:8000')).toBe('ws://localhost:8000')
    expect(httpBase('http://192.168.1.5:8000/')).toBe('http://192.168.1.5:8000')
  })

  it('uses a full https origin as given', () => {
    expect(httpBase('https://engine.example.dev')).toBe('https://engine.example.dev')
    expect(wsBase('https://engine.example.dev:8443/')).toBe('wss://engine.example.dev:8443')
  })

  it('reaches the page\'s own host the way an https page was reached itself', () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'abc.example-relay.dev' })
    expect(httpBase('abc.example-relay.dev')).toBe('https://abc.example-relay.dev')
    expect(wsBase('abc.example-relay.dev')).toBe('wss://abc.example-relay.dev')
    // Another engine named from that page stays plain: only a full origin says otherwise
    expect(wsBase('localhost:8000')).toBe('ws://localhost:8000')
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:8000' })
    expect(wsBase('localhost:8000')).toBe('ws://localhost:8000')
  })

  it('is what the clients build their URLs from', () => {
    expect(pluginStaticUrl('https://engine.example.dev', { static: '/plugins/cv_nodes/static/', rev: 'r1' }, 'views/a.js'))
      .toBe('https://engine.example.dev/plugins/cv_nodes/static/views/a.js?rev=r1')
  })
})
