import { PortDataType, PortValue } from './types'

const textDecoder = new TextDecoder()

/**
 * Parse binary port values from a DataView.
 *
 * @param reuseFrom - Optional previous PortValue[] to reuse TypedArray buffers from.
 *   For multi-byte types (Float32, Int16, etc.), if the reuse buffer matches in
 *   dataType and array length, the existing TypedArray is written into instead of
 *   allocating a new one. Zero-copy types (Int8, Uint8, Bool) always return views
 *   into the DataView's underlying buffer regardless of reuseFrom.
 */
export function parsePortValuesBytes(dataView: DataView, offset: number, reuseFrom?: PortValue[]) {
  const values: PortValue[] = []
  const valueCount = dataView.getUint8(offset++)

  for (let i = 0; i < valueCount; ++i) {
    const dataType = dataView.getUint8(offset++)
    const ndim = dataView.getUint8(offset++)

    const shape = new Array(ndim + 1)
    let elementSize = 1
    for (let j = 1; j < ndim + 1; ++j) {
      shape[j] = dataView.getUint16(offset)
      offset += 2
      elementSize *= shape[j]
    }

    const dataSize = dataView.getUint32(offset)
    offset += 4

    // Check if we can reuse a buffer from the previous parse
    const prev = reuseFrom?.[i]

    switch (dataType) {
      case PortDataType.Float32: {
        const length = dataSize / 4
        const value = (prev && prev.dataType === dataType && prev.array.length === length)
          ? prev.array as Float32Array
          : new Float32Array(length)
        for (let j = 0; j < length; ++j) {
          value[j] = dataView.getFloat32(offset + j * 4)
        }
        shape[0] = elementSize ? length / elementSize : 0
        values.push({ dataType, shape, array: value })
        break
      }

      case PortDataType.Float64: {
        const length = dataSize / 8
        const value = (prev && prev.dataType === dataType && prev.array.length === length)
          ? prev.array as Float64Array
          : new Float64Array(length)
        for (let j = 0; j < length; ++j) {
          value[j] = dataView.getFloat64(offset + j * 8)
        }
        shape[0] = elementSize ? length / elementSize : 0
        values.push({ dataType, shape, array: value })
        break
      }

      case PortDataType.Int8: {
        // Zero-copy view: Int8 is single-byte, no endianness concern
        const value = new Int8Array(dataView.buffer, dataView.byteOffset + offset, dataSize)
        shape[0] = elementSize ? value.length / elementSize : 0
        values.push({ dataType, shape, array: value })
        break
      }

      case PortDataType.Uint8:
      case PortDataType.Bool: {
        // Zero-copy view: Uint8 is single-byte, no endianness concern
        const value = new Uint8Array(dataView.buffer, dataView.byteOffset + offset, dataSize)
        shape[0] = elementSize ? value.length / elementSize : 0
        values.push({ dataType, shape, array: value })
        break
      }

      case PortDataType.Int16: {
        const length = dataSize / 2
        const value = (prev && prev.dataType === dataType && prev.array.length === length)
          ? prev.array as Int16Array
          : new Int16Array(length)
        for (let j = 0; j < length; ++j) {
          value[j] = dataView.getInt16(offset + j * 2)
        }
        shape[0] = elementSize ? length / elementSize : 0
        values.push({ dataType, shape, array: value })
        break
      }

      case PortDataType.Uint16: {
        const length = dataSize / 2
        const value = (prev && prev.dataType === dataType && prev.array.length === length)
          ? prev.array as Uint16Array
          : new Uint16Array(length)
        for (let j = 0; j < length; ++j) {
          value[j] = dataView.getUint16(offset + j * 2)
        }
        shape[0] = elementSize ? length / elementSize : 0
        values.push({ dataType, shape, array: value })
        break
      }

      case PortDataType.Int32: {
        const length = dataSize / 4
        const value = (prev && prev.dataType === dataType && prev.array.length === length)
          ? prev.array as Int32Array
          : new Int32Array(length)
        for (let j = 0; j < length; ++j) {
          value[j] = dataView.getInt32(offset + j * 4)
        }
        shape[0] = elementSize ? length / elementSize : 0
        values.push({ dataType, shape, array: value })
        break
      }

      case PortDataType.Uint32: {
        const length = dataSize / 4
        const value = (prev && prev.dataType === dataType && prev.array.length === length)
          ? prev.array as Uint32Array
          : new Uint32Array(length)
        for (let j = 0; j < length; ++j) {
          value[j] = dataView.getUint32(offset + j * 4)
        }
        shape[0] = elementSize ? length / elementSize : 0
        values.push({ dataType, shape, array: value })
        break
      }

      case PortDataType.Int64: {
        const length = dataSize / 8
        const value = (prev && prev.dataType === dataType && prev.array.length === length)
          ? prev.array as BigInt64Array
          : new BigInt64Array(length)
        for (let j = 0; j < length; ++j) {
          value[j] = dataView.getBigInt64(offset + j * 8)
        }
        shape[0] = elementSize ? length / elementSize : 0
        values.push({ dataType, shape, array: value })
        break
      }

      case PortDataType.Uint64: {
        const length = dataSize / 8
        const value = (prev && prev.dataType === dataType && prev.array.length === length)
          ? prev.array as BigUint64Array
          : new BigUint64Array(length)
        for (let j = 0; j < length; ++j) {
          value[j] = dataView.getBigUint64(offset + j * 8)
        }
        shape[0] = elementSize ? length / elementSize : 0
        values.push({ dataType, shape, array: value })
        break
      }

      case PortDataType.String: {
        // Format: each string followed by NULL terminator "A\0B\0"
        // Empty data means empty array
        if (dataSize === 0) {
          shape[0] = 0
          values.push({ dataType, shape, array: [] })
          break
        }
        const stringData = textDecoder.decode(
          new Uint8Array(dataView.buffer, dataView.byteOffset + offset, dataSize)
        )
        // Split by NULL, remove trailing empty from final terminator
        const parts = stringData.split('\0')
        const strings = parts.slice(0, -1)
        shape[0] = elementSize ? strings.length / elementSize : 0
        values.push({ dataType, shape, array: strings })
        break
      }
    }

    offset += dataSize
  }
  return [values, offset] as const
}