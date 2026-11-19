export const NS = 'dshNpmMirror'

export const zh = {
  title: 'npm 镜像',
  description: '管理插件安装使用的仓库和尝试顺序',
  order: '从上到下依次尝试。拖动把手或使用上下按钮调整顺序。安装弹窗可继续使用上次选定的仓库。',
  waiting: '正在读取镜像…',
  emptyName: '镜像名称',
  url: 'npm 仓库 URL',
  add: '添加镜像',
  remove: '移除',
  up: '上移',
  down: '下移',
  drag: '拖动排序',
  close: '关闭',
  cancel: '取消',
  save: '保存',
  saving: '正在保存…',
  retry: '重试',
  readError: '读取镜像配置失败',
  saveError: '保存镜像配置失败',
  first: '优先使用',
  list: '镜像列表',
}

export const en: Record<keyof typeof zh, string> = {
  title: 'npm Mirrors',
  description: 'Manage registries and the order used to install plugins',
  order: 'Registries are tried from top to bottom. Reorder with the handle or arrow buttons. The install dialog can remember its last registry.',
  waiting: 'Loading mirrors…',
  emptyName: 'Mirror name',
  url: 'npm registry URL',
  add: 'Add mirror',
  remove: 'Remove',
  up: 'Move up',
  down: 'Move down',
  drag: 'Drag to reorder',
  close: 'Close',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  retry: 'Retry',
  readError: 'Could not load the mirrors',
  saveError: 'Could not save the mirrors',
  first: 'First choice',
  list: 'Mirror list',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { dshNpmMirror: keyof typeof zh }
}
