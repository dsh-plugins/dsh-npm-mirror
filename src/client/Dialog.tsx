import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Scrollbar } from '@dsh-plugin/dsh-loader/client'
import {
  MAX_MIRRORS, MAX_SCOPE_LENGTH, MAX_SECRET_LENGTH, MAX_USERNAME_LENGTH, MIRRORS_PATH, moveMirror, normalizeUrl, parseMirrors,
  type MirrorCredential, type MirrorSnapshot, type MirrorView,
} from '../mirrors.js'
import type { NS } from './locales.js'

type Row = MirrorView & {
  readonly key: number
  readonly originalUrl: string
  readonly credential: MirrorCredential | null | undefined
}
type Translate = TranslateNS<typeof NS>

const css = `
.dsh-npm-mirror-dialog { width: min(620px, 100%); max-height: calc(100dvh - 240px); }
.dsh-npm-mirror-dialog > :last-child { flex-shrink: 0; }
.dsh-npm-mirror-content { min-height: 0; }
.dsh-npm-mirror-content > :has(> .dsh-npm-mirror-body),
.dsh-npm-mirror-body { display: flex; flex-direction: column; min-height: 0; }
.dsh-npm-mirror-list { flex: 0 1 auto; min-height: 0; }
.dsh-npm-mirror-list ol { display: grid; gap: 8px; margin: 0; padding: 2px; list-style: none; }
.dsh-npm-mirror-list li {
  display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 10px;
  padding: 10px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l2, #8885);
}
.dsh-npm-mirror-list li[data-drag-over] { outline: 2px solid var(--dsw-alias-brand-primary, Highlight); outline-offset: -2px; }
.dsh-npm-mirror-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 6px; }
.dsh-npm-mirror-fields { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(0, 2fr); gap: 8px; }
.dsh-npm-mirror-fields label { display: grid; gap: 4px; min-width: 0; font-size: 12px; color: var(--dsw-alias-label-secondary, GrayText); }
.dsh-npm-mirror-auth { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l2, #8885); }
.dsh-npm-mirror-auth summary { cursor: pointer; font-size: 12px; }
.dsh-npm-mirror-auth small { margin-inline-start: 6px; color: var(--dsw-alias-label-secondary, GrayText); }
.dsh-npm-mirror-auth .dsh-npm-mirror-fields { margin-top: 8px; }
.dsh-npm-mirror-auth select {
  min-width: 0; min-height: 34px; padding: 4px 8px; border-radius: 8px; font: inherit; color: inherit;
  background: var(--dsw-alias-bg-ui-default, Canvas); border: 1px solid var(--dsw-alias-border-l2, #8885);
}
.dsh-npm-mirror-auth p { margin: 8px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary, GrayText); }
.dsh-npm-mirror-handle { cursor: grab; touch-action: none; user-select: none; }
.dsh-npm-mirror-handle:active { cursor: grabbing; }
.dsh-npm-mirror-error { margin: 8px 0 0; color: var(--dsw-alias-state-danger-primary, #d33); }
.dsh-npm-mirror-add { align-self: flex-start; margin-top: 12px; }
@media (max-width: 480px) { .dsh-npm-mirror-fields { grid-template-columns: minmax(0, 1fr); } }
`

async function responseError(response: Response, fallback: string): Promise<Error> {
  const value = await response.json().catch(() => ({})) as { message?: string }
  return new Error(value.message ?? fallback)
}

function sameUrl(before: string, after: string): boolean {
  try {
    return normalizeUrl(before) === normalizeUrl(after)
  } catch {
    return before.trim() === after.trim()
  }
}

