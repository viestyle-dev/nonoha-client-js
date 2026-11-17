import { PortValue } from './types'
import { parsePortValuesBytes } from './port-parser'

/**
 * Client for the engine's inspector WebSocket
 * (`/node-flow/graphs/{graph}/inspector/ws`, protocol 1).
 *
 * The inspector samples port values without being part of the graph: it
 * sends the latest value of watched ports at a bounded rate, and activity
 * statistics (dispatch count, Hz, min/max/mean) for many ports at once.
 * Samples can miss values; use `$output` ports for values an app relies on.
 *
 * - Watches with the same port and the same reduction options are merged
 *   into one engine watch whose interval is the shortest requested.
 * - Every sample is acknowledged automatically (the engine sends at most a
 *   few unacknowledged frames, so a slow client never builds a backlog).
 * - The connection pauses while the page is hidden and reconnects with
 *   backoff, restoring watches and activity ports.
 *
 * Objects passed to callbacks (samples, activity entries) and the typed
 * arrays inside them are reused for the next message of the same watch or
 * port. Copy what you need to keep beyond the callback.
 */

export const INSPECTOR_PROTOCOL = 1

/** WebSocket close codes sent by the engine. */
export const InspectorCloseCode = {
  Disabled: 4403,
  NoGraph: 4404,
  TooMany: 4429,
} as const

const FRAME_SAMPLE = 0x21
const HEADER_SIZE = 26 // u8 u8 u16 u32 u32 u32 f64 u8 u8

/** Sample flags (bit set). */
export const SampleFlag = {
  /** Strides were applied to fit max_bytes (see `steps`). */
  Reduced: 0x01,
  /** The values hold every batch row since the last sample, not just the last. */
  BatchAll: 0x02,
  /** Values were cast (e.g. f64 to f32). */
  Cast: 0x04,
  /** Too large even after reduction: `values` is null. */
  Truncated: 0x08,
} as const

export type PortDirection = 'in' | 'out'

/** A port in the inspected graph. `node: ""` addresses the graph's own ports. */
export interface InspectorPortRef {
  node: string
  dir: PortDirection
  port: string
}

export interface WatchOptions {
  /** Minimum time between samples (the engine may stretch it under load). */
  intervalMs?: number
  /** Byte budget per sample; larger values are strided (see `autoStride`). */
  maxBytes?: number
  /** 'last' batch row, 'all' rows of the latest dispatch, 'since' every row since the last sample, or the last N rows. */
  batch?: 'last' | 'all' | 'since' | number
  /** Per non-batch dimension (0 = first after the batch): [start, stop, step] or null. */
  slice?: ([number | null, number | null, number | null] | null)[] | null
  /**
   * Non-batch dimensions (0 = first after the batch) that may be strided to
   * fit `maxBytes`, e.g. [0, 1] for the height and width of an image.
   */
  autoStride?: number[]
  cast?: 'f32' | 'f64' | null
}

export interface InspectorSample {
  watchId: number
  frameSeq: number
  sampleSeq: number
  /** How many times the port has dispatched (counts values the sampling skipped). */
  dispatchCount: number
  /** Engine monotonic time of the sampled dispatch, in seconds. */
  t: number
  flags: number
  /** Per value slot: the stride applied to each non-batch dimension (empty when not reduced). */
  steps: number[][]
  /** null when the sample was truncated. */
  values: PortValue[] | null
}

export interface WatchInfo {
  /** Declared port value types, e.g. ["u8[180x320]"]. */
  types: string[]
  /** Shapes of the port's current values (with batch), or null before the first dispatch. */
  shape: number[][] | null
}

export interface WatchCallbacks {
  onSample: (sample: InspectorSample) => void
  onInfo?: (info: WatchInfo) => void
  /** The port was removed or replaced; the watch resumes if it comes back. */
  onGone?: () => void
  onError?: (code: string, message: string) => void
}

export interface WatchHandle {
  readonly ref: InspectorPortRef
  /** Change the interval of this subscriber. */
  setInterval(intervalMs: number): void
  /** Ask for the current value now, even if it did not change. */
  snapshot(): void
  unwatch(): void
}

