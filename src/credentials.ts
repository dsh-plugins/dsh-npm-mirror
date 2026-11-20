import { MAX_SECRET_LENGTH, MAX_USERNAME_LENGTH, parseMirrors, type Mirror, type MirrorCredential } from './mirrors.js'

type Credential = { readonly kind: MirrorCredential['kind']; readonly value: string }
type MirrorUpdate = Mirror & { readonly credential: Credential | null | undefined }

const BEGIN = '# BEGIN dsh-npm-mirror'
const END = '# END dsh-npm-mirror'
const SCOPE = /^\/\/(?:\[[0-9a-f:.]+\]|[\w.-]+)(?::\d+)?\/[\w.~!%/+\-]*$/i
const BEARER = /^[\w.~+/\-]+=*$/
const BASE64 = /^(?:[a-z\d+/]{4})*(?:[a-z\d+/]{2}==|[a-z\d+/]{3}=)?$/i

/** 按 pnpm 的规则将认证绑定到仓库主机和路径。 */
export function credentialScope(url: string): string {
  const { host, pathname } = new URL(url)
  return `//${host}${pathname}`
}

/** 只读取本插件写入的认证项，并保留其余 npm 配置的原始内容。 */
export function readNpmrc(text: string | undefined) {
  const bom = text?.startsWith('\uFEFF') ? '\uFEFF' : ''
  const lines = (text ?? '').slice(bom.length).match(/[^\n]*\n|[^\n]+$/g) ?? []
  const lineText = (line: string) => line.replace(/\r?\n$/, '')
  const begin = lines.findIndex(line => lineText(line) === BEGIN)
  const end = lines.findIndex(line => lineText(line) === END)
  const credentials = new Map<string, Credential>()
  if (begin !== -1 || end !== -1) {
    if (begin !== 0 || end <= begin) {
      throw new Error('profile 的 .npmrc 中凭证区块不完整')
    }
    for (const line of lines.splice(begin, end + 1).slice(1, -1)) {
      const entry = /^(\/\/[^=]+):(_authToken|_auth)=(.*)$/.exec(lineText(line))
      if (!entry || !SCOPE.test(entry[1]!)) {
        throw new Error('profile 的 .npmrc 中凭证项无效')
      }
      const scope = entry[1]!
      const key = entry[2]
      const value = entry[3]!
      if (key === '_authToken' && value === '') { continue }
      const kind = key === '_authToken' ? 'bearer' : 'basic'
      if (!value || !(kind === 'bearer' ? BEARER : BASE64).test(value) || credentials.has(scope)) {
        throw new Error('profile 的 .npmrc 中凭证项无效')
      }
      credentials.set(scope, { kind, value })
    }
    if (lines.some(line => lineText(line) === BEGIN || lineText(line) === END)) {
      throw new Error('profile 的 .npmrc 中凭证区块重复')
    }
  }
  return { bom, credentials, rest: lines.join(''), eol: text?.includes('\r\n') ? '\r\n' : '\n' }
}

/** 解析表单中的保留、清除和替换操作，并将 Basic 凭证编码为 npm 配置值。 */
export function parseMirrorUpdates(input: unknown): MirrorUpdate[] {
  return parseMirrors(input).map((mirror, index) => {
    const value = (input as { credential?: unknown }[])[index]!.credential
    if (value === null || value === undefined) { return { ...mirror, credential: value } }
    if (typeof value !== 'object' || !('kind' in value)) {
      throw new Error('凭证类型无效')
    }
    if (value.kind === 'bearer' && 'token' in value && typeof value.token === 'string'
      && value.token.length <= MAX_SECRET_LENGTH && BEARER.test(value.token)) {
      return { ...mirror, credential: { kind: 'bearer', value: value.token } }
    }
    if (value.kind === 'basic' && 'username' in value && 'password' in value
      && typeof value.username === 'string' && typeof value.password === 'string'
      && value.username.length > 0 && value.username.length <= MAX_USERNAME_LENGTH
      && value.password.length > 0 && value.password.length <= MAX_SECRET_LENGTH
      && !/[:\p{Cc}]/u.test(value.username) && !/\p{Cc}/u.test(value.password)) {
      const encoded = Buffer.from(`${value.username}:${value.password}`, 'utf8').toString('base64')
      return { ...mirror, credential: { kind: 'basic', value: encoded } }
    }
    throw new Error('请填写有效的令牌或用户名和密码')
  })
}

/** 保留原地址的凭证，并按编辑结果生成 pnpm 可直接读取的认证区块。 */
export function updateNpmrc(
  npmrc: ReturnType<typeof readNpmrc>, previous: readonly Mirror[], updates: readonly MirrorUpdate[],
): string {
  const previousUrls = new Set(previous.map(row => row.url))
  const scopes = updates.map(row => credentialScope(row.url))
  const manual = new Set(npmrc.rest.split(/\r?\n/).flatMap(line => {
    const entry = /^\s*["']?(\/\/(?:\[[0-9a-f:.]+\]|[^/=:]+)(?::\d+)?)(\/[^=]*?)?:(?:@[^:=]+:)?(?:_authToken|_auth|username|_password|tokenHelper)["']?\s*=/i.exec(line)
    if (!entry) { return [] }
    const path = entry[2] ?? '/'
    return [entry[1]!.toLowerCase() + (path.endsWith('/') ? path : path + '/')]
  }))
  const lines: string[] = []
  for (const [index, row] of updates.entries()) {
    const scope = scopes[index]!
    const credential = row.credential === undefined
      ? (previousUrls.has(row.url) ? npmrc.credentials.get(scope) : undefined)
      : row.credential
    if (!credential) { continue }
    if (!SCOPE.test(scope)) {
      throw new Error('仓库 URL 包含 .npmrc 认证项不支持的字符')
    }
    if (scopes.indexOf(scope) !== scopes.lastIndexOf(scope)) {
      throw new Error('有凭证的镜像不能与另一条镜像共用主机和路径')
    }
    if (row.credential && manual.has(scope)) {
      throw new Error('此仓库在 profile 的 .npmrc 中已有手动配置的凭证')
    }
    if (credential.kind === 'basic') {
      // 清空同范围的低优先级 Bearer 令牌，让 pnpm 选用新保存的 Basic 凭证。
      lines.push(`${scope}:_authToken=`, `${scope}:_auth=${credential.value}`)
    } else {
      lines.push(`${scope}:_authToken=${credential.value}`)
    }
  }
  const block = lines.length === 0 ? '' : [BEGIN, ...lines, END, ''].join(npmrc.eol)
  return npmrc.bom + block + npmrc.rest
}