function RegistryFields({ row, saving, t, onChange }: {
  row: Row
  saving: boolean
  t: Translate
  onChange: (changes: Partial<Row>) => void
}) {
  const credential = row.credential
  const saved = row.auth && sameUrl(row.originalUrl, row.url) ? row.auth : null
  const mode = credential?.kind ?? (credential === undefined && saved ? 'saved' : 'external')
  return <details className="dsh-npm-mirror-auth">
    <summary>{t('registryConfig')}{mode === 'saved' && <small>{t('authSaved')}</small>}</summary>
    <div className="dsh-npm-mirror-fields">
      <label>{t('authMode')}
        <select value={mode} disabled={saving} onChange={event => {
          switch (event.target.value) {
            case 'bearer': onChange({ credential: { kind: 'bearer', token: '' } }); break
            case 'basic': onChange({ credential: { kind: 'basic', username: '', password: '' } }); break
            case 'saved': onChange({ credential: undefined }); break
            case 'external': onChange({ credential: null }); break
          }
        }}>
          {saved && <option value="saved">{t(saved === 'bearer' ? 'keepBearer' : 'keepBasic')}</option>}
          <option value="external">{t('externalAuth')}</option>
          <option value="bearer">{t('bearerAuth')}</option>
          <option value="basic">{t('basicAuth')}</option>
        </select>
      </label>
      <label>{t('targetScope')}
        <Input placeholder="@example" autoCapitalize="none" autoComplete="off" spellCheck={false}
          maxLength={MAX_SCOPE_LENGTH} disabled={saving} value={row.scope ?? ''}
          onChange={event => { onChange({ scope: event.target.value }) }} />
      </label>
      {credential?.kind === 'bearer' && <label>{t('token')}
        <Input type="password" autoComplete="new-password" maxLength={MAX_SECRET_LENGTH} disabled={saving} value={credential.token}
          onChange={event => { onChange({ credential: { ...credential, token: event.target.value } }) }} />
      </label>}
    </div>
    {credential?.kind === 'basic' && <div className="dsh-npm-mirror-fields">
      <label>{t('username')}
        <Input autoComplete="off" maxLength={MAX_USERNAME_LENGTH} disabled={saving} value={credential.username}
          onChange={event => { onChange({ credential: { ...credential, username: event.target.value } }) }} />
      </label>
      <label>{t('password')}
        <Input type="password" autoComplete="new-password" maxLength={MAX_SECRET_LENGTH} disabled={saving} value={credential.password}
          onChange={event => { onChange({ credential: { ...credential, password: event.target.value } }) }} />
      </label>
    </div>}
    {saved && mode === 'external' && <p>{t('clearAuth')}</p>}
    {row.auth && !saved && mode === 'external' && <p>{t('changedUrlAuth')}</p>}
  </details>
}

