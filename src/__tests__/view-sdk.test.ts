import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createViewHost, defineView, inputAccepts, typeAccepts, VIEW_SDK_VERSION } from '../view-sdk'
import { defaultViewTheme } from '../mount-view'
import { PortDataType, PortValue } from '../types'

const value = (n: number): PortValue => ({ dataType: PortDataType.Float32, shape: [1], array: new Float32Array([n]) })

describe('typeAccepts', () => {
  it('matches dtype and dims with ? wildcards', () => {
    expect(typeAccepts('u8[?x?x3]', 'u8[180x320x3]')).toBe(true)
    expect(typeAccepts('u8[?x?x3]', 'u8[180x320]')).toBe(false)
    expect(typeAccepts('u8[?x?]', 'u8[180x320]')).toBe(true)
    expect(typeAccepts('f32[?]', 'f64[?]')).toBe(false)
    expect(typeAccepts('f32[6x8]', 'f32[6x8]')).toBe(true)
    expect(typeAccepts('f32[6x8]', 'f32[?x?]')).toBe(false)
    expect(typeAccepts('f32', 'f32')).toBe(true)
  })

  it('supports any dtype, any rank and any type', () => {
    expect(typeAccepts('any[?]', 'i32[4]')).toBe(true)
    expect(typeAccepts('f32[*]', 'f32[2x3x4]')).toBe(true)
    expect(typeAccepts('any', 'str')).toBe(true)
    expect(inputAccepts({ name: 'x', accepts: ['f32[?]', 'f64[?]'] }, 'f64[512]')).toBe(true)
  })
})

describe('createViewHost', () => {
  let frames: (() => void)[] = []
  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => vi.unstubAllGlobals())

  const element = {} as HTMLElement

  it('feeds values, coalesces frames and applies setting defaults', () => {
    const seen: number[] = []
    let draws = 0
    const view = defineView({
      id: 't',
      inputs: [{ name: 'x', accepts: ['f32'] }],
      settings: { gain: { type: 'number', default: 2 } },
      mount(_el, ctx) {
        ctx.onValues('x', values => {
          seen.push((values[0].array as Float32Array)[0] * (ctx.settings.gain as number))
          ctx.requestFrame(draw)
        })
        function draw() {
          draws++
        }
      },
    })
    expect(view.sdk).toBe(VIEW_SDK_VERSION)
    const host = createViewHost(view, element, { theme: defaultViewTheme(true), size: { width: 10, height: 10 } })
    host.deliver('x', [value(1)])
    host.deliver('x', [value(2)])
    host.deliver('other', [value(3)]) // no listener: ignored
    expect(seen).toEqual([2, 4])
    expect(frames.length).toBe(1)
    frames.shift()!()
    expect(draws).toBe(1)
    host.setSettings({ gain: 10 })
    host.deliver('x', [value(1)])
    expect(seen[2]).toBe(10)
  })

  it('reports view errors instead of throwing, and cleans up on destroy', () => {
    const errors: unknown[] = []
    let destroyed = false
    const view = defineView({
      id: 'bad',
      inputs: [],
      mount(_el, ctx) {
        ctx.onValues('x', () => {
          throw new Error('boom')
        })
        return { destroy: () => (destroyed = true) }
      },
    })
    const host = createViewHost(view, element, {
      theme: defaultViewTheme(false),
      size: { width: 1, height: 1 },
      onError: e => errors.push(e),
    })
    host.deliver('x', [value(1)])
    expect(errors.length).toBe(1)
    host.destroy()
    expect(destroyed).toBe(true)
  })

  it('refuses views built for another SDK version', () => {
    const view = { ...defineView({ id: 'v', inputs: [], mount() {} }), sdk: 99 }
    expect(() => createViewHost(view, element, { theme: defaultViewTheme(), size: { width: 1, height: 1 } })).toThrow(/SDK/)
  })
})
