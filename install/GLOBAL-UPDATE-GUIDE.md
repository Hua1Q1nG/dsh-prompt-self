# DSH 全局插件更新总纲（触发词：「更新全局插件」）

> 本文档是给 DSH Agent 执行的全局操作手册。用户每次更新 DSH 桌面版后（或直接说「更新全局插件 /
> 更新所有插件 / 检查全部插件」），Agent 必须**逐节执行**，自动发现本机部署的**所有**插件（含未来
> 新安装的插件），逐个检测兼容性、修复并同步 GitHub，最后按第 6 节模板汇报。

## 0. 基线信息

- DSH Desktop：0.1.9（曾验证 0.1.7）
- 核心依赖（全部 `@deepseek-ai/*`）：0.1.0-rc.6；cordis 4.0.1
- 本机 DSH 家目录 `<DSH_HOME>`：`C:\Users\<用户名>\AppData\Roaming\dsh-desktop\harness`

## 1. 插件登记表（registry）

| 插件 | 本地包目录（相对 `<DSH_HOME>`） | 专属指南 | GitHub 仓库（分支 main） | 仓库内源目录 |
|---|---|---|---|---|
| dsh-global-updater（更新器自身） | `profiles\node_modules\dsh-global-updater` | `global-updater\UPDATE-GUIDE.md` | `Hua1Q1nG/dsh-global-updater` | `lib/ + package.json + cordis.patch.yml` + `tests/` + `UPDATE-GUIDE.md` + `install/` |
| dsh-prompt-self-client | `profiles\node_modules\dsh-prompt-self-client` | `prompt-self\UPDATE-GUIDE.md` | `Hua1Q1nG/dsh-prompt-self` | `plugin/` + `install/`（含 AGENTS.md、GLOBAL-UPDATE-GUIDE.md 的规范源） |
| dsh-prompt-dots | `profiles\node_modules\dsh-prompt-dots` | `prompt-dots\UPDATE-GUIDE.md` | `Hua1Q1nG/dsh-prompt-dots` | `lib/ + package.json + cordis.patch.yml` + `tests/` + `UPDATE-GUIDE.md` |
| dsh-token-monitor | `profiles\node_modules\dsh-token-monitor` | `token-monitor\UPDATE-GUIDE.md` | `Hua1Q1nG/dsh-token-monitor` | `lib/ + package.json + cordis.patch.yml` + `tests/` + `UPDATE-GUIDE.md` |
| dsh-pwsh-patch（本机专属补丁，自愈） | `profiles\node_modules\dsh-pwsh-patch` | `pwsh-patch\UPDATE-GUIDE.md` | —（本机专属，无仓库、不参与 GitHub 同步） | `lib/ + patch/ + cordis.patch.yml` + `tests/` + `UPDATE-GUIDE.md`（`<DSH_HOME>\pwsh-patch\`） |

**新插件登记规则**：用户安装新插件后，Agent 主动在本表追加一行（插件名、本地目录、是否有专属指南、
仓库地址、仓库内源目录），并在两个仓库的对应位置同步本表更新。无专属指南的新插件按第 4 节通用检查执行。

## 1.5 第 0 步：先自检自更新 dsh-global-updater（桌面更新后 / 用户告知已更新时必做）

1. 严格按 `$DSH_HOME/global-updater/UPDATE-GUIDE.md` 第 2 节执行：文件与语法 → API 面核对 →
   自更新（与本仓库比对并覆盖，重启生效）→ 自测 4/4 → 运行态（/global-updater/state 等）。
2. 也可以直接让用户在 **设置 →「全局插件更新」** 点击「更新全局插件」按钮 —— 宿主会自动执行
   同样的顺序（自更新优先，随后全部插件）；DSH 桌面版更新后启动时插件还会自动检测版本号变化并执行一次。
3. 本步骤通过后，再继续下面的环境级检查与逐插件流程。

## 2. 环境级检查（对全部插件生效，每次必做）

1. 版本判定：读 `<安装目录>\resources\app\package.json` 的 `version` 与
   `<安装目录>\resources\app\node_modules\@deepseek-ai\dsh\package.json` 的 `version`。
   - 仅桌面壳版本变化、核心依赖不变 → 各插件执行各自指南的「快速体检」；
   - 核心依赖变化 → 各插件执行各自指南的「完整体检 + API 面核对」。
2. 已知副作用检查：`settings.yaml` 的 `agent-presets.default` 必须是 `code-prompt-self`；
   若被 DSH 升级重置为 `code`，改回并提示用户重启应用。
3. 当前端口从 `%APPDATA%\dsh-desktop\logs\harness.log` 末尾的 `dsh web: http://...` 读取；
   首页 HTML 的 `window.__DSH_BOOT__` 图谱应包含登记表中每个插件名对应的条目（含 `dsh-prompt-self-client` 与
   `dsh-prompt-dots`），inject 与各自 package.json 的 `dsh.client.inject` 一致。

