# dsh-prompt-self 更新检测与升级指南

> 本文档是给 DSH Agent 执行的操作手册。用户每次更新 DSH 桌面版后，会把本文档交给 Agent；
> Agent 必须**逐节执行**下面的检测与修复，最后向用户报告结论，并在必要时同步 GitHub 仓库。
> 全局入口：`$DSH_HOME/GLOBAL-UPDATE-GUIDE.md`（「更新全局插件」触发词，Agent 会按总纲自动发现并逐个插件执行，包括本指南）。

## 0. 基线信息（当前已验证兼容的版本）

- DSH Desktop：0.2.0（曾验证 0.1.7 / 0.1.9）
- 核心依赖（全部 `@deepseek-ai/*`）：0.1.0-rc.6
- cordis：4.0.1
- 插件版本：dsh-prompt-self-client 0.2.0（画像分级版）
- GitHub 仓库：https://github.com/Hua1Q1nG/dsh-prompt-self（分支 main）
- 本机 DSH 家目录 `<DSH_HOME>`：`C:\Users\<用户名>\AppData\Roaming\dsh-desktop\harness`

## 1. 检测更新（第 1 步：判断发生了什么变化）

1. 读取桌面应用版本：`<安装目录>\resources\app\package.json` 的 `version`（安装目录通常是 `<安装目录>`，以实际为准）。
2. 读取 DSH 核心版本：`<安装目录>\resources\app\node_modules\@deepseek-ai\dsh\package.json` 的 `version`。
3. 读取 harness 侧版本：`<DSH_HOME>\profiles\node_modules\@deepseek-ai\dsh\package.json` 的 `version`。
4. 结论判定：
   - 仅桌面壳版本号变化、核心依赖不变（仍是 rc.6 系列）→ 大概率兼容，执行第 2 节的快速体检；
   - 核心依赖版本变化（rc.6 → rc.7 等）→ 必须执行第 3 节的完整体检，重点核对第 4 节的 API 面。

## 2. 快速体检（每次更新后必做）

逐项确认以下路径存在且内容完整（用文件工具读取，不要假设）：

| # | 检查项 | 路径（相对 `<DSH_HOME>`） |
|---|---|---|
| 1 | 插件包引擎 | `profiles\node_modules\dsh-prompt-self-client\lib\index.js` |
| 2 | 插件包客户端 | `profiles\node_modules\dsh-prompt-self-client\lib\client.js` |
| 3 | 插件包清单 | `profiles\node_modules\dsh-prompt-self-client\package.json` |
| 4 | web profile 补丁行 | `profiles\web\cordis.patch.yml` 中应含 `prompt-self-client` 行 |
| 5 | 用户预设 | `.agent-presets\code-prompt-self\agent.cordis.yml`（末尾应有 `prompt-self-client` 引擎行） |
| 6 | skill | `skills\prompt-self-optimizer\SKILL.md` |
| 7 | 画像文件 | `skills\prompt-self-optimizer\profile.md` |
| 8 | 全局指令 | `AGENTS.md` |
| 9 | 默认预设 | `settings.yaml` 中 `agent-presets.default` 必须是 `code-prompt-self` |
| 10 | PTC 预设引擎行（部署补丁） | `<安装目录>\resources\app\node_modules\@deepseek-ai\dsh\config\agent-presets\code\agent.cordis.yml` 末尾应有 `prompt-self-client` 引擎行（让 PTC 模式也运行引擎） |
| 11 | 事件类型白名单补丁（部署补丁） | `<安装目录>\resources\app\node_modules\@deepseek-ai\dsh-session\lib\index.js`（及 `lib\types\known-event-types.js`）的 `KNOWN_SESSION_EVENT_TYPES` 中必须含 `session/prompt-self-optimized` 与 `session/prompt-self-learned`；缺失时按第 2.2 节重打 |
| 12 | 学习记录档案 | `skills\prompt-self-optimizer\profile.records.md`（0.2.0 起，重启后首次学习自动生成） |

