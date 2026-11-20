import assert from 'node:assert/strict'
import test from 'node:test'
import { credentialScope, parseMirrorUpdates, readNpmrc, updateNpmrc } from '../lib/credentials.js'

const first = { name: 'foo', url: 'https://registry.example.org/repository/foo/' }
const second = { name: 'bar', url: 'https://registry.example.org/repository/bar/' }
const bearer = { kind: 'bearer', token: 'example-token' }
const basic = { kind: 'basic', username: 'foo', password: 'bar:baz' }

test('认证区块保留原始 .npmrc 内容和仓库路径，并按 npm 格式编码 Basic 凭证', () => {
  const original = '\uFEFFregistry=https://registry.npmjs.org/\r\n\r\n[example]\r\nvalue=foo'
  const changes = parseMirrorUpdates([{ ...first, credential: bearer }, { ...second, credential: basic }])
  const written = updateNpmrc(readNpmrc(original), [], changes)
  const result = readNpmrc(written)
  assert.equal(result.bom + result.rest, original)
  assert.equal(result.eol, '\r\n')
  assert.deepEqual(result.credentials.get(credentialScope(first.url)), { kind: 'bearer', value: bearer.token })
  const storedBasic = result.credentials.get(credentialScope(second.url))
  assert.equal(storedBasic?.kind, 'basic')
  assert.equal(Buffer.from(storedBasic?.value, 'base64').toString(), 'foo:bar:baz')
  assert.ok(written.includes(`${credentialScope(second.url)}:_authToken=\r\n`))
})

test('变更仓库地址、移除镜像或清除凭证都不会把原凭证写到其他地址', () => {
  const prior = parseMirrorUpdates([{ ...first, credential: bearer }, { ...second, credential: basic }])
  const npmrc = readNpmrc(updateNpmrc(readNpmrc(undefined), [], prior))
  const renamed = { ...first, name: 'example' }
  const reordered = updateNpmrc(npmrc, prior, parseMirrorUpdates([second, renamed]))
  assert.deepEqual(readNpmrc(reordered).credentials, npmrc.credentials)
  const moved = { ...first, url: first.url.replace('https:', 'http:') }
  assert.equal(updateNpmrc(npmrc, prior, parseMirrorUpdates([moved, { ...second, credential: null }])), '')
  assert.equal(updateNpmrc(npmrc, prior, parseMirrorUpdates([{ ...second, credential: null }])), '')
})

test('拒绝注入 .npmrc 行、使用已有手动凭证的范围和认证范围冲突', () => {
  assert.throws(() => parseMirrorUpdates([{ ...first, credential: { ...bearer, token: 'foo\nregistry=https://example.org/' } }]))
  assert.throws(() => parseMirrorUpdates([{ ...first, credential: { ...basic, username: 'foo:bar' } }]))
  const changes = parseMirrorUpdates([{ ...first, credential: basic }])
  for (const scope of [credentialScope(first.url), credentialScope(first.url).slice(0, -1)]) {
    const manual = readNpmrc(`${scope}:_authToken=example-token\n`)
    assert.throws(() => updateNpmrc(manual, [first], changes), /手动/u)
  }
  const collision = { ...first, url: first.url.replace('https:', 'http:') }
  const conflicting = parseMirrorUpdates([{ ...first, credential: basic }, collision])
  assert.throws(() => updateNpmrc(readNpmrc(undefined), [], conflicting), /共用/u)
})
