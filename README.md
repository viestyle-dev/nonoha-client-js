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
