# nonoha-client-js

TypeScript client library for [nonoha-engine](https://github.com/viestyle-dev/nonoha-engine).
Pure JavaScript at runtime — no React, no runtime dependencies — so it can
be used from any framework, from plain scripts, or as an IIFE bundle.

## Features

- **GraphClient** — WebSocket connection to a graph endpoint: receive
  decoded port values in real time and send inputs back to the engine;
  `subscribeOutput` follows one output port, optionally starting from the
  value it holds now (outputs are sent only when they change)
- **Binary protocol parser** — `parsePortValuesBytes` decodes the
  engine's binary port-value format into typed arrays
- **DataClient** — REST client for the engine's data storage API
  (browse, download, upload with resumable chunks)
- **Typed port values** — `PortDataType` and `PortValue` definitions
  matching the engine's port system
- **InspectorClient** — samples ports without changing the graph
  (engine 1.1+): activity statistics for many ports, latest-value
  watches merged per port, automatic acknowledgement, pause while the page
  is hidden, reconnect with backoff
- **Engine capabilities** — `fetchEngineCapabilities`: what the engine
  offers (inspector, plugin static files, environment values; engine 1.1+)
- **Plugin list** — `fetchPlugins`: the plugins the engine loaded;
  `pluginStaticUrl` gives the URL of a file in a plugin's static folder,
  cache-busted by its revision (engine 1.1+)

## Installation

### As a workspace package

Add this repository to an npm workspace (e.g. as a git submodule under
`packages/`) and depend on it by name:

```json
{
  "workspaces": ["packages/*"],
  "dependencies": {
    "nonoha-client-js": "*"
  }
}
```

For Next.js projects, add the package to `transpilePackages` in
`next.config.mjs`:

```javascript
const nextConfig = {
  transpilePackages: ['nonoha-client-js'],
};
```

### Standalone

```bash
git clone https://github.com/viestyle-dev/nonoha-client-js.git
cd nonoha-client-js
npm ci
npm run build        # ESM + type declarations in dist/
npm run build:iife   # dist/nonoha-client.iife.js (global: NonohaClient)
```

The IIFE bundle can be loaded with a plain `<script>` tag for custom
web apps served by the engine.

## Usage

```typescript
import { GraphClient, graphDataClient } from 'nonoha-client-js'

// Connect to a running engine's graph endpoint
const client = new GraphClient('127.0.0.1:8000', 'my_graph')
client.addOutputCallback((portData) => {
  console.log(portData.portName, portData.values)
})
client.connect()

// Browse the graph's data storage over the REST API
const data = graphDataClient('127.0.0.1:8000', 'my_graph')
```

The engine gateway URL is a host:port string; connections use
`ws://` / `http://` (a local engine on `127.0.0.1:8000` by default). An
engine behind a TLS front is given as a full origin (`https://host`), or
reached the way the page itself was, when the gateway is the page's host.
Requests of your own get the same bases from `httpBase(gateway)` and
`wsBase(gateway)`.

### Inspecting ports (engine 1.1+)

```typescript
import { fetchEngineCapabilities, InspectorClient } from 'nonoha-client-js'

const caps = await fetchEngineCapabilities('127.0.0.1:8000')   // null for engine 1.0
if (caps?.inspector?.enabled) {
  const inspector = new InspectorClient('127.0.0.1:8000', 'my_graph', { clientName: 'my-app/1.0' })
  inspector.setActivityPorts([{ node: 'MotionGrid_1', dir: 'out', port: 'energy' }])
  inspector.onActivity(changed => changed.forEach(e => console.log(e.ref.port, e.hz, e.stats)))
  const watch = inspector.watch(
    { node: 'Resize_1', dir: 'out', port: 'dst' },
    { intervalMs: 100, maxBytes: 256 * 1024, autoStride: [0, 1] },   // stride H and W to fit
    { onSample: sample => draw(sample.values), onError: (code, message) => console.warn(code, message) },
  )
  inspector.connect()
  // later: watch.unwatch(); inspector.close()
}
```

Samples carry the latest value (or every item since the last sample with
`batch: 'since'`); they can miss updates, so values an app depends on
should come from `$output` ports through `GraphClient`.

What a watch samples (`WatchOptions`). A port value's first axis is its
batch: a dispatch carries one item (an image, `(1, H, W, 3)`) or many (an
audio block, `(512, channels)`).

| Option | Meaning |
|---|---|
| `batch` | `'last'` item (default), `'all'` items of the latest dispatch, the last N items, or `'since'`: every item since the last sample (`SampleFlag.Gap` when some were lost) |
| `maxBytes` | One sample's data, every slot together (default 256 KiB, at most 4 MiB) |
| `autoStride` | Non-batch dimensions that may be strided when one item does not fit, e.g. `[0, 1]` for an image's height and width |
| `slice`, `cast` | Per non-batch dimension `[start, stop, step]`; `'f32'` / `'f64'` (complex values come as their magnitude) |
| `intervalMs` | Minimum time between samples (the engine stretches it when sampling takes too much CPU) |

Fitting `maxBytes`: too many items, the newest that fit are kept; one item
too large, the `autoStride` dimensions are strided by one step for every
slot (`sample.steps`; a dimension never exceeds 65535); still too large,
nothing is sent and `onError('too_large', …)` reports it once, until a
sample fits again. `sample.t` is when the sampled dispatch was taken.

## Development

```bash
npm ci
npm run dev    # TypeScript compiler in watch mode
npm test       # vitest
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests require signing
the [CLA](CLA.md) (a bot will guide you on your first PR).

## License

[Apache-2.0](LICENSE). See also [NOTICE](NOTICE).
