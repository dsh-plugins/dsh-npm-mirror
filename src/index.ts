import { createHmac, randomBytes } from 'node:crypto'
import { lstat, readFile, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { HostAPI } from '@dsh-plugin/dsh-loader'
import { credentialScope, parseMirrorUpdates, readNpmrc, updateNpmrc } from './credentials.js'
import { MIRRORS_PATH, NPMMIRROR, OFFICIAL, normalizeUrl, parseMirrors, type Mirror, type MirrorSnapshot } from './mirrors.js'
import { restoreWorkspaceRegistries, updateWorkspaceRegistries } from './workspace-registries.js'

export const name = '@dsh-plugin/dsh-npm-mirror'
export const inject = ['dshLoader']

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

async function writeText(path: string, text: string | undefined, profile: HostAPI['profile']) {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') { return undefined }
    throw error
  })
  if (info?.isSymbolicLink()) {
    throw new Error(`profile 的 ${basename(path)} 是符号链接，请直接编辑源文件`)
  }
  if (text === undefined) {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') { throw error }
    })
    return
  }
  await profile.writeFileAtomic(path, text, { mode: 0o600 })
}

interface FileChange {
  readonly path: string
  readonly before: string | undefined
  readonly after: string | undefined
}

/** 持久化 DSH 的镜像顺序和 pnpm 使用的作用域映射。 */
export function apply(ctx: Context & { dshLoader: HostAPI }): void {
  const profile = ctx.dshLoader.profile
  const profileDir = profile.directory
  const labelsPath = join(profileDir, 'data', 'dsh-npm-mirror', 'mirrors.json')
  const npmrcPath = join(profileDir, '.npmrc')
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  // 修订号包含凭证文件变化，且无法用于离线猜测凭证。
  const revisionKey = randomBytes(32)
  let saving = false
  const log = ctx.logger
  const snapshot = async () => {
    const [labelsText, npmrcText, workspaceText, registries] = await Promise.all([
      readText(labelsPath), readText(npmrcPath), readText(workspacePath), profile.readPluginRegistries(),
    ])
    const labels: Mirror[] = labelsText === undefined ? [] : parseMirrors(JSON.parse(labelsText))
    const npmrc = readNpmrc(npmrcText)
    const byUrl = new Map(labels.map(item => [item.url, item]))
    const urls = new Set([registries.registry ?? registries.resolved ?? OFFICIAL, ...registries.fallbackRegistries].map(normalizeUrl))
    const mirrors = Array.from(urls, url => ({
      ...(byUrl.get(url) ?? { url, name: url === OFFICIAL ? 'npm 官方仓库' : url === NPMMIRROR ? 'npmmirror' : new URL(url).host }),
      auth: npmrc.credentials.get(credentialScope(url))?.kind ?? null,
    }))
    const revision = createHmac('sha256', revisionKey).update(JSON.stringify([registries.revision, mirrors, labelsText, npmrcText, workspaceText])).digest('hex')
    const result: MirrorSnapshot = { mirrors, revision }
    return { configRevision: registries.revision, labels, labelsText, npmrcText, npmrc, workspaceText, result }
  }
  const handle = async (request: IncomingMessage): Promise<Response> => {
    if (request.method === 'GET') {
      if (saving) { return json({ message: '正在保存，请稍后刷新' }, 409) }
      try {
        return json((await snapshot()).result)
      } catch (error) {
        log.warn('读取镜像配置失败：%s', error)
        return json({ message: '读取 DSH 镜像配置失败' }, 503)
      }
    }
    if (request.method !== 'POST') { return new Response(null, { status: 405, headers: { allow: 'GET, POST' } }) }
    if (saving) { return json({ message: '另一个窗口正在保存镜像配置' }, 409) }
    if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
      return json({ message: '需要 JSON 请求' }, 415)
    }
    saving = true
    try {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        const buffer = Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > 256 * 1024) { return json({ message: '镜像配置超过大小限制' }, 413) }
        chunks.push(buffer)
      }
      const body = Buffer.concat(chunks).toString('utf8')
      let payload: { revision?: string; mirrors?: unknown } | null
      try {
        payload = JSON.parse(body)
      } catch {
        return json({ message: '镜像配置的 JSON 无效' }, 400)
      }
      const before = await snapshot()
      if (before.result.revision !== payload?.revision) {
        return json({ message: '镜像配置已经变化，请关闭窗口后重新打开' }, 409)
      }
      const mirrors = parseMirrorUpdates(payload?.mirrors, before.labels)
      const updatedNpmrc = updateNpmrc(before.npmrc, before.result.mirrors, mirrors)
      const npmrcText = updatedNpmrc || (before.npmrcText === '' ? '' : undefined)
      const workspaceText = updateWorkspaceRegistries(before.workspaceText, before.labels, mirrors)
      const labels = mirrors.map(({ credential: _credential, ...mirror }) => mirror)
      const changes: FileChange[] = [
        { path: labelsPath, before: before.labelsText, after: JSON.stringify(labels, null, 2) + '\n' },
        { path: npmrcPath, before: before.npmrcText, after: npmrcText },
        { path: workspacePath, before: before.workspaceText, after: workspaceText },
      ]
      const written: FileChange[] = []
      const restoreFiles = async () => {
        for (const change of written.splice(0).reverse()) {
          try {
            const current = await readText(change.path)
            if (current === change.after) {
              await writeText(change.path, change.before, profile)
            } else if (change.path === workspacePath && current !== undefined && change.after !== undefined) {
              const restored = restoreWorkspaceRegistries(current, change.before, change.after)
              if (restored !== current) { await writeText(change.path, restored, profile) }
            }
          } catch (cause) {
            log.warn('恢复镜像配置文件 %s 失败：%s', change.path, cause)
          }
        }
      }
      try {
        // 与安装、卸载和构建审批共用 profile 锁，避免覆盖 pnpm 正在写入的工作区设置。
        await profile.withPackageLock(async () => {
          try {
            for (const change of changes) {
              if (await readText(change.path) !== change.before) {
                throw new Error('镜像配置已经变化，请重新打开窗口')
              }
              if (change.before === change.after) { continue }
              await writeText(change.path, change.after, profile)
              written.push(change)
            }
          } catch (error) {
            await restoreFiles()
            throw error
          }
        })
        const oldUrls = before.result.mirrors.map(row => row.url)
        const urls = mirrors.map(row => row.url)
        if (JSON.stringify(oldUrls) !== JSON.stringify(urls)) {
          const [registry, ...fallbackRegistries] = urls
          if (!registry) { throw new Error('至少保留一个 npm 仓库。') }
          await profile.writePluginRegistries(before.configRevision, registry, fallbackRegistries)
        }
      } catch (error) {
        if (written.length > 0) {
          try {
            await profile.withPackageLock(restoreFiles, { waitMs: 120_000 })
          } catch (cause) {
            log.warn('获取 profile 文件锁以恢复镜像配置失败：%s', cause)
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
  }
  ctx.effect(() => ctx.dshLoader.web.registerOwner({
    kind: 'exact', path: MIRRORS_PATH,
    async handler(request, response) {
      const result = await handle(request)
      response.writeHead(result.status, Object.fromEntries(result.headers))
      response.end(result.body ? Buffer.from(await result.arrayBuffer()) : undefined)
    },
  }))
}
