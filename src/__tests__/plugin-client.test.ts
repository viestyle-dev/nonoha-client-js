import { describe, expect, it } from 'vitest'
import { pluginStaticUrl } from '../plugin-client'

describe('pluginStaticUrl', () => {
  const plugin = { static: '/plugins/cv_nodes/static/', rev: 'r 1' }

  it('joins the folder and a relative path, with the revision', () => {
    expect(pluginStaticUrl('h:8000', plugin, 'views/manifest.json')).toBe(
      'http://h:8000/plugins/cv_nodes/static/views/manifest.json?rev=r%201',
    )
    expect(pluginStaticUrl('h:8000', plugin, './views/a b.js')).toBe('http://h:8000/plugins/cv_nodes/static/views/a%20b.js?rev=r%201')
  })

  it('works without a revision or a trailing slash', () => {
    expect(pluginStaticUrl('h', { static: '/p/static', rev: null }, 'x.js')).toBe('http://h/p/static/x.js')
  })

  it('is null for a plugin without a static folder', () => {
    expect(pluginStaticUrl('h', { static: null }, 'x.js')).toBeNull()
  })
})
