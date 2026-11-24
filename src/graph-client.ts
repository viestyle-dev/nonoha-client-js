import { PortData, PortDataType, PortValue } from './types'
import { parsePortValuesBytes } from './port-parser'
import { engineFetch, engineWebSocket } from './engine'

type OutputCallback = (output: PortData) => void
type ValuesCallback = (values: PortValue[]) => void
type ClosedCallback = (wasClean: boolean) => void

export interface OutputSubscriptionOptions {
  /**
   * Also the value the port holds now, fetched once: `true` delivers it to
   * the callback like a new value; a function receives it instead (e.g. to
   * set state without acting on it). It is dropped when a new value arrives
   * first, since it would be older.
   */
  current?: boolean | ValuesCallback
  /** The current value could not be fetched. */
  onError?: (error: unknown) => void
}

export class GraphClient {
  readonly engineGatewayUrl: string
  readonly graphName: string

  private endpointSocket: WebSocket | null = null
  private readonly onOutputCallbacks: OutputCallback[] = []
  /** Per output port; lists are replaced on change, so delivery never allocates. */
  private readonly portCallbacks = new Map<string, ValuesCallback[]>()
  private readonly onClosedCallbacks: ClosedCallback[] = []
  private readonly textDecoder = new TextDecoder()
  private readonly textEncoder = new TextEncoder()
  private readonly outputBuffers = new Map<string, PortValue[]>()

  constructor(engineGatewayUrl: string, graphName: string) {
    this.engineGatewayUrl = engineGatewayUrl
    this.graphName = graphName
  }

  // --- WebSocket ---

  connect(): void {
    if (this.endpointSocket) return
    const socket = engineWebSocket(this.engineGatewayUrl, `/node-flow/graphs/${this.graphName}/endpoint/ws`)
    socket.binaryType = "arraybuffer"

    socket.onmessage = (event) => {
      const arrayBuffer = event.data as ArrayBuffer
      const dataView = new DataView(arrayBuffer)
      const eventType = dataView.getUint8(0)

      if (eventType === 0x01) {
        let offset = 1
        const portNameLength = dataView.getUint8(offset++)
        const portName = this.textDecoder.decode(
          new Uint8Array(arrayBuffer, offset, portNameLength)
        )
        offset += portNameLength

        const reuseFrom = this.outputBuffers.get(portName)
        const [values, newOffset] = parsePortValuesBytes(dataView, offset, reuseFrom)
        offset = newOffset
        this.outputBuffers.set(portName, values)

        const portData: PortData = { portName, values }
        for (let i = 0; i < this.onOutputCallbacks.length; ++i) {
          this.onOutputCallbacks[i](portData)
        }
        const callbacks = this.portCallbacks.get(portName)
        if (callbacks) {
          for (let i = 0; i < callbacks.length; ++i) callbacks[i](values)
        }
      }
    }

    socket.onclose = (event) => {
      for (let i = 0; i < this.onClosedCallbacks.length; ++i) {
        this.onClosedCallbacks[i](event.wasClean)
      }
    }

    this.endpointSocket = socket
  }

  close(): void {
    if (!this.endpointSocket) return
    this.endpointSocket.close()
    this.endpointSocket = null
  }

  dispatchInput(input: PortData): void {
    if (!this.endpointSocket) return
    const buffer = this.serializePortData(input)
    this.endpointSocket.send(buffer)
  }

  addOutputCallback(callback: OutputCallback): void {
    this.onOutputCallbacks.push(callback)
  }

  removeOutputCallback(callback: OutputCallback): void {
    const index = this.onOutputCallbacks.indexOf(callback)
    if (index !== -1) {
      this.onOutputCallbacks.splice(index, 1)
    }
  }

  /**
   * Values of one output port. A port sends a value only when the graph
   * dispatches one, so a new subscriber sees nothing until then unless it
   * asks for the `current` value. Values are valid during the call only (the
   * arrays are reused for the port's next value). Returns the function that
   * stops the subscription.
   */
  subscribeOutput(portName: string, callback: ValuesCallback, options: OutputSubscriptionOptions = {}): () => void {
    let active = true
    let live = false
    const deliver: ValuesCallback = values => {
      live = true
      callback(values)
    }
    this.portCallbacks.set(portName, (this.portCallbacks.get(portName) ?? []).concat(deliver))
    const current = options.current
    if (current) {
      this.fetchOutputValues(portName)
        .then(values => {
          if (!active || live || values.length === 0) return
          if (current === true) callback(values)
          else current(values)
        })
        .catch(error => {
          if (active) options.onError?.(error)
        })
    }
    return () => {
      if (!active) return
      active = false
      const list = this.portCallbacks.get(portName)
      if (!list) return
      const rest = list.filter(c => c !== deliver)
      if (rest.length > 0) this.portCallbacks.set(portName, rest)
      else this.portCallbacks.delete(portName)
    }
  }

  addClosedCallback(callback: ClosedCallback): void {
    this.onClosedCallbacks.push(callback)
  }

  // --- REST API ---

