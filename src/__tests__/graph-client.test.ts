import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GraphClient } from '../graph-client'
import { PortDataType, PortData, PortValue } from '../types'

class FakeSocket {
  static last: FakeSocket | null = null
  binaryType = ''
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  onclose: ((event: { wasClean: boolean }) => void) | null = null
  constructor(readonly url: string) {
    FakeSocket.last = this
  }
  send() {}
  close() {}
}

const f32 = (n: number): PortValue => ({ dataType: PortDataType.Float32, shape: [1], array: new Float32Array([n]) })
const first = (values: PortValue[]) => (values[0].array as Float32Array)[0]

/** Bytes of an input message (event 0x00); outputs use the same layout with event 0x01. */
function serialize(client: GraphClient, data: PortData): ArrayBuffer {
  return (client as unknown as { serializePortData(data: PortData): ArrayBuffer }).serializePortData(data)
}

function emit(client: GraphClient, portName: string, n: number) {
  const buffer = serialize(client, { portName, values: [f32(n)] })
  new Uint8Array(buffer)[0] = 0x01
  FakeSocket.last!.onmessage!({ data: buffer })
}

/** fetch of the current value, resolved by the test. */
function deferredFetch(client: GraphClient) {
  const pending = new Map<string, (n: number | null | 'none') => void>()
  vi.stubGlobal('fetch', (url: string) => {
    const port = decodeURIComponent(url.split('/outputs/')[1].split('/')[0])
    return new Promise(resolve => {
      pending.set(port, n => {
        if (n === null) return resolve({ ok: false, status: 500 })
        if (n === 'none') return resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) })
        const buffer = serialize(client, { portName: port, values: [f32(n)] })
        resolve({ ok: true, status: 200, arrayBuffer: async () => buffer.slice(2 + port.length) })
      })
    })
  })
  return pending
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('GraphClient.subscribeOutput', () => {
  let client: GraphClient
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket)
    client = new GraphClient('h:8000', 'g')
    client.connect()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('delivers values of its port only, until stopped', () => {
    const seen: number[] = []
    const stop = client.subscribeOutput('level', values => seen.push(first(values)))
    emit(client, 'level', 1)
    emit(client, 'other', 9)
    emit(client, 'level', 2)
    stop()
    emit(client, 'level', 3)
    expect(seen).toEqual([1, 2])
  })

  it('delivers the current value first when asked', async () => {
    const pending = deferredFetch(client)
    const seen: number[] = []
    client.subscribeOutput('level', values => seen.push(first(values)), { current: true })
    pending.get('level')!(7)
    await settle()
    emit(client, 'level', 8)
    expect(seen).toEqual([7, 8])
  })

  it('drops the current value when a new one arrived before it', async () => {
    const pending = deferredFetch(client)
    const seen: number[] = []
    client.subscribeOutput('level', values => seen.push(first(values)), { current: true })
    emit(client, 'level', 8)
    pending.get('level')!(7) // older than 8
    await settle()
    expect(seen).toEqual([8])
  })

  it('delivers no current value while the port has none (empty body)', async () => {
    const pending = deferredFetch(client)
    const seen: number[] = []
    const errors: unknown[] = []
    client.subscribeOutput('level', values => seen.push(first(values)), { current: true, onError: e => errors.push(e) })
    pending.get('level')!('none')
    await settle()
    expect(seen).toEqual([])
    expect(errors).toEqual([])
  })

  it('reads an empty body as no value', async () => {
    const pending = deferredFetch(client)
    const fetched = client.fetchOutputValues('level')
    pending.get('level')!('none')
    expect(await fetched).toEqual([])
  })

  it('hands the current value to its own callback when given one', async () => {
    const pending = deferredFetch(client)
    const live: number[] = []
    const current: number[] = []
    client.subscribeOutput('clear', values => live.push(first(values)), { current: values => current.push(first(values)) })
    pending.get('clear')!(1)
    await settle()
    expect(live).toEqual([])
    expect(current).toEqual([1])
  })

  it('reports nothing after it is stopped', async () => {
    const pending = deferredFetch(client)
    const seen: number[] = []
    const errors: unknown[] = []
    const stop = client.subscribeOutput('a', values => seen.push(first(values)), { current: true, onError: e => errors.push(e) })
    const stopB = client.subscribeOutput('b', () => {}, { current: true, onError: e => errors.push(e) })
    stop()
    pending.get('a')!(1)
    pending.get('b')!(null)
    await settle()
    expect(seen).toEqual([])
    expect(errors.length).toBe(1) // only b, still subscribed
    stopB()
  })
})