export interface ActivityEntry {
  ref: InspectorPortRef
  /** Dispatches since the probe was attached. */
  count: number
  hz: number
  /** Seconds since the last dispatch, or null if none yet. */
  age: number | null
  dtype: string | null
  shape: number[] | null
  /** [min, max, mean] for small numeric values. */
  stats: [number, number, number] | null
  /** Latest scalar or short text, when small. */
  last: number | string | boolean | null
}

export type InspectorState =
  | 'idle'
  | 'connecting'
  | 'ok'
  | 'throttled'
  | 'paused'
  | 'hidden'
  | 'disabled'
  | 'no_graph'
  | 'unsupported'
  | 'closed'

export interface InspectorStatus {
  state: InspectorState
  reasons: string[]
  lagMs?: { ewma: number; max: number }
  intervalScale?: number
}

export interface InspectorHello {
  protocol: number
  limits: Record<string, number>
  plugins: { id: string; version: string | null; static?: boolean }[]
}

export interface InspectorClientOptions {
  /** Sent in hello, e.g. "nonoha-editor/1.1.0". */
  clientName?: string
  /** Reconnect after an unexpected close (default true). */
  reconnect?: boolean
  /** Pause sampling while the document is hidden (default true). */
  pauseWhenHidden?: boolean
  /** Supply a WebSocket constructor (tests, non-browser hosts). */
  WebSocketImpl?: typeof WebSocket
}

// --- internals -------------------------------------------------------------------

interface Subscriber {
  intervalMs: number
  callbacks: WatchCallbacks
}

interface EngineWatch {
  id: number
  key: string
  ref: InspectorPortRef
  options: WatchOptions
  /** Replaced (not mutated) on change: samples iterate it by index. */
  subscribers: Subscriber[]
  intervalMs: number
  info: WatchInfo | null
  /** Reused for every sample of this watch. */
  sample: InspectorSample
  previous: PortValue[] | undefined
}

interface ActivityPort {
  id: number
  entry: ActivityEntry
}

const NO_STEPS: number[][] = []
const DEFAULT_INTERVAL_MS = 200
const MAX_BACKOFF_MS = 10000

function refKey(ref: InspectorPortRef): string {
  return `${ref.node}\u0000${ref.dir}\u0000${ref.port}`
}

function watchKey(ref: InspectorPortRef, o: WatchOptions): string {
  return `${refKey(ref)}\u0000${o.maxBytes ?? ''}|${o.batch ?? 'last'}|${JSON.stringify(o.slice ?? null)}|${(o.autoStride ?? []).join(',')}|${o.cast ?? ''}`
}

export class InspectorClient {
  readonly engineGatewayUrl: string
  readonly graphName: string

  private readonly options: Required<Omit<InspectorClientOptions, 'WebSocketImpl'>>
  private readonly WebSocketImpl: typeof WebSocket | undefined
  private socket: WebSocket | null = null
  private wanted = false
  private backoffMs = 500
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private nextWatchId = 1
  private nextActivityId = 1
  private readonly watchesByKey = new Map<string, EngineWatch>()
  private readonly watchesById = new Map<number, EngineWatch>()
  private activityIntervalMs = 500
  private readonly activityPorts = new Map<string, ActivityPort>()
  private readonly activityById = new Map<number, ActivityPort>()
  private readonly changedActivity: ActivityEntry[] = []
  private readonly activityListeners = new Set<(changed: readonly ActivityEntry[]) => void>()
  private readonly statusListeners = new Set<(status: InspectorStatus) => void>()
  private readonly helloListeners = new Set<(hello: InspectorHello) => void>()
  private _status: InspectorStatus = { state: 'idle', reasons: [] }
  /** Last status reported by the engine (restored when the page becomes visible). */
  private engineStatus: InspectorStatus = { state: 'ok', reasons: [] }
  private _hello: InspectorHello | null = null
  private hidden = false
  private readonly onVisibility = () => this.applyVisibility()

  constructor(engineGatewayUrl: string, graphName: string, options: InspectorClientOptions = {}) {
    this.engineGatewayUrl = engineGatewayUrl
    this.graphName = graphName
    this.options = {
      clientName: options.clientName ?? 'nonoha-client-js',
      reconnect: options.reconnect ?? true,
      pauseWhenHidden: options.pauseWhenHidden ?? true,
    }
    this.WebSocketImpl = options.WebSocketImpl
  }