  /** The value an output port holds now; [] while it has none (the engine sends an empty body). */
  async fetchOutputValues(portName: string): Promise<PortValue[]> {
    const res = await engineFetch(
      this.engineGatewayUrl,
      `/node-flow/graphs/${encodeURIComponent(this.graphName)}/outputs/${encodeURIComponent(portName)}/values`,
    )
    if (!res.ok) throw new Error(`Failed to fetch output values for '${portName}': ${res.status}`)
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0) return []
    const [values] = parsePortValuesBytes(new DataView(buf), 0)
    return values
  }

  // --- Serialization (private) ---

  private serializePortData(input: PortData): ArrayBuffer {
    // Pre-encode strings during size calculation to avoid encoding twice
    const preEncodedStrings: (Uint8Array[] | undefined)[] = []

    let totalLength =
      1 + // eventType
      1 + // portNameLength
      input.portName.length +
      1 // valueCount

    for (let i = 0; i < input.values.length; i++) {
      const v = input.values[i]
      totalLength += 2 // dataType + ndim
      totalLength += 2 * (v.shape.length - 1) // shape
      totalLength += 4 // dataSize

      switch (v.dataType) {
        case PortDataType.Int8:
        case PortDataType.Uint8:
        case PortDataType.Bool:
          totalLength += v.array.length
          break
        case PortDataType.Int16:
        case PortDataType.Uint16:
          totalLength += 2 * v.array.length
          break
        case PortDataType.Float32:
        case PortDataType.Int32:
        case PortDataType.Uint32:
          totalLength += 4 * v.array.length
          break
        case PortDataType.Float64:
        case PortDataType.Int64:
        case PortDataType.Uint64:
          totalLength += 8 * v.array.length
          break
        case PortDataType.String: {
          const encoded: Uint8Array[] = []
          for (const s of v.array) {
            const enc = this.textEncoder.encode(s)
            encoded.push(enc)
            totalLength += enc.length + 1
          }
          preEncodedStrings[i] = encoded
          break
        }
        default:
          throw new Error('Unsupported data type')
      }
    }

    const buffer = new ArrayBuffer(totalLength)
    const dataView = new DataView(buffer)
    const uint8View = new Uint8Array(buffer)

    let offset = 0
    dataView.setUint8(offset++, 0x00) // eventType

    dataView.setUint8(offset++, input.portName.length)
    for (let i = 0; i < input.portName.length; i++) {
      dataView.setUint8(offset++, input.portName.charCodeAt(i))
    }
    dataView.setUint8(offset++, input.values.length)

    for (let i = 0; i < input.values.length; i++) {
      const value = input.values[i]
      dataView.setUint8(offset++, value.dataType)
      dataView.setUint8(offset++, value.shape.length - 1) // ndim

      for (let j = 1; j < value.shape.length; j++) {
        dataView.setUint16(offset, value.shape[j])
        offset += 2
      }

      switch (value.dataType) {
        case PortDataType.Float32: {
          const len = value.array.length
          dataView.setUint32(offset, len * 4)
          offset += 4
          for (let j = 0; j < len; j++) {
            dataView.setFloat32(offset, value.array[j])
            offset += 4
          }
          break
        }
        case PortDataType.Float64: {
          const len = value.array.length
          dataView.setUint32(offset, len * 8)
          offset += 4
          for (let j = 0; j < len; j++) {
            dataView.setFloat64(offset, value.array[j])
            offset += 8
          }
          break
        }
        case PortDataType.Int8: {
          const len = value.array.length
          dataView.setUint32(offset, len)
          offset += 4
          for (let j = 0; j < len; j++) {
            dataView.setInt8(offset++, value.array[j])
          }
          break
        }
        case PortDataType.Uint8:
        case PortDataType.Bool: {
          const len = value.array.length
          dataView.setUint32(offset, len)
          offset += 4
          uint8View.set(value.array, offset)
          offset += len
          break
        }
        case PortDataType.Int16: {
          const len = value.array.length
          dataView.setUint32(offset, len * 2)
          offset += 4
          for (let j = 0; j < len; j++) {
            dataView.setInt16(offset, value.array[j])
            offset += 2
          }
          break
        }
        case PortDataType.Uint16: {
          const len = value.array.length
          dataView.setUint32(offset, len * 2)
          offset += 4
          for (let j = 0; j < len; j++) {
            dataView.setUint16(offset, value.array[j])
            offset += 2
          }
          break
        }
        case PortDataType.Int32: {
          const len = value.array.length
          dataView.setUint32(offset, len * 4)
          offset += 4
          for (let j = 0; j < len; j++) {
            dataView.setInt32(offset, value.array[j])
            offset += 4
          }
          break
        }
        case PortDataType.Uint32: {
          const len = value.array.length
          dataView.setUint32(offset, len * 4)
          offset += 4
          for (let j = 0; j < len; j++) {
            dataView.setUint32(offset, value.array[j])
            offset += 4
          }
          break
        }
        case PortDataType.Int64: {
          const len = value.array.length
          dataView.setUint32(offset, len * 8)
          offset += 4
          for (let j = 0; j < len; j++) {
            dataView.setBigInt64(offset, value.array[j])
            offset += 8
          }
          break
        }
        case PortDataType.Uint64: {
          const len = value.array.length
          dataView.setUint32(offset, len * 8)
          offset += 4
          for (let j = 0; j < len; j++) {
            dataView.setBigUint64(offset, value.array[j])
            offset += 8
          }
          break
        }
        case PortDataType.String: {
          const encoded = preEncodedStrings[i]!
          let dataSize = 0
          for (const enc of encoded) {
            dataSize += enc.length + 1
          }
          dataView.setUint32(offset, dataSize)
          offset += 4

          for (const enc of encoded) {
            uint8View.set(enc, offset)
            offset += enc.length
            uint8View[offset++] = 0 // NULL terminator
          }
          break
        }
        default:
          throw new Error('Unsupported data type')
      }
    }

    return buffer
  }
}

/** @deprecated Use `new GraphClient(url, name)` instead */
export function makeGraphEndpoint(engineGatewayUrl: string, graphName: string): GraphClient {
  return new GraphClient(engineGatewayUrl, graphName)
}

/** @deprecated Use `GraphClient` instead */
export type GraphEndpoint = GraphClient
