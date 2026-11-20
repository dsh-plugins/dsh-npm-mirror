/** 用户可编辑的 npm 镜像项，数组顺序决定宿主使用顺序。 */
export interface Mirror {
  readonly name: string
  readonly url: string
  readonly scope?: string
}

/** 浏览器提交的凭证只用于替换该仓库的现有凭证。 */
export type MirrorCredential =
  | { readonly kind: 'bearer'; readonly token: string }
  | { readonly kind: 'basic'; readonly username: string; readonly password: string }

/** 镜像的凭证状态，供浏览器判断能否保留或清除已保存的凭证。 */
export type MirrorView = Mirror & { readonly auth: MirrorCredential['kind'] | null }

/** 与宿主配置一起读取的并发版本。 */
export interface MirrorSnapshot {
  readonly revision: string
  readonly mirrors: readonly MirrorView[]
}

export const MIRRORS_PATH = '/api/dsh-npm-mirror/registries'
export const MAX_MIRRORS = 20
export const MAX_SCOPE_LENGTH = 212
export const MAX_SECRET_LENGTH = 2048
export const MAX_USERNAME_LENGTH = 256
export const OFFICIAL = 'https://registry.npmjs.org/'
export const NPMMIRROR = 'https://registry.npmmirror.com/'

/** 按 pnpm 的比较格式规范化 HTTP(S) 地址，拒绝将凭证和参数写入 profile。 */
export function normalizeUrl(value: string): string {
  const url = URL.parse(value.trim())
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.username || url.password || url.href.includes('?') || url.href.includes('#')) {
    throw new Error('镜像 URL 必须是无凭证、查询参数和片段的 HTTP(S) 地址')
  }
  if (!url.pathname.endsWith('/')) { url.pathname += '/' }
  if (url.href.length > 1024) { throw new Error('镜像 URL 超过 1024 个字符') }
  return url.href
}

/** 解析有序镜像，省略 scope 字段时保留同地址的已有绑定。 */
export function parseMirrors(value: unknown, previous: readonly Mirror[] = []): Mirror[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MIRRORS) {
    throw new Error(`镜像列表必须包含 1 到 ${MAX_MIRRORS} 项`)
  }
  const urls = new Set<string>()
  const scopes = new Set<string>()
  const previousScopes = new Map(previous.map(row => [row.url, row.scope]))
  return value.map((row: unknown) => {
    if (typeof row !== 'object' || row === null || !('name' in row) || !('url' in row)
      || typeof row.name !== 'string' || typeof row.url !== 'string' || row.url.length > 1024) {
      throw new Error('镜像必须包含名称和 URL')
    }
    const name = row.name.trim()
    if (name.length < 1 || name.length > 60 || /[\p{Cc}]/u.test(name)) {
      throw new Error('镜像名称必须包含 1 到 60 个有效字符')
    }
    const url = normalizeUrl(row.url)
    if (urls.has(url)) { throw new Error(`镜像 URL 重复：${url}`) }
    urls.add(url)
    const rawScope = 'scope' in row ? row.scope : previousScopes.get(url)
    if (rawScope === undefined || (typeof rawScope === 'string' && rawScope.trim() === '')) {
      return { name, url }
    }
    const scope = typeof rawScope === 'string' ? rawScope.trim() : ''
    if (scope.length > MAX_SCOPE_LENGTH || !/^@[a-z0-9][a-z0-9._-]*$/.test(scope)) {
      throw new Error('目标 scope 必须以 @ 开头，并使用小写字母、数字、点、下划线或连字符')
    }
    if (url.includes('${')) { throw new Error('目标 scope 的仓库 URL 必须是固定地址') }
    if (scopes.has(scope)) { throw new Error(`目标 scope 重复：${scope}`) }
    scopes.add(scope)
    return { name, url, scope }
  })
}

/** 把一个指定位置的项目移到另一位置，供鼠标和键盘操作共用。 */
export function moveMirror<T>(rows: readonly T[], from: number, to: number): T[] {
  const next = [...rows]
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length || from === to) { return next }
  const [row] = next.splice(from, 1)
  next.splice(to, 0, row!)
  return next
}
