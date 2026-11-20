import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { credentialScope, parseMirrorUpdates, readNpmrc, updateNpmrc } from './credentials.js'
import { MIRRORS_PATH, NPMMIRROR, OFFICIAL, normalizeUrl, parseMirrors, type Mirror, type MirrorSnapshot } from './mirrors.js'

export const name = '@dsh-plugin/dsh-npm-mirror'
export const inject = ['profileContext', 'configEditor', 'connection']

function json(value: object, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined }
    throw error
  }
}

async function writeText(path: string, text: string | undefined) {
  if (text === undefined) {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') { throw error }
    })
    return
  }
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), randomUUID() + '.tmp')
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== 'ENOENT') { throw cause }
    })
    throw error
  }
}

interface FileChange {
  readonly path: string
  readonly before: string | undefined
  readonly after: string | undefined
}

/** 通过宿主配置编辑器持久化 npm 优先级，让原生安装和更新共用。 */
export function apply(ctx: Context): void {
  const labelsPath = join(ctx.profileContext.dir, 'data', 'dsh-npm-mirror', 'mirrors.json')
  const npmrcPath = join(ctx.profileContext.dir, '.npmrc')
  // 修订号包含凭证文件的变化，同时避免公开可用于离线猜测凭证的散列。
  const revisionKey = randomBytes(32)
  let manager: Context['pluginManager'] | undefined
  let saving = false
  const log = ctx.logger('dsh-npm-mirror')
  ctx.inject(['pluginManager'], scope => {
    scope.effect(() => {
      manager = scope.pluginManager
      return () => { manager = undefined }
    })
  })
  const snapshot = async () => {
    const entry = ctx.configEditor.entries().find(row =>
      row.options.id === 'plugin-manager' && row.options.name === '@deepseek-ai/dsh-plugin-manager')
    if (!entry?.fiber || !manager) { throw new Error('DSH 插件管理器尚未就绪') }
    const managerAtRead = manager
    const raw = JSON.stringify(entry.options.config ?? {})
    const [labelsText, npmrcText, registries] = await Promise.all([
      readText(labelsPath), readText(npmrcPath), managerAtRead.registries(),
    ])
    if (managerAtRead !== manager || raw !== JSON.stringify(entry.options.config ?? {})) {
      throw new Error('DSH 插件管理器配置已变化，请重新打开窗口')
    }
    const labels: Mirror[] = labelsText === undefined ? [] : parseMirrors(JSON.parse(labelsText))
    const npmrc = readNpmrc(npmrcText)
    const names = new Map(labels.map(item => [item.url, item.name]))
    const urls = new Set([registries.registry ?? registries.resolved ?? OFFICIAL, ...registries.fallbackRegistries].map(normalizeUrl))
    const mirrors = Array.from(urls, url => ({
      url,
      name: names.get(url) ?? (url === OFFICIAL ? 'npm 官方仓库' : url === NPMMIRROR ? 'npmmirror' : new URL(url).host),
      auth: npmrc.credentials.get(credentialScope(url))?.kind ?? null,
    }))
    const revision = createHmac('sha256', revisionKey).update(JSON.stringify([raw, mirrors, labelsText, npmrcText])).digest('hex')
    const result: MirrorSnapshot = { mirrors, revision }
    return { entry, raw, labelsText, npmrcText, npmrc, result }
  }
  ctx.effect(() => ctx.connection.fetch.register({
    path: MIRRORS_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.method === 'GET') {
        if (saving) { return json({ message: '正在保存，请稍后刷新' }, 409) }
        try {
          return json((await snapshot()).result)
        } catch (error) {
          log.warn('读取镜像配置失败：%s', error)
          return json({ message: '读取 DSH 镜像配置失败' }, 503)
        }
      }
      if (saving) { return json({ message: '另一个窗口正在保存镜像配置' }, 409) }
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
        return json({ message: '需要 JSON 请求' }, 415)
      }
      saving = true
      try {
        const body = await request.text()
        if (body.length > 256 * 1024) { return json({ message: '镜像配置超过大小限制' }, 413) }
        let payload: { revision?: string; mirrors?: unknown } | null
        try {
          payload = JSON.parse(body)
        } catch {
          return json({ message: '镜像配置的 JSON 无效' }, 400)
        }
        const mirrors = parseMirrorUpdates(payload?.mirrors)
        const before = await snapshot()
        if (before.result.revision !== payload?.revision) {
          return json({ message: '镜像配置已经变化，请关闭窗口后重新打开' }, 409)
        }
        const updatedNpmrc = updateNpmrc(before.npmrc, before.result.mirrors, mirrors)
        const npmrcText = updatedNpmrc || (before.npmrcText === '' ? '' : undefined)
        if (npmrcText !== before.npmrcText) {
          const info = await lstat(npmrcPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') { return undefined }
            throw error
          })
          if (info?.isSymbolicLink()) {
            return json({ message: 'profile 的 .npmrc 是符号链接，请通过原文件管理凭证' }, 409)
          }
        }
        const labels = mirrors.map(({ name, url }) => ({ name, url }))
        const changes: FileChange[] = [
          { path: labelsPath, before: before.labelsText, after: JSON.stringify(labels, null, 2) + '\n' },
          { path: npmrcPath, before: before.npmrcText, after: npmrcText },
        ]
        const written: FileChange[] = []
        try {
          for (const change of changes) {
            if (change.before === change.after) { continue }
            if (await readText(change.path) !== change.before) {
              throw new Error('镜像配置已经变化，请重新打开窗口')
            }
            await writeText(change.path, change.after)
            written.push(change)
          }
          const oldUrls = before.result.mirrors.map(row => row.url)
          const urls = mirrors.map(row => row.url)
          if (JSON.stringify(oldUrls) !== JSON.stringify(urls)) {
            await ctx.configEditor.edit(before.entry, current => {
              if (JSON.stringify(current) !== before.raw) { throw new Error('镜像配置已经变化，请重新打开窗口') }
              const [registry, ...fallbackRegistries] = urls
              return { ...current, registry, fallbackRegistries }
            })
          }
        } catch (error) {
          for (const change of written.reverse()) {
            try {
              if (await readText(change.path) === change.after) {
                await writeText(change.path, change.before)
              }
            } catch (cause) {
              log.warn('恢复镜像配置文件失败：%s', cause)
            }
          }
          throw error
        }
        return new Response(null, { status: 204 })
      } catch (error) {
        log.warn('保存镜像配置失败：%s', error)
        return json({ message: error instanceof Error ? error.message : '保存镜像配置失败' }, 400)
      } finally {
        saving = false
      }
    },
  }))
}
