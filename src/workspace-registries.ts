import { isAlias, isMap, isNode, isScalar, parseDocument, visit, type Scalar } from 'yaml'
import { normalizeUrl, type Mirror } from './mirrors.js'

function matchesUrl(value: unknown, url: string | undefined): boolean {
  if (typeof value !== 'string' || url === undefined) { return false }
  try {
    return normalizeUrl(value) === url
  } catch {
    return false
  }
}

function readWorkspace(text: string | undefined, initializeRegistries = false) {
  const document = parseDocument(text ?? '')
  const emptyMap = (node: Scalar) => Object.assign(document.createNode({}), {
    commentBefore: node.commentBefore,
    comment: node.comment,
  })
  if (isScalar(document.contents) && document.contents.value === null) {
    document.setIn([], emptyMap(document.contents))
  }
  if (document.errors.length || (document.contents !== null && !isMap(document.contents))) {
    throw new Error('pnpm-workspace.yaml 必须是有效的 YAML 映射')
  }
  const registries = document.get('registries', true)
  if (isMap(registries) && registries.items.some(({ key }) => isScalar(key)
    && typeof key.value === 'string' && /^https?:\/\//i.test(key.value))) {
    throw new Error('pnpm-workspace.yaml 的 registries 使用了以仓库 URL 为键的格式，请直接编辑源文件')
  }
  if (isScalar(registries) && registries.value === null) {
    if (initializeRegistries) { document.set('registries', emptyMap(registries)) }
  } else if (registries !== undefined && !isMap(registries)) {
    throw new Error('pnpm-workspace.yaml 的 registries 必须是 scope 到仓库 URL 的映射')
  }
  visit(registries ?? null, (_key, node) => {
    if (isAlias(node) || (isNode(node) && 'anchor' in node && node.anchor)) {
      throw new Error('请在 pnpm-workspace.yaml 中直接编辑使用 YAML 锚点或别名的 registries')
    }
  })
  return document
}

function writeWorkspace(document: ReturnType<typeof readWorkspace>, text: string | undefined): string {
  const updated = String(document)
  const bom = text?.startsWith('\uFEFF') ? '\uFEFF' : ''
  return bom + (text?.includes('\r\n') ? updated.replaceAll('\n', '\r\n') : updated)
}

/** 同步面板声明的 scope，避免覆盖同名的手动绑定或改动其他 pnpm 设置。 */
export function updateWorkspaceRegistries(
  text: string | undefined, previous: readonly Mirror[], mirrors: readonly Mirror[],
): string | undefined {
  const bindings = (rows: readonly Mirror[]) => new Map(rows.flatMap(row => row.scope ? [[row.scope, row.url] as const] : []))
  const before = bindings(previous)
  const next = bindings(mirrors)
  if (before.size === 0 && next.size === 0) { return text }

  const document = readWorkspace(text, true)

  let changed = false
  for (const [scope, url] of before) {
    const path = ['registries', scope]
    if (!next.has(scope) && matchesUrl(document.getIn(path), url)) {
      document.deleteIn(path)
      changed = true
    }
  }
  for (const [scope, url] of next) {
    const path = ['registries', scope]
    const current = document.getIn(path)
    if (matchesUrl(current, url)) { continue }
    if (document.hasIn(path) && !matchesUrl(current, before.get(scope))) {
      throw new Error(`${scope} 已在 pnpm-workspace.yaml 中绑定其他仓库`)
    }
    document.setIn(path, url)
    changed = true
  }
  return changed ? writeWorkspace(document, text) : text
}

/** 保存失败时只撤销未被其他进程再次编辑的 scope。 */
export function restoreWorkspaceRegistries(text: string, before: string | undefined, after: string): string {
  const original = readWorkspace(before)
  const written = readWorkspace(after)
  const current = readWorkspace(text)
  if (!isMap(current.get('registries', true))) { return text }
  const keys = [original, written].flatMap(document => {
    const registries = document.get('registries', true)
    return isMap(registries) ? registries.items.flatMap(({ key }) =>
      isScalar(key) && typeof key.value === 'string' && key.value.startsWith('@') ? [key.value] : [],
    ) : []
  })
  let changed = false
  for (const key of new Set(keys)) {
    const path = ['registries', key]
    const prior = original.getIn(path, true)
    const applied = written.getIn(path)
    if (original.getIn(path) === applied || current.getIn(path) !== applied) { continue }
    if (prior === undefined) {
      current.deleteIn(path)
    } else {
      current.setIn(path, prior)
    }
    changed = true
  }
  return changed ? writeWorkspace(current, text) : text
}
