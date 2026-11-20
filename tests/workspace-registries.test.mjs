import assert from 'node:assert/strict'
import test from 'node:test'
import { parse } from 'yaml'
import { restoreWorkspaceRegistries, updateWorkspaceRegistries } from '../lib/workspace-registries.js'

const foo = { name: 'foo', scope: '@foo', url: 'https://foo.example/repository/npm/' }
const bar = { name: 'bar', scope: '@bar', url: 'https://bar.example/' }

test('为缺少工作区配置或映射的 profile 创建作用域映射', () => {
  for (const text of [undefined, '---\n', 'null\n', 'registries:\n']) {
    assert.deepEqual(parse(updateWorkspaceRegistries(text, [], [foo])), {
      registries: { '@foo': foo.url },
    })
  }
})

test('写入作用域映射时保留工作区和手动仓库设置、注释及换行格式', () => {
  const original = '\uFEFF# workspace\r\npackages: []\r\nallowBuilds: { foo: true }\r\nregistries:\r\n  default: https://registry.npmjs.org/ # default\r\n  "@bar": https://bar.example/\r\n'
  const updated = updateWorkspaceRegistries(original, [], [foo])
  assert.deepEqual(parse(updated), {
    packages: [], allowBuilds: { foo: true },
    registries: { default: 'https://registry.npmjs.org/', '@bar': bar.url, '@foo': foo.url },
  })
  assert.ok(updated.startsWith('\uFEFF# workspace\r\n'))
  assert.match(updated, /# default\r\n/u)
  assert.doesNotMatch(updated, /(?<!\r)\n/u)
})

test('变更镜像地址、修改 scope 和删除镜像时同步替换原映射', () => {
  const initial = updateWorkspaceRegistries(undefined, [], [foo, bar])
  const moved = { ...foo, url: 'https://foo.example/new/' }
  const updated = updateWorkspaceRegistries(initial, [foo, bar], [moved])
  assert.deepEqual(parse(updated).registries, { '@foo': moved.url })
  const renamed = { ...moved, scope: '@other' }
  assert.deepEqual(parse(updateWorkspaceRegistries(updated, [moved], [renamed])).registries, { '@other': moved.url })
  assert.deepEqual(parse(updateWorkspaceRegistries(updated, [moved], [])).registries, {})
})

test('保留手动变更过的绑定，并拒绝同名但指向其他仓库的映射', () => {
  const external = 'registries: { "@foo": "https://external.example/" }\n'
  assert.equal(updateWorkspaceRegistries(external, [foo], []), external)
  assert.throws(() => updateWorkspaceRegistries(external, [], [foo]), /@foo 已/u)
  assert.throws(() => updateWorkspaceRegistries(external, [foo], [foo]), /@foo 已/u)
  const matching = 'registries: { "@foo": "https://FOO.example/repository/npm" }\n'
  assert.equal(updateWorkspaceRegistries(matching, [], [foo]), matching)
})

test('拒绝无法安全合并的工作区配置，未配置 scope 时保留原文', () => {
  for (const text of [
    'registries: [', '- foo\n', 'registries: []\n', 'shared: &foo {}\nregistries: *foo\n',
    'registries: { https://foo.example/: { scopes: ["@foo"] } }\n',
  ]) {
    assert.throws(() => updateWorkspaceRegistries(text, [], [foo]), /pnpm-workspace\.yaml/u)
    assert.equal(updateWorkspaceRegistries(text, [], []), text)
  }
})

test('撤销本次 scope 写入时保留并发写入的构建设置和 scope 修改', () => {
  const before = 'registries:\n  "@foo": https://foo.example/repository/npm/ # foo\n'
  const after = updateWorkspaceRegistries(before, [foo], [bar])
  const current = after + 'allowBuilds: { foo: true }\n'
  const restored = restoreWorkspaceRegistries(current, before, after)
  assert.deepEqual(parse(restored), { registries: { '@foo': foo.url }, allowBuilds: { foo: true } })
  assert.match(restored, /# foo/u)
  const changed = current.replace(bar.url, 'https://external.example/')
  assert.deepEqual(parse(restoreWorkspaceRegistries(changed, before, after)), {
    registries: { '@foo': foo.url, '@bar': 'https://external.example/' }, allowBuilds: { foo: true },
  })
  for (const removed of ['allowBuilds: { foo: true }\n', 'registries: null\n']) {
    assert.equal(restoreWorkspaceRegistries(removed, before, after), removed)
  }
})
