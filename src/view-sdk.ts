import type { PortValue } from './types'

/**
 * View SDK: custom displays shipped with plugins (static/views/*.js) and
 * hosted by nonoha-editor (as a node) or by any app (mountView).
 *
 * A view is a plain ES module whose default export is `defineView({...})`.
 * Hosts push port values into it; the view draws into the element it was
 * given. Ports carry plain arrays: a view states which shapes it accepts
 * and decides itself what they mean.
 *
 * ```js
 * import { defineView } from "nonoha-client-js"   // or copy the 10-line helper
 * export default defineView({
 *   id: "level",
 *   inputs: [{ name: "values", accepts: ["f32[?]"] }],
 *   mount(el, ctx) {
 *     const canvas = el.appendChild(document.createElement("canvas"))
 *     let latest = null
 *     ctx.onValues("values", values => { latest = values[0]; ctx.requestFrame(draw) })
 *     function draw() { ... }
 *     return { destroy() { canvas.remove() } }
 *   },
 * })
 * ```
 */

export const VIEW_SDK_VERSION = 1

export interface ViewInputSpec {
  name: string
  /** Accepted value types, nonoha notation with ? for any size, e.g. "u8[?x?x3]", "f32[?]", "any". */
  accepts: string[]
  description?: string
  /** Optional input: the view works without it. */
  optional?: boolean
}

export interface ViewSettingSpec {
  type: 'number' | 'string' | 'boolean'
  default?: number | string | boolean
  enum?: string[]
  description?: string
}

export interface ViewTheme {
  isDark: boolean
  background: string
  surface: string
  text: string
  textMuted: string
  grid: string
  accent: string
  /** Categorical colors for series. */
  series: readonly string[]
  fontFamily: string
}

export interface ViewContext {
  /** Values for one input (latest-first; typed arrays may be reused by the host). */
  onValues(input: string, callback: (values: PortValue[]) => void): () => void
  /** Run `draw` once on the next animation frame (calls within a frame coalesce). */
  requestFrame(draw: () => void): void
  /** Current settings (defaults applied). */
  readonly settings: Readonly<Record<string, unknown>>
  readonly theme: ViewTheme
  readonly size: { readonly width: number; readonly height: number }
  /** Send values to a graph input (only when the host supports it). */
  dispatch?(input: string, values: PortValue[]): void
}

export interface ViewInstance {
  resize?(width: number, height: number): void
  settingsChanged?(settings: Readonly<Record<string, unknown>>): void
  themeChanged?(theme: ViewTheme): void
  destroy?(): void
}

export interface ViewDefinition {
  id: string
  title?: string
  description?: string
  inputs: ViewInputSpec[]
  settings?: Record<string, ViewSettingSpec>
  /** Initial size in px when placed by a host. */
  size?: { width: number; height: number }
  mount(element: HTMLElement, context: ViewContext): ViewInstance | void
}

export interface DefinedView extends ViewDefinition {
  sdk: number
}

export function defineView(definition: ViewDefinition): DefinedView {
  return { sdk: VIEW_SDK_VERSION, ...definition }
}

/** Manifest at <plugin>/static/views/manifest.json (data only, no code). */
export interface ViewManifest {
  sdk: number
  views: (Omit<ViewDefinition, 'mount'> & {
    /** Module path relative to the manifest. */
    module: string
    /** Engine node outputs this view suits, for suggestions. */
    suits?: { node: string; port: string }[]
  })[]
  /** Editor hints for this plugin's ports, e.g. the channel order of images. */
  portHints?: { node: string; port: string; colorOrder?: 'rgb' | 'bgr' }[]
}

// --- type matching ---------------------------------------------------------------------

function parseType(type: string): { dtype: string; dims: string[] } {
  const match = /^([a-z0-9]+)(?:\[(.*)\])?$/.exec(type.trim())
  if (!match) return { dtype: type.trim(), dims: [] }
  return { dtype: match[1], dims: match[2] ? match[2].split('x') : [] }
}

/**
 * Whether a port type (as the engine reports it, e.g. "u8[180x320]",
 * "f32[?x?x2]") is accepted by a pattern ("u8[?x?]", "f32[?]", "any",
 * "f32[*]" for any rank).
 */
export function typeAccepts(pattern: string, portType: string): boolean {
  if (pattern === 'any') return true
  const p = parseType(pattern)
  const t = parseType(portType)
  if (p.dtype !== 'any' && p.dtype !== t.dtype) return false
  if (p.dims.length === 1 && p.dims[0] === '*') return true
  if (p.dims.length !== t.dims.length) return false
  for (let i = 0; i < p.dims.length; ++i) {
    if (p.dims[i] !== '?' && p.dims[i] !== t.dims[i]) return false
  }
  return true
}

export function inputAccepts(input: ViewInputSpec, portType: string): boolean {
  for (let i = 0; i < input.accepts.length; ++i) if (typeAccepts(input.accepts[i], portType)) return true
  return false
}

// --- hosting ---------------------------------------------------------------------------

export interface ViewHost {
  /** Push values for one input. */
  deliver(input: string, values: PortValue[]): void
  resize(width: number, height: number): void
  setSettings(settings: Record<string, unknown>): void
  setTheme(theme: ViewTheme): void
  destroy(): void
}