**已知更新副作用**：DSH Desktop 升级（如 0.1.7→0.1.9、0.1.9→0.2.0）曾把 `settings.yaml` 的
`agent-presets.default` 重置回 `code`（其余文件不受影响）。第 9 项若不等于
`code-prompt-self`，立即改回并提示用户重启应用（重启前新会话不会挂载引擎）。
另外桌面更新会整体替换 `<安装目录>\resources\app`，第 10 项的 PTC 预设部署补丁会随之丢失：
按第 10 项检查，缺失时按第 2.1 节模板重打（内置预设无法被用户预设同名覆盖，必须补丁应用安装目录）。

运行中应用的自检（可选但推荐）：
- `GET http://127.0.0.1:<当前端口>/prompt-self/profile` 应返回 200 且 `"ok":true`；
- `GET http://127.0.0.1:<当前端口>/prompt-self/config` 应返回 200 JSON；
- 首页 HTML 的 `window.__DSH_BOOT__` 图谱中应含 `dsh-prompt-self-client` 条目。
当前端口从 `%APPDATA%\dsh-desktop\logs\harness.log` 末尾的 `dsh web: http://...` 读取。

### 2.1 PTC 预设补丁重打模板（第 10 项缺失时）

在内置 PTC 预设 `<安装目录>\resources\app\node_modules\@deepseek-ai\dsh\config\agent-presets\code\agent.cordis.yml`
末尾追加引擎行（`name` 用正斜杠绝对路径，与 code-prompt-self 预设一致；路径按本机实际调整）：

```yaml
- id: prompt-self-client
  name: 'C:/Users/<用户>/AppData/Roaming/dsh-desktop/harness/profiles/node_modules/dsh-prompt-self-client/lib/index.js'
  config:
    enabled: true
    profilePath: 'C:/Users/<用户>/AppData/Roaming/dsh-desktop/harness/skills/prompt-self-optimizer/profile.md'
    provider: deepseek-official
    model: deepseek-v4-flash
    maxHabits: 20
    maxRules: 18
    maxRecords: 10
```

重打后用 js-yaml + `entryListSchema`（`@deepseek-ai/cordis-plugin-include`）校验该文件可解析，
并提示用户重启应用（预设发现会实时重读，但重启最稳妥）。

### 2.2 事件类型白名单补丁重打模板（第 11 项缺失时）

**背景（2026-08-17 排障结论）**：插件通过 `session.append` 向会话日志写入
`session/prompt-self-optimized` / `session/prompt-self-learned` 两类自定义事件。
宿主在**重启后 resume 旧会话**时，会用 `KNOWN_SESSION_EVENT_TYPES`（静态白名单）
逐事件校验：白名单外且未带 `ignorable: true` 标记的事件会触发
`SessionFormatUnsupportedError`，导致该会话**历史加载失败**（UI 文案「历史加载失败：…」），
且该会话的 `session.models` 一并失败（模型目录/切换不可用）。`session.append` 的公开签名
无法写入 `ignorable` 标记，因此必须通过白名单补丁解决。

补丁方式：在以下两个文件的 `KNOWN_SESSION_EVENT_TYPES` 数组内、`'session/end-seed'` 之后
插入两行：

```js
'session/prompt-self-learned',
'session/prompt-self-optimized',
```

- `<安装目录>\resources\app\node_modules\@deepseek-ai\dsh-session\lib\index.js`（运行期实际加载的导出副本）
- `<安装目录>\resources\app\node_modules\@deepseek-ai\dsh-session\lib\types\known-event-types.js`（保持源文件一致）

补丁需**重启应用**才生效（白名单在宿主进程启动时载入内存）。

