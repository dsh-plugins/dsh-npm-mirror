<div align="center">
  <img src="icon.svg" width="56" height="56" alt="">
  <h1>npm 镜像</h1>
  <p><strong>在 DSH 的添加插件菜单管理 npm 仓库。</strong></p>
</div>

DSH 0.2.2-rc.3 打开「插件」→「添加插件」右侧箭头→「npm 镜像」。保存后的镜像顺序用于当前 profile 的插件安装和更新。

```sh
dsh plugin --profile web add @dsh-plugin/dsh-loader@2.0.0-dev.43799314028
dsh plugin --profile web add @dsh-plugin/dsh-npm-mirror
```

| 操作 | 说明 |
| --- | --- |
| 修改与添加 | 编辑已有仓库，或输入新仓库的名称和 HTTP(S) URL。 |
| 调整顺序 | 拖动项目把手或使用上下箭头。首项写入宿主的 `registry`，其余依次写入 `fallbackRegistries`。 |
| 保存 | 使用原生配置编辑器更新 profile，并保留插件管理器的其他配置。网络错误和未找到包等情况按宿主规则尝试下一仓库。 |
| 安装弹窗 | DSH 会记住上次使用的仓库。要使用新首选，展开原生安装弹窗的仓库选项并选择对应地址。 |

插件从当前宿主读取现有配置。默认 profile 显示 npm 官方仓库和 npmmirror。仓库认证仍由 npm 或 pnpm 配置管理，镜像 URL 不含凭证。移除本插件后，已保存的宿主配置继续生效。

如果首选地址同时是 pnpm 配置的自定义默认仓库，DSH 0.2.2-rc.3 会沿用该仓库的单源安装规则。要让多个仓库参与回退，可由本插件独立管理插件安装顺序，并保留 pnpm 的默认官方源。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
```
