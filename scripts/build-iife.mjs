// Builds dist/nonoha-client.iife.js (global NonohaClient) for apps without a
// bundler. The banner names the version, so a copy in an app shows its age.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'NonohaClient',
  outfile: 'dist/nonoha-client.iife.js',
  target: 'es2020',
  banner: { js: `/*! ${pkg.name} ${pkg.version} | Apache-2.0 */` },
})
