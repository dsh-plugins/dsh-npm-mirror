import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { MIRRORS_PATH, NPMMIRROR, OFFICIAL, normalizeUrl, parseMirrors, type Mirror, type MirrorSnapshot } from './mirrors.js'

export const name = '@dsh-plugin/dsh-npm-mirror'
export const inject = ['profileContext', 'configEditor', 'connection']

function json(value: object, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}

async function readLabels(path: string): Promise<Mirror[]> {
  let data: string
  try {
    data = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return [] }
    throw error
  }
  return parseMirrors(JSON.parse(data))
}

async function writeLabels(path: string, rows: readonly Mirror[]) {
  if (rows.length === 0) {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') { throw error }
    })
    return
  }
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), randomUUID() + '.tmp')
  try {
    await writeFile(temporary, JSON.stringify(rows, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== 'ENOENT') { throw cause }
    })
    throw error
  }
}

function revision(raw: unknown, mirrors: readonly Mirror[]): string {
  return createHash('sha256').update(JSON.stringify([raw, mirrors])).digest('hex')
}

/** 通过宿主配置编辑器持久化 npm 优先级，让原生安装和更新共用。 */
export function apply(ctx: Context): void {
  const path = join(ctx.profileContext.dir, 'data', 'dsh-npm-mirror', 'mirrors.json')
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
    const [labels, registries] = await Promise.all([readLabels(path), managerAtRead.registries()])
    if (managerAtRead !== manager || raw !== JSON.stringify(entry.options.config ?? {})) {
      throw new Error('DSH 插件管理器配置已变化，请重新打开窗口')
    }
    const names = new Map(labels.map(item => [item.url, item.name]))
    const urls = new Set([registries.registry ?? registries.resolved ?? OFFICIAL, ...registries.fallbackRegistries].map(normalizeUrl))
    const mirrors = Array.from(urls, url => ({
      url,
      name: names.get(url) ?? (url === OFFICIAL ? 'npm 官方仓库' : url === NPMMIRROR ? 'npmmirror' : new URL(url).host),
    }))
    const result: MirrorSnapshot = { mirrors, revision: revision(raw, mirrors) }
    return { entry, raw, labels, result }
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
        if (body.length > 32 * 1024) { return json({ message: '镜像配置超过大小限制' }, 413) }
        const payload = JSON.parse(body) as { revision?: string; mirrors?: unknown } | null
        const mirrors = parseMirrors(payload?.mirrors)
        const before = await snapshot()
        if (before.result.revision !== payload?.revision) {
          return json({ message: '镜像配置已经变化，请关闭窗口后重新打开' }, 409)
        }
        await writeLabels(path, mirrors)
        try {
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
          await writeLabels(path, before.labels)
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
