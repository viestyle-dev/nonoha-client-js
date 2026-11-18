import { describe, expect, it, beforeEach, vi } from 'vitest'
import { InspectorClient, InspectorCloseCode, SampleFlag } from '../inspector-client'
import { PortDataType } from '../types'

class FakeSocket {
  static last: FakeSocket | null = null
  static count = 0
  readyState = 0
  binaryType = ''
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  constructor(public url: string) {
    FakeSocket.last = this
    FakeSocket.count++
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
  }
  // test helpers
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  text(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  binary(buffer: ArrayBuffer) {
    this.onmessage?.({ data: buffer })
  }
  drop(code: number) {
    this.readyState = 3
    this.onclose?.({ code })
  }
  ops() {
    return this.sent.map((s) => JSON.parse(s))
  }
}

/** Sample frame with one f32 value of shape (1, n); `steps`: one slot's strides. */
function sampleFrame(watchId: number, frameSeq: number, data: number[], flags = 0, steps: number[] | null = null): ArrayBuffer {
  const stepBytes = steps ? 1 + 2 * steps.length : 0
  const payload = 1 + 1 + 1 + 2 + 4 + 4 * data.length
  const buffer = new ArrayBuffer(26 + stepBytes + payload)
  const v = new DataView(buffer)
  v.setUint8(0, 0x21)
  v.setUint8(1, 1)
  v.setUint16(2, watchId)
  v.setUint32(4, frameSeq)
  v.setUint32(8, frameSeq)
  v.setUint32(12, 100 + frameSeq)
  v.setFloat64(16, 12.5)
  v.setUint8(24, flags)
  v.setUint8(25, steps ? 1 : 0)
  let o = 26
  if (steps) {
    v.setUint8(o++, steps.length)
    for (const x of steps) {
      v.setUint16(o, x)
      o += 2
    }
  }
  v.setUint8(o++, 1) // value count
  v.setUint8(o++, PortDataType.Float32)
  v.setUint8(o++, 1) // ndim
  v.setUint16(o, data.length)
  o += 2
  v.setUint32(o, 4 * data.length)
  o += 4
  for (const x of data) {
    v.setFloat32(o, x)
    o += 4
  }
  return buffer
}

function client() {
  return new InspectorClient('localhost:8000', 'app', {
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    pauseWhenHidden: false,
  })
}

const REF = { node: 'Resize_1', dir: 'out' as const, port: 'dst' }

describe('InspectorClient', () => {
  beforeEach(() => {
    FakeSocket.last = null
    FakeSocket.count = 0
  })

  it('says hello and restores watches and activity on open', () => {
    const c = client()
    c.watch(REF, { intervalMs: 100 }, { onSample: () => {} })
    c.setActivityPorts([REF], 400)
    c.connect()
    const s = FakeSocket.last!
    expect(s.url).toBe('ws://localhost:8000/node-flow/graphs/app/inspector/ws')
    s.open()
    const ops = s.ops()
    expect(ops[0]).toMatchObject({ op: 'hello', protocol: 1 })
    expect(ops[1]).toMatchObject({
      op: 'activity',
      interval_ms: 400,
      ports: [{ node: 'Resize_1', dir: 'out', port: 'dst' }],
    })
    expect(ops[2]).toMatchObject({ op: 'watch', node: 'Resize_1', port: 'dst', interval_ms: 100, batch: 'last' })
  })

  it('merges subscribers of the same port and options into one watch', () => {
    const c = client()
    c.connect()
    const s = FakeSocket.last!
    s.open()
    s.sent.length = 0
    const a = c.watch(REF, { intervalMs: 500 }, { onSample: () => {} })
    const b = c.watch(REF, { intervalMs: 100 }, { onSample: () => {} })
    c.watch(REF, { intervalMs: 100, maxBytes: 4096 }, { onSample: () => {} }) // different options
    const watches = s.ops().filter((o) => o.op === 'watch')
    expect(watches.map((w) => [w.id, w.interval_ms])).toEqual([
      [1, 500],
      [1, 100],
      [2, 100],
    ])
    s.sent.length = 0
    b.unwatch()
    expect(s.ops()).toEqual([expect.objectContaining({ op: 'watch', id: 1, interval_ms: 500 })])
    s.sent.length = 0
    a.unwatch()
    expect(s.ops()).toEqual([{ op: 'unwatch', id: 1 }])
  })

  it('asks for a snapshot when joining a watch without changing its interval', () => {
    const c = client()
    c.connect()
    const s = FakeSocket.last!
    s.open()
    c.watch(REF, { intervalMs: 100 }, { onSample: () => {} })
    s.sent.length = 0
    c.watch(REF, { intervalMs: 300 }, { onSample: () => {} })
    expect(s.ops()).toEqual([{ op: 'snapshot', id: 1 }])
  })

  it('parses samples, reuses buffers and acknowledges each frame', () => {
    const c = client()
    c.connect()
    const s = FakeSocket.last!
    s.open()
    const got: { seq: number; data: number[]; count: number; array: unknown }[] = []
    c.watch(REF, {}, {
      onSample: (sample) => {
        const value = sample.values![0]
        got.push({
          seq: sample.frameSeq,
          data: Array.from(value.array as Float32Array),
          count: sample.dispatchCount,
          array: value.array,
        })
        expect(value.shape).toEqual([1, 3])
        expect(sample.t).toBe(12.5)
      },
    })
    s.sent.length = 0
    s.binary(sampleFrame(1, 7, [1, 2, 3]))
    s.binary(sampleFrame(1, 8, [4, 5, 6]))
    expect(got.map((g) => [g.seq, g.data, g.count])).toEqual([
      [7, [1, 2, 3], 107],
      [8, [4, 5, 6], 108],
    ])
    expect(got[1].array).toBe(got[0].array) // same Float32Array reused
    expect(s.sent).toEqual(['{"op":"ack","seq":7}', '{"op":"ack","seq":8}'])
  })

  it('reports a sample too large to send and goes on', () => {
    const c = client()
    c.connect()
    const s = FakeSocket.last!
    s.open()
    const errors: string[] = []
    const got: number[] = []
    c.watch(REF, {}, { onSample: (sample) => got.push(sample.values.length), onError: (code) => errors.push(code) })
    s.text({ t: 'error', id: 1, code: 'too_large', message: 'f32[1x5000]: 20000 bytes, more than max_bytes 1024' })
    s.binary(sampleFrame(1, 1, [1, 2, 3], SampleFlag.Reduced | SampleFlag.Gap))
    expect(errors).toEqual(['too_large'])
    expect(got).toEqual([1]) // every sample carries values
  })

  it('reuses the steps arrays while the slots stay the same', () => {
    const c = client()
    c.connect()
    const s = FakeSocket.last!
    s.open()
    const steps: number[][][] = []
    c.watch(REF, {}, { onSample: (sample) => steps.push(sample.steps) })
    s.binary(sampleFrame(1, 1, [1, 2], SampleFlag.Reduced, [3, 3]))
    s.binary(sampleFrame(1, 2, [1, 2], SampleFlag.Reduced, [4, 4]))
    expect(steps[1]).toBe(steps[0])
    expect(steps[1]).toEqual([[4, 4]])
  })

  it('never gives a new watch an id still in use', () => {
    const c = client()
    c.connect()
    const s = FakeSocket.last!
    s.open()
    c.watch(REF, {}, { onSample: () => {} }) // id 1, kept
    ;(c as unknown as { nextWatchId: number }).nextWatchId = 0xffff // as after 65534 short-lived watches
    c.watch({ node: 'A', dir: 'out', port: 'x' }, {}, { onSample: () => {} }) // 65535
    c.watch({ node: 'B', dir: 'out', port: 'x' }, {}, { onSample: () => {} }) // wraps: 1 is taken
    const ids = s.ops().filter((op) => op.op === 'watch').map((op) => op.id)
    expect(ids).toEqual([1, 65535, 2])
  })

  it('keeps the activity set within the engine limit', () => {
    const c = client()
    c.setActivityPorts([REF, { node: 'A', dir: 'out', port: 'x' }, { node: 'B', dir: 'out', port: 'x' }])
    c.connect()
    const s = FakeSocket.last!
    s.open()
    s.text({ t: 'hello', protocol: 1, limits: { max_activity_ports: 2 }, plugins: [] })
    const sets = s.ops().filter((op) => op.op === 'activity')
    expect(sets.map((op) => op.ports.length)).toEqual([3, 2]) // resent once the limit is known
  })

  it('reconnects after the engine ended a session that stopped acknowledging', () => {
    vi.useFakeTimers()
    try {
      const c = client()
      const reasons: string[][] = []
      c.onStatus((st) => reasons.push(st.reasons))
      c.connect()
      FakeSocket.last!.open()
      const count = FakeSocket.count
      FakeSocket.last!.drop(InspectorCloseCode.Ended)
      expect(reasons[reasons.length - 1]).toEqual(['ended'])
      vi.advanceTimersByTime(1000)
      expect(FakeSocket.count).toBe(count + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('updates activity entries in place and reports the changed ones', () => {
    const c = client()
    c.setActivityPorts([REF, { node: '', dir: 'in', port: 'frame' }])
    c.connect()
    const s = FakeSocket.last!
    s.open()
    const changed: number[] = []
    c.onActivity((entries) => entries.forEach((e) => changed.push(e.count)))
    s.text({
      t: 'activity',
      ts: 1,
      p: [
        [1, 42, 15, 0.03, 'f32', [1, 3], [0, 1, 0.5], null],
        [99, 1, 1, 0, null, null, null, null],
      ],
    })
    const entry = c.activityOf(REF)!
    expect(entry).toMatchObject({ count: 42, hz: 15, dtype: 'f32', shape: [1, 3], stats: [0, 1, 0.5] })
    expect(changed).toEqual([42])
    s.text({ t: 'activity', ts: 2, p: [[1, 50, 16, 0.01, 'f32', [1, 3], null, 2]] })
    expect(c.activityOf(REF)).toBe(entry)
    expect(entry.count).toBe(50)
  })

  it('reports engine status and stops when the inspector is disabled', () => {
    const c = client()
    const states: string[] = []
    c.onStatus((st) => states.push(st.state))
    c.connect()
    const s = FakeSocket.last!
    s.open()
    s.text({ t: 'hello', protocol: 1, limits: {}, plugins: [{ id: 'cv_nodes', version: '0.3.0' }] })
    s.text({ t: 'status', state: 'paused', reasons: ['loop_lag'] })
    expect(c.hello?.plugins[0].id).toBe('cv_nodes')
    s.drop(InspectorCloseCode.Disabled)
    expect(states).toEqual(['connecting', 'ok', 'paused', 'disabled'])
    expect(FakeSocket.count).toBe(1) // no reconnect
  })

  it('resumes the engine only on forceResume; tab visibility pauses and resumes this connection', () => {
    const listeners: Record<string, () => void> = {}
    const fakeDocument = {
      visibilityState: 'visible',
      addEventListener: (type: string, fn: () => void) => {
        listeners[type] = fn
      },
      removeEventListener: () => {},
    }
    vi.stubGlobal('document', fakeDocument)
    try {
      const c = new InspectorClient('localhost:8000', 'app', {
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      })
      c.connect()
      const s = FakeSocket.last!
      s.open()
      s.sent.length = 0
      fakeDocument.visibilityState = 'hidden'
      listeners.visibilitychange()
      fakeDocument.visibilityState = 'visible'
      listeners.visibilitychange()
      expect(s.ops()).toEqual([{ op: 'pause' }, { op: 'resume' }])
      s.sent.length = 0
      c.forceResume()
      expect(s.ops()).toEqual([{ op: 'force_resume' }])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses an unknown protocol version', () => {
    const c = client()
    c.connect()
    const s = FakeSocket.last!
    s.open()
    s.text({ t: 'hello', protocol: 2, limits: {}, plugins: [] })
    expect(c.status.state).toBe('unsupported')
  })
})
