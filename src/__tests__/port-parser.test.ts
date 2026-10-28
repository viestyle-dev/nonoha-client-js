import { describe, it, expect } from 'vitest'
import { parsePortValuesBytes } from '../port-parser'
import { PortDataType, PortValue } from '../types'

// --- Helper: build binary port values message ---

interface PortValueSpec {
  dataType: number
  /** Dimensions excluding batch (shape[1..n]) */
  dims: number[]
  /** Raw data bytes (already in big-endian for multi-byte types) */
  data: ArrayBuffer
}

/**
 * Build a binary message containing port values in the engine's wire format.
 * Returns an ArrayBuffer that parsePortValuesBytes can parse.
 */
function buildPortValuesBytes(specs: PortValueSpec[]): ArrayBuffer {
  // Calculate total size
  let totalSize = 1 // valueCount
  for (const spec of specs) {
    totalSize += 1 // dataType
    totalSize += 1 // ndim
    totalSize += 2 * spec.dims.length // shape dimensions (uint16 each)
    totalSize += 4 // dataSize
    totalSize += spec.data.byteLength // actual data
  }

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  let offset = 0

  view.setUint8(offset++, specs.length) // valueCount

  for (const spec of specs) {
    view.setUint8(offset++, spec.dataType)
    view.setUint8(offset++, spec.dims.length) // ndim

    for (const dim of spec.dims) {
      view.setUint16(offset, dim) // big-endian by default in DataView
      offset += 2
    }

    view.setUint32(offset, spec.data.byteLength) // dataSize
    offset += 4

    // Copy raw data
    new Uint8Array(buffer, offset, spec.data.byteLength).set(
      new Uint8Array(spec.data)
    )
    offset += spec.data.byteLength
  }

  return buffer
}

/** Build Float32 data in big-endian (DataView default) */
function float32Data(values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(values.length * 4)
  const dv = new DataView(buf)
  for (let i = 0; i < values.length; i++) {
    dv.setFloat32(i * 4, values[i])
  }
  return buf
}

/** Build Float64 data in big-endian */
function float64Data(values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(values.length * 8)
  const dv = new DataView(buf)
  for (let i = 0; i < values.length; i++) {
    dv.setFloat64(i * 8, values[i])
  }
  return buf
}

/** Build Int16 data in big-endian */
function int16Data(values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(values.length * 2)
  const dv = new DataView(buf)
  for (let i = 0; i < values.length; i++) {
    dv.setInt16(i * 2, values[i])
  }
  return buf
}

/** Build Uint16 data in big-endian */
function uint16Data(values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(values.length * 2)
  const dv = new DataView(buf)
  for (let i = 0; i < values.length; i++) {
    dv.setUint16(i * 2, values[i])
  }
  return buf
}

/** Build Int32 data in big-endian */
function int32Data(values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(values.length * 4)
  const dv = new DataView(buf)
  for (let i = 0; i < values.length; i++) {
    dv.setInt32(i * 4, values[i])
  }
  return buf
}

/** Build Uint32 data in big-endian */
function uint32Data(values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(values.length * 4)
  const dv = new DataView(buf)
  for (let i = 0; i < values.length; i++) {
    dv.setUint32(i * 4, values[i])
  }
  return buf
}

/** Build null-terminated string data */
function stringData(values: string[]): ArrayBuffer {
  const encoder = new TextEncoder()
  const parts = values.map(s => encoder.encode(s))
  const totalSize = parts.reduce((sum, p) => sum + p.length + 1, 0)
  const buf = new ArrayBuffer(totalSize)
  const u8 = new Uint8Array(buf)
  let offset = 0
  for (const part of parts) {
    u8.set(part, offset)
    offset += part.length
    u8[offset++] = 0 // NULL terminator
  }
  return buf
}

// --- Tests ---