**历史数据修复（一次性，已执行）**：2026-08-17 已对含插件事件的历史会话日志
（`sessions\--E-program~0028E~0029-DSH-DSH~0020Desktop--\` 下 5 个会话）执行过修复：
解压多帧 zstd 容器 → 为 `session/prompt-self-*` 事件行加 `"ignorable": true` → 重压缩，
原始文件备份为同目录 `session.jsonl.zstd.bak-2026-08-17T07-15-13`。
带 `ignorable` 标记的日志即使白名单补丁丢失也能正常 resume，无需再次修复。

### 2.3 画像分级（核心 + 学习记录档案；0.2.0 起）

0.2.0 起画像分为两级，学习不再把学习记录写回核心文件：

- `skills\prompt-self-optimizer\profile.md`：核心画像（习惯清单 + 防幻觉规则），改写调用只注入这部分；
- `skills\prompt-self-optimizer\profile.records.md`：学习记录档案（插件自动生成，容量 `maxRecords`）。

关键行为：
- 旧版单文件画像（含「## 学习记录」节）会在重启后首次学习时自动迁移：学习记录移入档案，核心文件不再保留该节；
- 改写调用注入的画像总长受 `maxProfileChars`（默认 6000 字符）截断保护；
- `maxHabits / maxRules / maxRecords` 需在用户预设引擎行与 PTC 内置补丁行（第 10 项）两处保持一致（当前 20 / 18 / 10）；
- 画像面板的「学习记录」读取档案文件；档案缺失且核心文件含旧学习记录时回退读取核心文件（等待首次学习迁移）。

## 3. 完整体检（核心依赖版本变化时必做）

1. 把 GitHub 仓库（或本机 `<DSH_HOME>\prompt-self\repo` 本地副本）放进任意能解析
   `@deepseek-ai/*` 依赖的目录（如 `<DSH_HOME>\profiles` 下），运行：
   ```
   node --test <仓库>\tests\engine.test.mjs
   ```
   期望：7 个用例全部通过（含画像分级与旧单文件迁移用例）。任一失败 → 对照第 4 节排查 API 变化，修复插件代码。
2. 无头实机 E2E（用真实 LLM 验证全链路）：
   ```
   <安装目录>\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js --profile headless --patch <临时补丁> "任务文本"
   ```
   临时补丁内容（profilePath 指向临时画像副本）：
   ```yaml
   - insert:
       - id: prompt-self-e2e
         name: file:///<DSH_HOME>/profiles/node_modules/dsh-prompt-self-client/lib/index.js
         config:
           enabled: true
           forceEngine: true
           profilePath: <临时画像副本绝对路径>
           provider: deepseek-official
           model: deepseek-v4-flash
   ```
   期望：会话日志出现 `session/prompt-self-optimized` 事件、画像新增学习记录。
   若事件缺失：
   - 辅助模型是推理型（如 deepseek-v4-flash 带 reasoning）时，`optimizeMaxTokens` 若太小
     （<800），推理会耗尽预算导致改写输出为空 → 引擎合法跳过。默认已调至 1200，
     若模型再次升级导致推理变长，继续调大该值（预设引擎行 config 或插件 defaultConfig）。
   - headless 一次性进程的「学习」调用可能在进程退出竞态中丢失凭据（MISSING_CREDENTIAL），
     属 headless 独有现象；桌面长驻应用不受影响。判定以 `prompt-self-optimized` 事件为准。

## 4. 插件依赖的 API 面清单（版本变化时逐项 grep 核对）

插件（`lib/index.js` 与 `lib/client.js`）依赖以下 DSH API。升级核心依赖后，用 grep 在
`<安装目录>\resources\app\node_modules\@deepseek-ai\<包>\lib\index.js` 核对每个符号仍存在：

| 包 | 依赖符号/机制 |
|---|---|
| @deepseek-ai/dsh-llm | `BlockAssembler`、`createUserMessage`、`ctx.get("llm").stream(options)`（options：provider/model/messages/system/maxTokens/sessionId/purpose/signal） |
| @deepseek-ai/dsh-scope | `scopeOf`、`scopeTarget`、`bindScopeParent`、`createScope` |
| @deepseek-ai/dsh-session | `session.events`、`session.append(type, data)`、事件类型 `user/message`（data.source.kind==="user"）、`turn/end` |
| @deepseek-ai/dsh-agent | `agent/pre-step` waterfall（payload 含 agent/messages/signal，返回 {kind:"enter", messages}） |
| @deepseek-ai/dsh-host-webserver | `ctx.inject(["webServer"])` → `webServer.register({kind:"exact", path, handler(req,res)})` |
| @deepseek-ai/dsh-skill-filesystem | 用户级 skill 目录 `<DSH_HOME>/skills/**/SKILL.md`（frontmatter: name+description） |
| @deepseek-ai/dsh-agent-instructions | 用户全局指令 `<DSH_HOME>/AGENTS.md` |
| @deepseek-ai/dsh-agent-presets | 用户预设目录 `<DSH_HOME>/.agent-presets/<id>/agent.cordis.yml`（id 匹配 `^[a-z0-9][a-z0-9-]*$`，行名可绝对路径/相对路径） |
| @deepseek-ai/dsh-client-modules | package.json `dsh.client`（platform/inject）+ `exports["./client"]`；bundle 注册 `window.__ModuleLoader__.load({id, factory})` |
| @deepseek-ai/dsh-client-runtime | 客户端服务 `slots`（SlotRegistry：`slots.inject(key, cb)` / `slots.register(spec, render)`） |
| @deepseek-ai/dsh-client-ui-slots | 槽位键：`settings.section`、`settings.<id>.item`、`conversation.input.dock` |
| @deepseek-ai/dsh-client-ui-settings | 设置面板按 `settings.section` 槽位渲染导航（label 支持函数） |
| @deepseek-ai/dsh-session-persistence-jsonl | 会话日志 `.jsonl.zstd`（多帧 zstd 容器，不解压也能通过 E2E 行为验证） |

若某个符号消失或签名变化：修改 `plugin/lib/index.js` / `plugin/lib/client.js` 适配新版本，
重跑第 3 节测试，通过后进入第 5 节同步仓库。

## 5. 同步 GitHub 仓库（插件或文档有改动时）

本机到 github.com 主站被网络阻断（git push / 设备码不可达），但 `api.github.com` 可达。
同步方式（已封装过，按此流程执行）：

1. 向用户索要一个有 `repo` 权限的短期 Personal Access Token（用完请用户撤销）。
2. 通过 Git Data API 单提交上传（不落盘令牌）：
   - 校验：`GET /user`（Authorization: token <令牌>）
   - 取 HEAD：`GET /repos/Hua1Q1nG/dsh-prompt-self/branches/main` → commit.sha →
     `GET /repos/Hua1Q1nG/dsh-prompt-self/git/commits/<sha>` → tree.sha
   - 每个文件：`POST /repos/Hua1Q1nG/dsh-prompt-self/git/blobs`
     {content: base64(utf8), encoding: "base64"}
   - 建树：`POST .../git/trees` {base_tree: <旧tree.sha>, tree: [{path, mode:"100644", type:"blob", sha}]}
   - 提交：`POST .../git/commits` {message, tree, parents: [<HEAD>]}
   - 更新引用：`PATCH .../git/refs/heads/main` {sha: <新commit>, force: false}
3. 完成后提示用户撤销令牌，并报告仓库 URL。

仓库结构（改动需同步到仓库的对应路径）：
```
plugin/                 ← <DSH_HOME>/profiles/node_modules/dsh-prompt-self-client/ 的源
install/code-prompt-self/          ← <DSH_HOME>/.agent-presets/code-prompt-self/ 的源
install/web-profile.cordis.patch.yml
install/skills/prompt-self-optimizer/    ← SKILL.md 与 profile.md 模板
install/AGENTS.md                ← <DSH_HOME>/AGENTS.md 的源
install/settings.yaml.example
tests/engine.test.mjs            ← 引擎自测套件
UPDATE-GUIDE.md（本文件）        ← 每次更新后请同步最新版
```

## 6. 报告模板（Agent 向用户汇报用）

```
更新检测完成：
- 桌面版本：X → Y；核心依赖：Z（变化/不变）
- 快速体检：N/N 通过；异常项与修复：…
- 完整体检（如执行）：测试 7/7，无头 E2E 事件：…
- 需要用户操作：重启应用 / 提供令牌 / 无
- GitHub 同步：已同步 / 无需同步 / 已请求令牌
```
