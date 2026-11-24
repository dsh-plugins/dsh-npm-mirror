import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { Button, UI_SERVICE } from '@dsh-plugin/dsh-loader/client'
import { MirrorDialog } from './Dialog.js'
import { en, NS, zh } from './locales.js'

export const name = '@dsh-plugin/dsh-npm-mirror'
export const inject = [UI_SERVICE, 'slots', 'locale']

export function apply(ctx: Context): void {
  const changes = new EventTarget()
  let visible = false
  const getSnapshot = () => visible
  const subscribe = (listener: () => void) => {
    changes.addEventListener('change', listener)
    return () => { changes.removeEventListener('change', listener) }
  }
  const showDialog = (open: boolean) => {
    if (visible === open) { return }
    visible = open
    changes.dispatchEvent(new Event('change'))
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('plugins.add.actions', () => ctx.slots.register({
    name: 'plugins.add.actions', id: 'dsh-npm-mirror.configure', order: 20,
  }, ({ onDismiss }) => <Button variant="ghost" icon="Web"
    style={{ width: '100%', height: 'auto', minHeight: 64, justifyContent: 'start', whiteSpace: 'normal' }}
    onClick={() => { onDismiss(); showDialog(true) }}>
    <span style={{ display: 'grid', gap: 2, textAlign: 'start' }}>
      <span>{t('title')}</span>
      <small style={{ color: 'var(--dsw-alias-label-secondary, GrayText)' }}>{t('description')}</small>
    </span>
  </Button>))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-npm-mirror.dialog' }, () => {
    const open = useSyncExternalStore(subscribe, getSnapshot)
    return open ? <MirrorDialog close={() => { showDialog(false) }} t={t} /> : null
  }))
}