  get status(): InspectorStatus {
    return this._status
  }

  /** The engine's hello (limits and loaded plugins), once connected. */
  get hello(): InspectorHello | null {
    return this._hello
  }

  // --- connection ------------------------------------------------------------------

  connect(): void {
    this.wanted = true
    if (this.socket) return
    if (this.options.pauseWhenHidden && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility)
      this.hidden = document.visibilityState === 'hidden'
    }
    this.open()
  }

  close(): void {
    this.wanted = false
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility)
    }
    const socket = this.socket
    this.socket = null
    if (socket) socket.close(1000)
    this.setStatus({ state: 'closed', reasons: [] })
  }

  private open(): void {
    const Impl = this.WebSocketImpl ?? WebSocket
    const url = `ws://${this.engineGatewayUrl}/node-flow/graphs/${encodeURIComponent(this.graphName)}/inspector/ws`
    const socket = new Impl(url)
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    this.setStatus({ state: 'connecting', reasons: [] })

    socket.onopen = () => {
      this.backoffMs = 500
      this.sendJson({ op: 'hello', protocol: INSPECTOR_PROTOCOL, client: this.options.clientName })
      this.sendActivity()
      this.watchesById.forEach(watch => this.sendWatch(watch))
      if (this.hidden) this.sendJson({ op: 'pause' })
    }
    socket.onmessage = (event: MessageEvent) => {
      const data = event.data
      if (typeof data === 'string') this.handleText(data)
      else this.handleSample(data as ArrayBuffer)
    }
    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return
      this.socket = null
      this.handleClose(event.code)
    }
  }

  private handleClose(code: number): void {
    if (code === InspectorCloseCode.Disabled) {
      this.setStatus({ state: 'disabled', reasons: [] })
      return
    }
    if (code === InspectorCloseCode.NoGraph) {
      this.setStatus({ state: 'no_graph', reasons: [] })
      return
    }
    if (!this.wanted || !this.options.reconnect) {
      this.setStatus({ state: 'closed', reasons: [] })
      return
    }
    this.setStatus({ state: 'connecting', reasons: code === InspectorCloseCode.TooMany ? ['too_many'] : [] })
    const delay = this.backoffMs
    this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs * 2)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.wanted && !this.socket) this.open()
    }, delay)
  }

  private applyVisibility(): void {
    const hidden = document.visibilityState === 'hidden'
    if (hidden === this.hidden) return
    this.hidden = hidden
    this.sendJson({ op: hidden ? 'pause' : 'resume' })
    if (!this.socket) return
    this.setStatus(hidden ? { state: 'hidden', reasons: [] } : this.engineStatus)
  }

  /** Ask the engine to resume after it paused itself (e.g. after a load spike). */
  resume(): void {
    this.sendJson({ op: 'resume' })
  }

  // --- watches ---------------------------------------------------------------------

  watch(ref: InspectorPortRef, options: WatchOptions, callbacks: WatchCallbacks): WatchHandle {
    const key = watchKey(ref, options)
    let watch = this.watchesByKey.get(key)
    if (!watch) {
      const id = this.nextWatchId
      this.nextWatchId = id >= 0xffff ? 1 : id + 1
      watch = {
        id,
        key,
        ref: { node: ref.node, dir: ref.dir, port: ref.port },
        options: { ...options },
        subscribers: [],
        intervalMs: Infinity,
        info: null,
        sample: { watchId: id, frameSeq: 0, sampleSeq: 0, dispatchCount: 0, t: 0, flags: 0, steps: NO_STEPS, values: null },
        previous: undefined,
      }
      this.watchesByKey.set(key, watch)
      this.watchesById.set(id, watch)
    }
    const subscriber: Subscriber = { intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS, callbacks }
    watch.subscribers = watch.subscribers.concat(subscriber)
    if (!this.updateInterval(watch) && watch.subscribers.length > 1) {
      // Joined a running watch: ask for the current value instead of waiting.
      this.sendJson({ op: 'snapshot', id: watch.id })
    }
    if (watch.info) callbacks.onInfo?.(watch.info)

    const engineWatch = watch
    return {
      ref: engineWatch.ref,
      setInterval: (intervalMs: number) => {
        subscriber.intervalMs = intervalMs
        this.updateInterval(engineWatch)
      },
      snapshot: () => this.sendJson({ op: 'snapshot', id: engineWatch.id }),
      unwatch: () => {
        const remaining = engineWatch.subscribers.filter(s => s !== subscriber)
        if (remaining.length === engineWatch.subscribers.length) return
        engineWatch.subscribers = remaining
        if (remaining.length === 0) {
          this.watchesByKey.delete(engineWatch.key)
          this.watchesById.delete(engineWatch.id)
          this.sendJson({ op: 'unwatch', id: engineWatch.id })
        } else {
          this.updateInterval(engineWatch)
        }
      },
    }
  }

  /** Send the watch when its shortest interval changed; returns whether it was sent. */
  private updateInterval(watch: EngineWatch): boolean {
    let min = Infinity
    const subscribers = watch.subscribers
    for (let i = 0; i < subscribers.length; ++i) if (subscribers[i].intervalMs < min) min = subscribers[i].intervalMs
    if (min === watch.intervalMs) return false
    watch.intervalMs = min
    this.sendWatch(watch)
    return true
  }

  private sendWatch(watch: EngineWatch): void {
    const o = watch.options
    this.sendJson({
      op: 'watch',
      id: watch.id,
      node: watch.ref.node,
      dir: watch.ref.dir,
      port: watch.ref.port,
      interval_ms: watch.intervalMs,
      max_bytes: o.maxBytes,
      batch: o.batch ?? 'last',
      slice: o.slice ?? null,
      auto_stride: o.autoStride ?? [],
      cast: o.cast ?? null,
    })
  }

  // --- activity --------------------------------------------------------------------

  /**
   * Set the ports whose activity is reported (e.g. the ports visible on
   * screen); [] stops activity. Unchanged ports keep their statistics.
   */
  setActivityPorts(refs: readonly InspectorPortRef[], intervalMs = this.activityIntervalMs): void {
    const keep = new Set<string>()
    for (const ref of refs) {
      const key = refKey(ref)
      keep.add(key)
      if (!this.activityPorts.has(key)) {
        const id = this.nextActivityId++
        const port: ActivityPort = {
          id,
          entry: { ref: { node: ref.node, dir: ref.dir, port: ref.port }, count: 0, hz: 0, age: null, dtype: null, shape: null, stats: null, last: null },
        }
        this.activityPorts.set(key, port)
        this.activityById.set(id, port)
      }
    }
    this.activityPorts.forEach((port, key) => {
      if (!keep.has(key)) {
        this.activityPorts.delete(key)
        this.activityById.delete(port.id)
      }
    })
    this.activityIntervalMs = intervalMs
    this.sendActivity()
  }

  /** Latest activity of a port, if it is in the activity set. */
  activityOf(ref: InspectorPortRef): ActivityEntry | undefined {
    return this.activityPorts.get(refKey(ref))?.entry
  }

  onActivity(listener: (changed: readonly ActivityEntry[]) => void): () => void {
    this.activityListeners.add(listener)
    return () => this.activityListeners.delete(listener)
  }

  onStatus(listener: (status: InspectorStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  onHello(listener: (hello: InspectorHello) => void): () => void {
    this.helloListeners.add(listener)
    return () => this.helloListeners.delete(listener)
  }

  private sendActivity(): void {
    const ports: { id: number; node: string; dir: PortDirection; port: string }[] = []
    this.activityPorts.forEach(({ id, entry }) => {
      ports.push({ id, node: entry.ref.node, dir: entry.ref.dir, port: entry.ref.port })
    })
    this.sendJson({ op: 'activity', interval_ms: this.activityIntervalMs, ports })
  }

  // --- messages --------------------------------------------------------------------

  private sendJson(message: object): void {
    const socket = this.socket
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(message))
  }

  private setStatus(status: InspectorStatus): void {
    this._status = status
    this.statusListeners.forEach(listener => listener(status))
  }

  private handleText(text: string): void {
    let message: any
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    switch (message.t) {
      case 'activity':
        this.handleActivity(message.p as unknown[][])
        break
      case 'watch_ack': {
        const watch = this.watchesById.get(message.id)
        if (!watch) break
        watch.info = { types: message.types ?? [], shape: message.shape ?? null }
        const info = watch.info
        watch.subscribers.forEach(s => s.callbacks.onInfo?.(info))
        break
      }
      case 'gone': {
        const watch = this.watchesById.get(message.id)
        if (watch) watch.subscribers.forEach(s => s.callbacks.onGone?.())
        break
      }
      case 'status':
        this.engineStatus = {
          state: message.state as InspectorState,
          reasons: message.reasons ?? [],
          lagMs: message.lag_ms,
          intervalScale: message.interval_scale,
        }
        if (!this.hidden) this.setStatus(this.engineStatus)
        break
      case 'hello':
        if (message.protocol !== INSPECTOR_PROTOCOL) {
          this.wanted = false
          this.socket?.close(1000)
          this.setStatus({ state: 'unsupported', reasons: [`protocol ${message.protocol}`] })
          break
        }
        this._hello = { protocol: message.protocol, limits: message.limits ?? {}, plugins: message.plugins ?? [] }
        this.engineStatus = { state: 'ok', reasons: [] }
        this.setStatus(this.hidden ? { state: 'hidden', reasons: [] } : this.engineStatus)
        const hello = this._hello
        this.helloListeners.forEach(listener => listener(hello))
        break
      case 'error': {
        const watch = message.id != null ? this.watchesById.get(message.id) : undefined
        if (watch) watch.subscribers.forEach(s => s.callbacks.onError?.(message.code, message.message))
        break
      }
    }
  }

  private handleActivity(rows: unknown[][]): void {
    const changed = this.changedActivity
    changed.length = 0
    for (let i = 0; i < rows.length; ++i) {
      const row = rows[i]
      const port = this.activityById.get(row[0] as number)
      if (!port) continue
      const entry = port.entry
      entry.count = row[1] as number
      entry.hz = row[2] as number
      entry.age = row[3] as number | null
      entry.dtype = row[4] as string | null
      entry.shape = row[5] as number[] | null
      entry.stats = row[6] as [number, number, number] | null
      entry.last = row[7] as number | string | boolean | null
      changed.push(entry)
    }
    if (changed.length === 0) return
    this.activityListeners.forEach(listener => listener(changed))
  }

  private handleSample(buffer: ArrayBuffer): void {
    if (buffer.byteLength < HEADER_SIZE) return
    const view = new DataView(buffer)
    if (view.getUint8(0) !== FRAME_SAMPLE) return
    const frameSeq = view.getUint32(4)
    // Acknowledge first: the engine sends the next frame only after this.
    this.socket?.send('{"op":"ack","seq":' + frameSeq + '}')

    const watch = this.watchesById.get(view.getUint16(2))
    if (!watch) return
    const sample = watch.sample
    sample.frameSeq = frameSeq
    sample.sampleSeq = view.getUint32(8)
    sample.dispatchCount = view.getUint32(12)
    sample.t = view.getFloat64(16)
    const flags = view.getUint8(24)
    sample.flags = flags
    const slots = view.getUint8(25)
    let offset = HEADER_SIZE
    if (slots === 0) {
      sample.steps = NO_STEPS
    } else {
      const steps: number[][] = new Array(slots)
      for (let s = 0; s < slots; ++s) {
        const n = view.getUint8(offset++)
        const dims: number[] = new Array(n)
        for (let d = 0; d < n; ++d) {
          dims[d] = view.getUint16(offset)
          offset += 2
        }
        steps[s] = dims
      }
      sample.steps = steps
    }
    if (flags & SampleFlag.Truncated) {
      sample.values = null
    } else {
      const [values] = parsePortValuesBytes(view, offset, watch.previous)
      watch.previous = values
      sample.values = values
    }
    const subscribers = watch.subscribers
    for (let i = 0; i < subscribers.length; ++i) subscribers[i].callbacks.onSample(sample)
  }
}
