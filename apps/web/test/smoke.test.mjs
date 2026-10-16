import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

test('web console build exposes the investigation entry point', () => {
  assert.equal(existsSync(new URL('../dist/index.html', import.meta.url)), true)
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
  assert.match(html, /Faultline Lab/)
})