## 3. 自动发现部署的插件（不依赖登记表，防漏）

1. 扫描 `<DSH_HOME>\profiles\node_modules\` 下所有**真实目录**（非 junction/symlink、非 `@deepseek-ai/*`、
   非 `.pnpm`），其中 `package.json` 含 `dsh.client` 或 `dsh.bundle` 字段的即为用户插件；
2. 扫描 `<DSH_HOME>\profiles\web\cordis.patch.yml` 的所有 `insert` 条目（id/name 两两对应）；
3. 扫描 `<DSH_HOME>\.agent-presets\*\agent.cordis.yml` 中指向绝对路径/相对路径的插件行（如 prompt-self 引擎行）；
4. 合并结果并与登记表对照：发现登记表外的插件 → 先按第 4 节通用检查执行，再提示用户补登记。

## 4. 逐个插件执行

- **有专属指南的插件**（登记表第 3 列存在）→ 严格逐节执行该指南（快速体检或完整体检、API 面核对、
  测试套件、GitHub 同步），不得跳过；
- **无专属指南的新插件** → 执行通用检查：
  1. 插件包三个文件齐全（lib/*.js、package.json）且 `node --check` 语法通过；
  2. 接线完整：cordis.patch.yml 中有对应 insert 条目（或 package.json 声明了 `dsh.bundle.patch` 且已加入 profile bundles）；
  3. 宿主能解析：启动图谱含该插件条目（有 client 半边的还要 `GET /plugins/<包名>/client.js` 返回 200）；
  4. 其 host 半边若在 `.agent-presets` 挂载，确认预设行路径仍存在；
  5. 若发现依赖已不存在的 API → 对照同类插件指南的 API 面清单修复，修复后提示用户为该插件补写专属指南。

## 5. 同步 GitHub 仓库

对每个登记表中的插件：先比对「本地插件目录/指南文档」与「仓库」是否一致（优先用内容哈希或行尾归一化比较；
仓库副本可通过 Git Data API 下载到 `<DSH_HOME>\profiles\<插件>-repo` 后比对）。

- 无差异 → 跳过；
- 有差异 → 同步：先试普通 git push；失败则按 Git Data API 单提交上传（流程见各插件指南第 5 节）：
  1. 向用户索要 `repo` 权限短期 token（一次同步可复用一个，用完请用户撤销）；
  2. `GET /user` 校验 → 取 HEAD commit/tree → 逐文件 `POST .../git/blobs` → `POST .../git/trees`（base_tree 合并）→
     `POST .../git/commits` → `PATCH .../git/refs/heads/main`；
  3. 同步后报告仓库 URL 与提交摘要，提醒用户撤销 token。

共享文档同步规则：`AGENTS.md` 与 `GLOBAL-UPDATE-GUIDE.md` 的规范源在 `dsh-prompt-self` 仓库的 `install/` 目录；
镜像在 `dsh-global-updater` 与 `dsh-prompt-dots` 仓库。三者都必须同步到 `<DSH_HOME>`（`AGENTS.md` 与
`GLOBAL-UPDATE-GUIDE.md` 各一份），并在仓库间保持一致。插件登记表以 `<DSH_HOME>/global-updater/registry.json`
为机器可读源（dsh-global-updater 维护），本表与之对应。

## 6. 报告模板（Agent 向用户汇报用）

```
更新全局插件完成：
- 桌面版本：X → Y；核心依赖：Z（变化/不变）
- 发现的插件：…（登记表 N 个 + 新发现 M 个）
- 各插件体检：…（N/N 通过、异常与修复…）
- 测试套件：prompt-self 6/6、prompt-dots 3/3 …
- 运行态自检：图谱条目 / client bundle / 插件 API 端点 …
- 需要用户操作：重启应用 / 提供令牌 / 无
- GitHub 同步：各仓库 已同步 / 无需同步 / 待令牌
```
