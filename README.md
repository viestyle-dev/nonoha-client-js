# nonoha-client-js

TypeScript client library for [nonoha-engine](https://github.com/viestyle-dev/nonoha-engine).
Pure JavaScript at runtime — no React, no runtime dependencies — so it can
be used from any framework, from plain scripts, or as an IIFE bundle.

## Features

- **GraphClient** — WebSocket connection to a graph endpoint: receive
  decoded port values in real time and send inputs back to the engine
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
- **View SDK** — `defineView`, `createViewHost`, `mountView`: custom
  displays shipped in plugins (`static/views/`) that run in nonoha-editor
  and in any app; built-in views (`builtinViews`)
- **interpretValue** — guesses a presentation (image, grid, plot, number,
  text) from a value's type and shape

## Installation

### As a workspace package (used by nonoha-editor)

This repository is consumed as a git submodule at `packages/nonoha-client-js`
with an npm workspaces setup:

```json
{
  "workspaces": ["packages/*"],
  "dependencies": {
    "nonoha-client-js": "workspace:*"
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
`ws://` / `http://` (a local engine on `127.0.0.1:8000` by default).

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
    { onSample: sample => draw(sample.values) },
  )
  inspector.connect()
  // later: watch.unwatch(); inspector.close()
}
```

Samples carry the latest value (or every row since the last sample with
`batch: 'since'`); they can miss updates, so values an app depends on
should come from `$output` ports through `GraphClient`.

### Views

A view module's default export is a view definition (`{ sdk: 1, id,
inputs, settings, mount(el, ctx) }`, or `defineView({...})` in TypeScript).
Show one in an app:

```typescript
import { fetchPlugins, mountView, pluginViewsBase } from 'nonoha-client-js'

const plugin = (await fetchPlugins(gw)).find(p => p.id === 'user_nodes')
const view = await mountView(`${pluginViewsBase(gw, plugin!)}nagare-stage.js`, element, {
  engineGatewayUrl: gw,
  graphName: 'nagare_core',
  bindings: { energy: 'energy', onsets: 'onsets' },   // view input -> output port
})
// later: view.unmount()
```

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
