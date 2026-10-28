// Port data types and interfaces
export enum PortDataType {
  Bool = 0,
  Int8 = 1,
  Uint8 = 2,
  Int16 = 3,
  Uint16 = 4,
  Int32 = 5,
  Uint32 = 6,
  Int64 = 7,
  Uint64 = 8,
  Float32 = 9,
  Float64 = 10,
  Complex64 = 11,
  Complex128 = 12,
  String = 13,
  Any = 14,
}

export const nameToPortDataType: { [key: string]: PortDataType } = {
  bool: PortDataType.Bool,
  i8: PortDataType.Int8,
  u8: PortDataType.Uint8,
  i16: PortDataType.Int16,
  u16: PortDataType.Uint16,
  i32: PortDataType.Int32,
  u32: PortDataType.Uint32,
  i64: PortDataType.Int64,
  u64: PortDataType.Uint64,
  f32: PortDataType.Float32,
  f64: PortDataType.Float64,
  c64: PortDataType.Complex64,
  c128: PortDataType.Complex128,
  str: PortDataType.String,
  any: PortDataType.Any,
}

export type BoolPortValue = {
  dataType: PortDataType.Bool
  shape: number[]
  array: Uint8Array
}

export type Int8PortValue = {
  dataType: PortDataType.Int8
  shape: number[]
  array: Int8Array
}

export type Uint8PortValue = {
  dataType: PortDataType.Uint8
  shape: number[]
  array: Uint8Array
}

export type Int16PortValue = {
  dataType: PortDataType.Int16
  shape: number[]
  array: Int16Array
}

export type Uint16PortValue = {
  dataType: PortDataType.Uint16
  shape: number[]
  array: Uint16Array
}

export type Int32PortValue = {
  dataType: PortDataType.Int32
  shape: number[]
  array: Int32Array
}

export type Uint32PortValue = {
  dataType: PortDataType.Uint32
  shape: number[]
  array: Uint32Array
}

export type Int64PortValue = {
  dataType: PortDataType.Int64
  shape: number[]
  array: BigInt64Array
}

export type Uint64PortValue = {
  dataType: PortDataType.Uint64
  shape: number[]
  array: BigUint64Array
}

export type Float32PortValue = {
  dataType: PortDataType.Float32
  shape: number[]
  array: Float32Array
}

export type Float64PortValue = {
  dataType: PortDataType.Float64
  shape: number[]
  array: Float64Array
}

export type StringPortValue = {
  dataType: PortDataType.String
  shape: number[]
  array: string[]
}

export type PortValue =
  | BoolPortValue
  | Int8PortValue
  | Uint8PortValue
  | Int16PortValue
  | Uint16PortValue
  | Int32PortValue
  | Uint32PortValue
  | Int64PortValue
  | Uint64PortValue
  | Float32PortValue
  | Float64PortValue
  | StringPortValue

export type PortData = {
  portName: string
  values: PortValue[]
}