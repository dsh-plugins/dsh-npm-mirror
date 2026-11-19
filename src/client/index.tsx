import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconDataOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import { MirrorDialog } from './Dialog.js'
import { en, NS, zh } from './locales.js'

export const name = '@dsh-plugin/dsh-npm-mirror'
export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  const dialog = createSnapshotStore(false)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('plugins.add.actions', () => ctx.slots.register({
    name: 'plugins.add.actions', id: 'dsh-npm-mirror.configure', order: 20,
  }, ({ onDismiss }) => <MenuItemButton icon={<IconDataOutlineRegular size={14} />}
    onSelect={() => { onDismiss(); dialog.set(true) }}>
    <span style={{ display: 'grid', gap: 2, textAlign: 'start' }}>
      <span>{t('title')}</span>
      <small style={{ color: 'var(--dsw-alias-label-secondary, GrayText)' }}>{t('description')}</small>
    </span>
  </MenuItemButton>))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-npm-mirror.dialog' }, () => {
    const open = useSyncExternalStore(dialog.subscribe, dialog.getSnapshot)
    return open ? <MirrorDialog close={() => { dialog.set(false) }} t={t} /> : null
  }))
}
