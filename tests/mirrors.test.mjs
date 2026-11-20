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

test('解析可选的目标 scope，并拒绝无效或重复的作用域', () => {
  const foo = { name: 'foo', url: 'https://foo.example/' }
  const bar = { name: 'bar', url: 'https://bar.example/' }
  assert.deepEqual(parseMirrors([{ ...foo, scope: ' @foo-bar_2 ' }, { ...bar, scope: '' }]), [
    { ...foo, scope: '@foo-bar_2' }, bar,
  ])
  for (const scope of ['foo', '@foo/bar', '@Foo', '@foo\nbar', null]) {
    assert.throws(() => parseMirrors([{ ...foo, scope }]), /目标 scope/u)
  }
  assert.throws(() => parseMirrors([{ ...foo, scope: '@foo' }, { ...bar, scope: '@foo' }]), /目标 scope 重复/u)
})

test('省略 scope 字段时保留原绑定，显式空值清除绑定并重新检查重复', () => {
  const foo = { name: 'foo', url: 'https://foo.example/' }
  const previous = [{ ...foo, scope: '@foo' }]
  assert.deepEqual(parseMirrors([foo], previous), previous)
  assert.deepEqual(parseMirrors([{ ...foo, scope: '' }], previous), [foo])
  assert.throws(() => parseMirrors([foo, { name: 'bar', url: 'https://bar.example/', scope: '@foo' }], previous), /目标 scope 重复/u)
})

test('移动镜像后保留互相的相对顺序', () => {
  const rows = ['npm', 'npmmirror', 'example']
  assert.deepEqual(moveMirror(rows, 2, 0), ['example', 'npm', 'npmmirror'])
  assert.deepEqual(moveMirror(rows, 0, 2), ['npmmirror', 'example', 'npm'])
  assert.deepEqual(rows, ['npm', 'npmmirror', 'example'])
})