describe('parsePortValuesBytes', () => {
  describe('data types', () => {
    it('parses Float32 scalar (ndim=0)', () => {
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Float32, dims: [], data: float32Data([3.14]) },
      ])
      const [values, offset] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values).toHaveLength(1)
      expect(values[0].dataType).toBe(PortDataType.Float32)
      expect(values[0].shape).toEqual([1])
      expect(values[0].array).toBeInstanceOf(Float32Array)
      expect((values[0].array as Float32Array)[0]).toBeCloseTo(3.14, 5)
      expect(offset).toBe(buf.byteLength)
    })

    it('parses Float64 vector (ndim=1)', () => {
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Float64, dims: [3], data: float64Data([1.1, 2.2, 3.3]) },
      ])
      const [values] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values[0].dataType).toBe(PortDataType.Float64)
      expect(values[0].shape).toEqual([1, 3])
      expect(values[0].array).toBeInstanceOf(Float64Array)
      expect(Array.from(values[0].array as Float64Array)).toEqual([1.1, 2.2, 3.3])
    })

    it('parses Int8 (zero-copy view)', () => {
      const raw = new Int8Array([10, -20, 30]).buffer
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Int8, dims: [], data: raw },
      ])
      const [values] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values[0].dataType).toBe(PortDataType.Int8)
      expect(values[0].array).toBeInstanceOf(Int8Array)
      expect(Array.from(values[0].array as Int8Array)).toEqual([10, -20, 30])
      // Zero-copy: array should share the same buffer
      expect((values[0].array as Int8Array).buffer).toBe(buf)
    })

    it('parses Uint8 (zero-copy view)', () => {
      const raw = new Uint8Array([0, 128, 255]).buffer
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Uint8, dims: [], data: raw },
      ])
      const [values] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values[0].dataType).toBe(PortDataType.Uint8)
      expect(Array.from(values[0].array as Uint8Array)).toEqual([0, 128, 255])
      expect((values[0].array as Uint8Array).buffer).toBe(buf)
    })

    it('parses Bool (zero-copy view, same as Uint8)', () => {
      const raw = new Uint8Array([1, 0, 1]).buffer
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Bool, dims: [], data: raw },
      ])
      const [values] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values[0].dataType).toBe(PortDataType.Bool)
      expect(Array.from(values[0].array as Uint8Array)).toEqual([1, 0, 1])
    })

    it('parses Int16', () => {
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Int16, dims: [], data: int16Data([-1000, 2000]) },
      ])
      const [values] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values[0].dataType).toBe(PortDataType.Int16)
      expect(Array.from(values[0].array as Int16Array)).toEqual([-1000, 2000])
    })

    it('parses Uint16', () => {
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Uint16, dims: [], data: uint16Data([0, 65535]) },
      ])
      const [values] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values[0].dataType).toBe(PortDataType.Uint16)
      expect(Array.from(values[0].array as Uint16Array)).toEqual([0, 65535])
    })

    it('parses Int32', () => {
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Int32, dims: [], data: int32Data([-100000, 100000]) },
      ])
      const [values] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values[0].dataType).toBe(PortDataType.Int32)
      expect(Array.from(values[0].array as Int32Array)).toEqual([-100000, 100000])
    })

    it('parses Uint32', () => {
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Uint32, dims: [], data: uint32Data([0, 4294967295]) },
      ])
      const [values] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values[0].dataType).toBe(PortDataType.Uint32)
      expect(Array.from(values[0].array as Uint32Array)).toEqual([0, 4294967295])
    })

    it('parses String', () => {
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.String, dims: [], data: stringData(["hello", "world"]) },
      ])
      const [values] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values[0].dataType).toBe(PortDataType.String)
      expect(values[0].array).toEqual(["hello", "world"])
    })

    it('parses empty String (dataSize=0)', () => {
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.String, dims: [], data: new ArrayBuffer(0) },
      ])
      const [values] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values[0].dataType).toBe(PortDataType.String)
      expect(values[0].array).toEqual([])
      expect(values[0].shape[0]).toBe(0)
    })
  })

  describe('shape and batch dimension', () => {
    it('scalar (ndim=0): shape = [count]', () => {
      // 3 Float32 scalars in one batch
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Float32, dims: [], data: float32Data([1, 2, 3]) },
      ])
      const [values] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values[0].shape).toEqual([3])
    })

    it('vector (ndim=1, dim=4): shape = [batch, 4]', () => {
      // 2 batches of 4 Float32 elements = 8 total
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Float32, dims: [4], data: float32Data([1, 2, 3, 4, 5, 6, 7, 8]) },
      ])
      const [values] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values[0].shape).toEqual([2, 4])
    })

    it('matrix (ndim=2, dims=[2,3]): shape = [batch, 2, 3]', () => {
      // 1 batch of 2x3 = 6 elements
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Float32, dims: [2, 3], data: float32Data([1, 2, 3, 4, 5, 6]) },
      ])
      const [values] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values[0].shape).toEqual([1, 2, 3])
    })
  })

  describe('multiple values', () => {
    it('parses multiple values of different types', () => {
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Float32, dims: [], data: float32Data([1.0]) },
        { dataType: PortDataType.Int8, dims: [], data: new Int8Array([42]).buffer },
        { dataType: PortDataType.String, dims: [], data: stringData(["test"]) },
      ])
      const [values, offset] = parsePortValuesBytes(new DataView(buf), 0)
      expect(values).toHaveLength(3)
      expect(values[0].dataType).toBe(PortDataType.Float32)
      expect(values[1].dataType).toBe(PortDataType.Int8)
      expect(values[2].dataType).toBe(PortDataType.String)
      expect(offset).toBe(buf.byteLength)
    })
  })

  describe('offset handling', () => {
    it('returns correct offset after parsing', () => {
      const buf = buildPortValuesBytes([
        { dataType: PortDataType.Float32, dims: [], data: float32Data([1.0, 2.0]) },
      ])
      const [, offset] = parsePortValuesBytes(new DataView(buf), 0)
      expect(offset).toBe(buf.byteLength)
    })

    it('respects initial offset', () => {
      // Prepend 5 bytes of padding
      const inner = buildPortValuesBytes([
        { dataType: PortDataType.Float32, dims: [], data: float32Data([42.0]) },
      ])
      const padded = new ArrayBuffer(5 + inner.byteLength)
      new Uint8Array(padded, 5).set(new Uint8Array(inner))

      const [values, offset] = parsePortValuesBytes(new DataView(padded), 5)
      expect(values).toHaveLength(1)
      expect((values[0].array as Float32Array)[0]).toBeCloseTo(42.0)
      expect(offset).toBe(padded.byteLength)
    })
  })

  describe('buffer reuse', () => {
    it('reuses Float32 buffer when type and length match', () => {
      const buf1 = buildPortValuesBytes([
        { dataType: PortDataType.Float32, dims: [3], data: float32Data([1, 2, 3]) },
      ])
      const [values1] = parsePortValuesBytes(new DataView(buf1), 0)
      const originalArray = values1[0].array

      const buf2 = buildPortValuesBytes([
        { dataType: PortDataType.Float32, dims: [3], data: float32Data([4, 5, 6]) },
      ])
      const [values2] = parsePortValuesBytes(new DataView(buf2), 0, values1)

      // Same buffer instance reused
      expect(values2[0].array).toBe(originalArray)
      // But with new data
      expect(Array.from(values2[0].array as Float32Array)).toEqual([4, 5, 6])
    })

    it('allocates new buffer when length differs', () => {
      const buf1 = buildPortValuesBytes([
        { dataType: PortDataType.Float32, dims: [3], data: float32Data([1, 2, 3]) },
      ])
      const [values1] = parsePortValuesBytes(new DataView(buf1), 0)
      const originalArray = values1[0].array

      const buf2 = buildPortValuesBytes([
        { dataType: PortDataType.Float32, dims: [2], data: float32Data([4, 5]) },
      ])
      const [values2] = parsePortValuesBytes(new DataView(buf2), 0, values1)

      // Different buffer (length changed)
      expect(values2[0].array).not.toBe(originalArray)
      expect(Array.from(values2[0].array as Float32Array)).toEqual([4, 5])
    })

    it('allocates new buffer when type differs', () => {
      const buf1 = buildPortValuesBytes([
        { dataType: PortDataType.Float32, dims: [], data: float32Data([1, 2]) },
      ])
      const [values1] = parsePortValuesBytes(new DataView(buf1), 0)

      // Same byte count but different type
      const buf2 = buildPortValuesBytes([
        { dataType: PortDataType.Int32, dims: [], data: int32Data([3, 4]) },
      ])
      const [values2] = parsePortValuesBytes(new DataView(buf2), 0, values1)

      expect(values2[0].array).not.toBe(values1[0].array)
      expect(values2[0].dataType).toBe(PortDataType.Int32)
    })

    it('does NOT reuse for zero-copy types (Int8/Uint8) — always returns view', () => {
      const raw1 = new Uint8Array([1, 2, 3]).buffer
      const buf1 = buildPortValuesBytes([
        { dataType: PortDataType.Uint8, dims: [], data: raw1 },
      ])
      const [values1] = parsePortValuesBytes(new DataView(buf1), 0)

      const raw2 = new Uint8Array([4, 5, 6]).buffer
      const buf2 = buildPortValuesBytes([
        { dataType: PortDataType.Uint8, dims: [], data: raw2 },
      ])
      const [values2] = parsePortValuesBytes(new DataView(buf2), 0, values1)

      // Different buffer (zero-copy view into new message buffer)
      expect(values2[0].array).not.toBe(values1[0].array)
      expect((values2[0].array as Uint8Array).buffer).toBe(buf2)
    })

    it('reuses Int16 buffer', () => {
      const buf1 = buildPortValuesBytes([
        { dataType: PortDataType.Int16, dims: [], data: int16Data([100, 200]) },
      ])
      const [values1] = parsePortValuesBytes(new DataView(buf1), 0)
      const originalArray = values1[0].array

      const buf2 = buildPortValuesBytes([
        { dataType: PortDataType.Int16, dims: [], data: int16Data([300, 400]) },
      ])
      const [values2] = parsePortValuesBytes(new DataView(buf2), 0, values1)

      expect(values2[0].array).toBe(originalArray)
      expect(Array.from(values2[0].array as Int16Array)).toEqual([300, 400])
    })
  })
})