/** 弹窗只保存用户确认的编辑，关闭前的草稿不影响原生安装。 */
export function MirrorDialog({ close, t }: { close: () => void; t: Translate }) {
  const [revision, setRevision] = useState<string>()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [dragOver, setDragOver] = useState<number>()
  const nextKey = useRef(0)
  const list = useRef<HTMLOListElement>(null)
  const drag = useRef<{ key: number; pointerId: number }>()
  const readError = t('readError')

  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    setError('')
    void (async () => {
      try {
        const response = await fetch(MIRRORS_PATH, { cache: 'no-store', signal: abort.signal })
        if (!response.ok) { throw await responseError(response, readError) }
        const snapshot = await response.json() as MirrorSnapshot
        if (abort.signal.aborted) { return }
        setRows(snapshot.mirrors.map(row => ({
          ...row, key: ++nextKey.current, originalUrl: row.url, credential: undefined,
        })))
        setRevision(snapshot.revision)
      } catch (cause) {
        if (!abort.signal.aborted) { setError(cause instanceof Error ? cause.message : readError) }
      } finally {
        if (!abort.signal.aborted) { setLoading(false) }
      }
    })()
    return () => { abort.abort() }
  }, [readError, reload])

  const edit = (key: number, changes: Partial<Row>) => {
    setRows(current => current.map(row => row.key === key ? { ...row, ...changes } : row))
  }
  const move = (from: number, to: number) => { setRows(current => moveMirror(current, from, to)) }
  const targetKey = ({ clientX, clientY }: PointerEvent<HTMLButtonElement>) => {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('li[data-mirror-key]')
    if (target && target.parentElement === list.current) { return Number(target.dataset.mirrorKey) }
  }
  const stopDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) { return }
    drag.current = undefined
    setDragOver(undefined)
  }
  const save = async () => {
    if (saving || revision === undefined) { return }
    setSaving(true)
    setError('')
    try {
      const mirrors = parseMirrors(rows).map((mirror, index) => {
        const { credential } = rows[index]!
        if ((credential?.kind === 'bearer' && !credential.token)
          || (credential?.kind === 'basic' && (!credential.username || !credential.password))) {
          throw new Error(t('credentialRequired'))
        }
        return { ...mirror, scope: mirror.scope ?? '', credential }
      })
      const response = await fetch(MIRRORS_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision, mirrors }),
      })
      if (!response.ok) { throw await responseError(response, t('saveError')) }
      close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('saveError'))
      setSaving(false)
    }
  }

  return <Modal open onClose={() => { if (!saving) { close() } }} title={t('title')} closeLabel={t('close')}
    description={t('order')} className="dsh-npm-mirror-dialog" contentClassName="dsh-npm-mirror-content"
    footer={<>
      <Button disabled={saving} onClick={close}>{t('cancel')}</Button>
      <Button variant="primary" disabled={saving || revision === undefined} onClick={() => { void save() }}>{t(saving ? 'saving' : 'save')}</Button>
    </>}>
    <style>{css}</style>
    <div className="dsh-npm-mirror-body">
      {loading && <span role="status">{t('waiting')}</span>}
      {revision !== undefined && <>
        <Scrollbar aria-label={t('list')} className="dsh-npm-mirror-list">
          <ol ref={list}>
            {rows.map((row, index) => <li key={row.key} data-mirror-key={row.key} data-drag-over={dragOver === row.key ? '' : undefined}>
              <Button size="sm" className="dsh-npm-mirror-handle" title={t('drag')} aria-label={t('drag')}
                disabled={saving}
                onPointerDown={event => {
                  if (saving || event.button !== 0 || drag.current) { return }
                  // Launcher 的 Windows WebView 会接管原生 HTML 拖放事件。
                  event.currentTarget.setPointerCapture(event.pointerId)
                  drag.current = { key: row.key, pointerId: event.pointerId }
                }}
                onPointerMove={event => {
                  if (drag.current?.pointerId !== event.pointerId) { return }
                  const target = targetKey(event)
                  setDragOver(target === drag.current.key ? undefined : target)
                }}
                onPointerUp={event => {
                  const active = drag.current
                  if (active?.pointerId !== event.pointerId) { return }
                  const target = targetKey(event)
                  stopDrag(event)
                  if (saving || target === undefined || target === active.key) { return }
                  setRows(current => moveMirror(current,
                    current.findIndex(item => item.key === active.key),
                    current.findIndex(item => item.key === target),
                  ))
                }}
                onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}>⠿</Button>
              <div>
                <div className="dsh-npm-mirror-fields">
                  <label>{t('emptyName')}
                    <Input maxLength={60} disabled={saving} value={row.name} onChange={event => { edit(row.key, { name: event.target.value }) }} />
                  </label>
                  <label>{t('url')}
                    <Input maxLength={1024} inputMode="url" disabled={saving} placeholder="https://registry.example/" value={row.url}
                      onChange={event => {
                        const url = event.target.value
                        edit(row.key, sameUrl(row.url, url) ? { url } : {
                          url, credential: sameUrl(row.originalUrl, url) ? undefined : null,
                        })
                      }} />
                  </label>
                </div>
                <div className="dsh-npm-mirror-actions">
                  <Button size="sm" title={t('up')} aria-label={t('up')} disabled={saving || index === 0} onClick={() => { move(index, index - 1) }}>↑</Button>
                  <Button size="sm" title={t('down')} aria-label={t('down')} disabled={saving || index === rows.length - 1}
                    onClick={() => { move(index, index + 1) }}>↓</Button>
                  <Button size="sm" disabled={saving || rows.length === 1}
                    onClick={() => { setRows(current => current.filter(item => item.key !== row.key)) }}>{t('remove')}</Button>
                  {index === 0 && <small>{t('first')}</small>}
                </div>
                <RegistryFields row={row} saving={saving} t={t} onChange={changes => { edit(row.key, changes) }} />
              </div>
            </li>)}
          </ol>
        </Scrollbar>
        <Button className="dsh-npm-mirror-add" variant="outline" size="sm" disabled={saving || rows.length >= MAX_MIRRORS}
          onClick={() => {
            setRows(current => [...current, { key: ++nextKey.current, name: '', url: '', originalUrl: '', auth: null, credential: null }])
          }}>{t('add')}</Button>
      </>}
      {error && <p className="dsh-npm-mirror-error" role="alert">{error}</p>}
      {!loading && revision === undefined && <Button size="sm" onClick={() => { setReload(value => value + 1) }}>{t('retry')}</Button>}
    </div>
  </Modal>
}
