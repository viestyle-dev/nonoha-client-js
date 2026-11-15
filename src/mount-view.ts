import { GraphClient } from './graph-client'
import { InspectorClient, InspectorPortRef, WatchHandle, WatchOptions } from './inspector-client'
import type { PortData, PortValue } from './types'
import { createViewHost, DefinedView, loadView, ViewHost, ViewTheme } from './view-sdk'

/** Theme for hosts without a design system of their own (apps). */
export function defaultViewTheme(isDark = true): ViewTheme {
  return isDark
    ? {
        isDark,
        background: '#111318',
        surface: '#1d2024',
        text: '#e2e2e9',
        textMuted: '#c4c6d0',
        grid: '#44474e',
        accent: '#b2c5ff',
        series: ['#7cb7ff', '#ffb870', '#7ad7a8', '#f48fb1', '#c5a3ff', '#ffe082', '#80deea', '#bcaaa4'],
        fontFamily: 'system-ui, sans-serif',
      }
    : {
        isDark,
        background: '#ffffff',
        surface: '#f3f3fa',
        text: '#1a1b20',
        textMuted: '#44474e',
        grid: '#c4c6d0',
        accent: '#3450c3',
        series: ['#1565c0', '#e65100', '#2e7d32', '#ad1457', '#6a1b9a', '#f9a825', '#00838f', '#5d4037'],
        fontFamily: 'system-ui, sans-serif',
      }
}

/** Where an input's values come from: a graph output port, or an internal port via the inspector. */
export type ViewBinding = string | (InspectorPortRef & { watch?: WatchOptions })

export interface MountViewOptions {
  engineGatewayUrl: string
  graphName: string
  /** input name -> output port name (all values) or inspector port (sampled). */
  bindings: Record<string, ViewBinding>
  settings?: Record<string, unknown>
  theme?: ViewTheme
  /** Reuse the app's GraphClient (otherwise one is created and closed with the view). */
  graphClient?: GraphClient
  onError?: (error: unknown) => void
}

export interface MountedView {
  host: ViewHost
  unmount(): void
}

/**
 * Show a view (module URL or definition) in `element`, fed from a graph:
 * the same views the editor shows, in a custom app (e.g. a full-screen
 * /app page). The view follows the element's size.
 */
export async function mountView(
  view: string | DefinedView,
  element: HTMLElement,
  options: MountViewOptions,
): Promise<MountedView> {
  const definition = typeof view === 'string' ? await loadView(view) : view
  const rect = element.getBoundingClientRect()
  const ownsGraph = !options.graphClient
  const graph = options.graphClient ?? new GraphClient(options.engineGatewayUrl, options.graphName)
  const host = createViewHost(definition, element, {
    theme: options.theme ?? defaultViewTheme(true),
    settings: options.settings,
    size: { width: rect.width, height: rect.height },
    dispatch: (input, values: PortValue[]) => graph.dispatchInput({ portName: input, values }),
    onError: options.onError,
  })

  // Output ports: one callback, routed by port name.
  const byPort = new Map<string, string[]>()
  const watches: WatchHandle[] = []
  let inspector: InspectorClient | null = null
  for (const input in options.bindings) {
    const binding = options.bindings[input]
    if (typeof binding === 'string') {
      byPort.set(binding, (byPort.get(binding) ?? []).concat(input))
    } else {
      if (!inspector) {
        inspector = new InspectorClient(options.engineGatewayUrl, options.graphName, { clientName: 'nonoha-view' })
        inspector.connect()
      }
      const { watch, ...ref } = binding
      watches.push(
        inspector.watch(ref, watch ?? { intervalMs: 100, batch: 'last' }, {
          onSample: sample => {
            if (sample.values) host.deliver(input, sample.values)
          },
        }),
      )
    }
  }
  const onOutput = (output: PortData) => {
    const inputs = byPort.get(output.portName)
    if (!inputs) return
    for (let i = 0; i < inputs.length; ++i) host.deliver(inputs[i], output.values)
  }
  if (byPort.size > 0) {
    graph.addOutputCallback(onOutput)
    if (ownsGraph) graph.connect()
    // Show the current value right away (outputs only arrive on change).
    byPort.forEach((inputs, port) => {
      graph
        .fetchOutputValues(port)
        .then(values => inputs.forEach(input => host.deliver(input, values)))
        .catch(() => {})
    })
  }

  const observer =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(entries => {
          const box = entries[entries.length - 1].contentRect
          host.resize(box.width, box.height)
        })
      : null
  observer?.observe(element)

  return {
    host,
    unmount() {
      observer?.disconnect()
      graph.removeOutputCallback(onOutput)
      if (ownsGraph) graph.close()
      watches.forEach(w => w.unwatch())
      inspector?.close()
      host.destroy()
    },
  }
}
