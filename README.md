<div align="center">
  <img src="icon.svg" width="56" height="56" alt="">
  <h1>npm 镜像</h1>
  <p><strong>在 DSH 的添加插件菜单管理 npm 仓库。</strong></p>
</div>

在 DSH `0.2.2-rc.3` 至 `0.2.2-rc.5` 或 `0.2.3-alpha.2` 打开「插件」→「添加插件」右侧箭头→「npm 镜像」。保存后的镜像顺序用于当前配置档的插件安装和更新。

```sh
dsh plugin --profile web add @dsh-plugin/dsh-loader@next
dsh plugin --profile web add @dsh-plugin/dsh-npm-mirror@next
```

| 操作 | 说明 |
| --- | --- |
| 修改与添加 | 编辑已有仓库，或输入新仓库的名称和 HTTP(S) URL。 |
| 调整顺序 | 拖动项目把手或使用上下箭头。首项写入宿主的 `registry`，其余依次写入 `fallbackRegistries`。 |
| 配置认证 | 展开对应镜像的「仓库配置」，选择 Bearer 令牌或用户名和密码（Basic）。 |
| 绑定 scope | 在「仓库配置」填写目标 scope，例如 `@example`。保存后，pnpm 安装和卸载插件时会从该镜像解析这个 scope 下的包。 |
| 保存 | 使用原生配置编辑器更新 profile，并保留插件管理器的其他配置。网络错误和未找到包等情况按宿主规则尝试下一仓库。 |
| 安装弹窗 | DSH 会记住上次使用的仓库。要使用新首选，展开原生安装弹窗的仓库选项并选择对应地址。 |

插件从当前宿主读取现有配置。默认 profile 显示 npm 官方仓库和 npmmirror。移除本插件后，已保存的宿主配置继续生效。

凭证保存在当前 profile 的 `.npmrc`，按仓库主机和路径匹配。Bearer 令牌以原文保存，Basic 凭证以 Base64 编码保存。弹窗只显示保存状态。要清除此面板保存的凭证，选择「使用现有 npm / pnpm 配置」并保存。修改仓库地址后需要重新填写凭证，移除镜像也会清除对应的凭证。

scope 映射写入当前 profile 的 `pnpm-workspace.yaml` 的 `registries`。每个镜像可填写一个 scope，同一个 scope 只能绑定一个镜像。清空字段或移除镜像时，面板会删除仍指向原地址的映射。若已有相同 scope 和地址，填写并保存后可在面板中管理该映射。若同一个 scope 已手动绑定其他地址，保存时会提示冲突。

如果首选地址是 pnpm 的自定义默认仓库，且未列入回退列表，宿主只尝试这个地址。要让多个仓库参与回退，可由本插件管理插件安装顺序，并保留 pnpm 的默认官方源。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
```
