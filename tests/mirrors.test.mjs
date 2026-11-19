import assert from 'node:assert/strict'
import test from 'node:test'
import { moveMirror, normalizeUrl, parseMirrors } from '../lib/mirrors.js'

test('统一主机名和尾斜杠，保留 Nexus 路径', () => {
  assert.equal(normalizeUrl(' https://EXAMPLE.ORG/repository/npm '), 'https://example.org/repository/npm/')
})

test('拒绝凭证、片段、查询、非 HTTP 来源以及规范化后重复的 URL', () => {
  for (const url of ['https://foo:bar@example.org', 'https://example.org#x', 'https://example.org?x=1', 'file:///tmp']) {
    assert.throws(() => normalizeUrl(url))
  }
  assert.throws(() => parseMirrors([
    { name: 'one', url: 'https://EXAMPLE.ORG/mirror' },
    { name: 'two', url: 'https://example.org/mirror/' },
  ]), /重复/u)
})

test('移动镜像后保留互相的相对顺序', () => {
  const rows = ['npm', 'npmmirror', 'example']
  assert.deepEqual(moveMirror(rows, 2, 0), ['example', 'npm', 'npmmirror'])
  assert.deepEqual(moveMirror(rows, 0, 2), ['npmmirror', 'example', 'npm'])
  assert.deepEqual(rows, ['npm', 'npmmirror', 'example'])
})
