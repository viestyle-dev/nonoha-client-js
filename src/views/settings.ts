// Setting readers: hosts apply defaults, but values typed by users can still
// be strings or out of range.

export function readNumber(settings: Readonly<Record<string, unknown>>, key: string, fallback: number, min = -Infinity, max = Infinity): number {
  const raw = settings[key]
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN
  if (!isFinite(value)) return fallback
  return value < min ? min : value > max ? max : value
}

export function readBoolean(settings: Readonly<Record<string, unknown>>, key: string, fallback: boolean): boolean {
  const raw = settings[key]
  if (typeof raw === 'boolean') return raw
  if (raw === 'true') return true
  if (raw === 'false') return false
  return fallback
}

export function readString<T extends string>(settings: Readonly<Record<string, unknown>>, key: string, allowed: readonly T[], fallback: T): T {
  const raw = settings[key]
  return typeof raw === 'string' && (allowed as readonly string[]).indexOf(raw) >= 0 ? (raw as T) : fallback
}