export interface ViewHostOptions {
  theme: ViewTheme
  settings?: Record<string, unknown>
  size: { width: number; height: number }
  dispatch?: (input: string, values: PortValue[]) => void
  /** Errors thrown by the view (mount, callbacks, draw) end up here. */
  onError?: (error: unknown) => void
}

function withDefaults(view: ViewDefinition, settings: Record<string, unknown> | undefined) {
  const out: Record<string, unknown> = {}
  if (view.settings) for (const key in view.settings) out[key] = view.settings[key].default
  if (settings) for (const key in settings) if (settings[key] !== undefined) out[key] = settings[key]
  return out
}

/** Mount a view into `element`; the host feeds it values and size/theme/settings changes. */
export function createViewHost(view: DefinedView, element: HTMLElement, options: ViewHostOptions): ViewHost {
  if (view.sdk !== VIEW_SDK_VERSION) throw new Error(`view "${view.id}" needs view SDK ${view.sdk}, host has ${VIEW_SDK_VERSION}`)
  const listeners = new Map<string, ((values: PortValue[]) => void)[]>()
  const report = options.onError ?? ((error: unknown) => console.error(`[view ${view.id}]`, error))
  let settings = withDefaults(view, options.settings)
  let theme = options.theme
  const size = { width: options.size.width, height: options.size.height }
  let frame: number | null = null
  const draws: (() => void)[] = []
  let destroyed = false

  const runFrame = () => {
    frame = null
    const pending = draws.splice(0)
    for (let i = 0; i < pending.length; ++i) {
      try {
        pending[i]()
      } catch (error) {
        report(error)
      }
    }
  }

  const context: ViewContext = {
    onValues(input, callback) {
      const list = listeners.get(input) ?? []
      listeners.set(input, list.concat(callback))
      return () => {
        const current = listeners.get(input)
        if (current) listeners.set(input, current.filter(c => c !== callback))
      }
    },
    requestFrame(draw) {
      if (destroyed) return
      if (draws.indexOf(draw) < 0) draws.push(draw)
      if (frame === null) frame = requestAnimationFrame(runFrame)
    },
    get settings() {
      return settings
    },
    get theme() {
      return theme
    },
    get size() {
      return size
    },
    dispatch: options.dispatch,
  }

  let instance: ViewInstance | void
  try {
    instance = view.mount(element, context)
  } catch (error) {
    report(error)
  }

  return {
    deliver(input, values) {
      const list = listeners.get(input)
      if (!list) return
      for (let i = 0; i < list.length; ++i) {
        try {
          list[i](values)
        } catch (error) {
          report(error)
        }
      }
    },
    resize(width, height) {
      if (width === size.width && height === size.height) return
      size.width = width
      size.height = height
      instance?.resize?.(width, height)
    },
    setSettings(next) {
      settings = withDefaults(view, next)
      instance?.settingsChanged?.(settings)
    },
    setTheme(next) {
      theme = next
      instance?.themeChanged?.(next)
    },
    destroy() {
      destroyed = true
      if (frame !== null) cancelAnimationFrame(frame)
      listeners.clear()
      try {
        instance?.destroy?.()
      } catch (error) {
        report(error)
      }
    },
  }
}

// --- loading -------------------------------------------------------------------------------

export interface PluginStaticInfo {
  id: string
  name?: string
  version: string | null
  /** Path served by the engine, e.g. "/plugins/cv_nodes/static/", or null without static files. */
  static: string | null
  rev?: string | null
}

/** Plugins loaded by the engine (GET /node-flow/plugins). */
export async function fetchPlugins(engineGatewayUrl: string): Promise<PluginStaticInfo[]> {
  const res = await fetch(`http://${engineGatewayUrl}/node-flow/plugins`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`plugins: HTTP ${res.status}`)
  return (await res.json()) as PluginStaticInfo[]
}

/** Base URL of a plugin's views folder, cache-busted by the plugin's static revision. */
export function pluginViewsBase(engineGatewayUrl: string, plugin: PluginStaticInfo): string | null {
  if (!plugin.static) return null
  return `http://${engineGatewayUrl}${plugin.static}views/`
}

export async function fetchViewManifest(viewsBase: string, rev?: string | null): Promise<ViewManifest | null> {
  const res = await fetch(`${viewsBase}manifest.json${rev ? `?rev=${rev}` : ''}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`view manifest: HTTP ${res.status}`)
  return (await res.json()) as ViewManifest
}

const moduleCache = new Map<string, Promise<DefinedView>>()

/** Import a view module (default export from defineView). Cached per URL. */
export function loadView(url: string): Promise<DefinedView> {
  let pending = moduleCache.get(url)
  if (!pending) {
    pending = import(/* webpackIgnore: true */ /* @vite-ignore */ url).then((mod: { default?: DefinedView }) => {
      const view = mod.default
      if (!view || typeof view.mount !== 'function') throw new Error(`${url} has no default view export`)
      if (view.sdk !== VIEW_SDK_VERSION) throw new Error(`${url} needs view SDK ${view.sdk}; this host has ${VIEW_SDK_VERSION}`)
      return view
    })
    pending.catch(() => moduleCache.delete(url))
    moduleCache.set(url, pending)
  }
  return pending
}
