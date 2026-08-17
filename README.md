# dsh-prompt-self

个人 Prompt 画像引擎 —— 为 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 打造的**双面客户端插件**：在消息级自动改写你的 prompt、自动学习你的书写习惯，并提供可视化的开关与画像查看界面。

> 起因：希望 AI 能记住「我喜欢怎样的表达、经常省略哪些约束、哪些说法容易让它误解」，并在每次对话前自动补齐 —— 而不是早期那样，每次满意后还得自己敲一句 `-fin` 手动让 AI 记录（`-fin` 的来龙去脉见下文「关于 -fin」）。

## ✨ 特性

- **消息级自动改写**：每次发出新请求，引擎先用 LLM 按你的个人画像改写（消除歧义、补齐习惯性省略的约束、应用防幻觉规则），再把优化版注入给模型执行 —— 模型看到的、执行的始终是优化后的意图。
- **自动学习画像**：每次回合结束后，自动分析「原始请求 + 最终回答」，提炼你的书写习惯、防幻觉规则与优化经验，持续沉淀到画像文件 —— **不再需要 `-fin`**（仍保留 `-fin` 作为"立即学习并确认"的兼容触发）。
- **可视化控制**（设置 →「Prompt 画像」）：
  - 「自动改写优化」「自动学习画像」两个开关，即点即存、实时生效；
  - 画像三栏视图：习惯清单 / 防幻觉规则 / 学习记录（含计数、更新时间、折叠）；
  - 中英双语，跟随应用语言。
- **对话区快捷入口**：输入框上方常驻「● Prompt 画像 · 已开启」状态胶囊，点击弹出浮动面板，无需进设置即可查看/切换。
- **零侵入**：不改动 DSH 应用代码，全部通过官方扩展点安装（web profile 补丁 + 用户预设 + skill 文件 + AGENTS.md）。

### 关于 `-fin`（旧的手动反馈指令）

`-fin` 是本插件前身（prompt-self-optimizer 技能）时代留下的**手动反馈指令**：那时还没有自动学习，用户对某次回答满意，就要自己敲一句 `-fin`（可理解为「finish —— 这次不错，记下来」），AI 才会把刚才这组「请求 + 回答」学进画像。

它的痛点是：**每次都靠人记得敲，漏一次就少学一次**，还得多打一句话。于是本插件把这一步自动化——每次回合结束（turn/end）自动分析并学习，日常**不再需要 `-fin`**。

不过 `-fin` 仍被保留，作为**「立即学习 + 确认」的兼容触发**：哪怕把「自动学习画像」开关关掉了，敲一句 `-fin` 也能强制学习最近一次交互，并得到简短确认，老用户沿用旧习惯也不会失效。

## 🏗 工作原理

```
你发出 prompt
   │
   ▼
┌──────────────────────────────┐
│ 宿主引擎（Agent 层预设）      │
│  agent/pre-step 钩子          │
│  1. 读画像 profile.md          │
│  2. 读运行时开关 config.json   │
│  3. LLM 按画像改写 prompt      │
│  4. 注入「优化后的请求」消息   │
└──────────────────────────────┘
   │
   ▼
模型以优化版为准执行 ──→ 回合结束（turn/end）
                             │
                             ▼
                  ┌──────────────────────────┐
                  │ 自动学习：LLM 分析         │
                  │ (请求, 输出) → 合并画像    │
                  │ 习惯清单 / 防幻觉规则 / 学习记录 │
                  └──────────────────────────┘

浏览器半边（dsh.client）
  ├─ 设置页「Prompt 画像」：开关 + 画像查看
  └─ 对话输入坞：状态胶囊 + 弹出面板
        ↕ 通过宿主侧 Web 路由读写
  GET  /prompt-self/profile   画像 + 开关状态
  GET/POST /prompt-self/config  开关读写
```

## 📁 目录结构

```
.
├── package.json                     # 插件清单（dsh.bundle + dsh.client 声明与导出）
├── cordis.patch.yml                 # bundle 补丁（安装入口，加载宿主半边）
├── lib/
│   ├── index.js                     # 宿主引擎（改写/学习/路由/开关）
│   └── client.js                    # 浏览器半边（设置页 + 输入坞 UI）
├── install/                         # 安装材料
│   ├── code-prompt-self/            # 用户预设（code 预设副本 + 引擎行）
│   │   ├── agent.cordis.yml
│   │   └── prompt-self/             # 引擎内嵌副本（预设按相对路径加载）
│   ├── web-profile.cordis.patch.yml # 追加到 web profile 补丁层
│   ├── skills/prompt-self-optimizer/SKILL.md   # 画像查看/解释 skill
│   ├── AGENTS.md                    # 用户全局指令（注入每个会话）
│   └── settings.yaml.example        # 默认预设切换示例
└── tests/
    └── engine.test.mjs              # 引擎自测套件（6 组用例，mock LLM）
```
## 📦 安装（DSH Desktop，Windows）

> 约定：`<DSH_HOME>` 为 DSH 家目录。DSH Desktop 默认为
> `C:\Users\<你>\AppData\Roaming\dsh-desktop\harness`；其余部署通常为 `~/.dsh`。

### 0. 插件市场一键安装（推荐）

插件已声明 `dsh.bundle` 与 `dsh.client`，可直接从 GitHub 源码安装：

```sh
dsh plugin --profile web add github:Hua1Q1nG/dsh-prompt-self
```

这一步装好「宿主层 Web 路由 + 设置页 Prompt 画像 + 对话输入坞」。要启用消息级改写与自动学习引擎，
还需安装用户预设（下面第 3 步）——引擎运行在 Agent 层，与 web profile 半边是双面结构。

### 1. 复制插件包到 web profile

把 `package.json`、`cordis.patch.yml` 与 `lib/` 复制到 `<DSH_HOME>\profiles\node_modules\dsh-prompt-self-client\`：

这一步让 web profile 的插件行可以通过裸包名 `dsh-prompt-self-client` 解析到插件，并由模块系统把浏览器半边提供给 Web GUI。

### 2. 在 web profile 补丁层注册插件行

把 `install/web-profile.cordis.patch.yml` 的内容追加到 `<DSH_HOME>\profiles\web\cordis.patch.yml`。

### 3. 安装用户预设并切换默认

```powershell
robocopy "install\code-prompt-self" "<DSH_HOME>\.agent-presets\code-prompt-self" /E
```

再编辑 `<DSH_HOME>\settings.yaml`，把默认预设切换为 `code-prompt-self`（见 `install/settings.yaml.example`）。

> 引擎行的 `name: './prompt-self/lib/index.js'` 按预设目录内的内嵌副本相对解析，开箱即用；
> 若你希望与第 1 步的公共副本共用一份（避免两处维护），可改为
> `name: '../../profiles/node_modules/dsh-prompt-self-client/lib/index.js'`，
> 或直接写绝对路径。

### 4. 安装 skill 与全局指令（可选但推荐）

```powershell
robocopy "install\skills\prompt-self-optimizer" "<DSH_HOME>\skills\prompt-self-optimizer" /E
copy install\AGENTS.md "<DSH_HOME>\AGENTS.md"
```

- `SKILL.md`：让模型在用户要求查看/解释画像时知道去哪读、怎么讲；
- `AGENTS.md`：用户全局指令，确保模型以插件注入的优化版为准、不自行重复优化、不篡改画像文件。

### 5. 重启并验证

完全退出并重启 DSH Desktop，然后：

1. 打开**设置 →「Prompt 画像」**，确认开关与画像三栏正常显示；
2. 输入框上方出现「● Prompt 画像 · 已开启」胶囊；
3. 随便发一条消息，观察回答是否符合画像习惯；回合结束后刷新画像页，「学习记录」应自动新增条目。

## 🎛 使用

| 入口 | 位置 | 能力 |
|---|---|---|
| 状态胶囊 | 对话输入框上方 | 一眼看清引擎状态（绿=全开/黄=部分/灰=暂停），点击弹出面板快速切换 |
| 设置页 | 设置 →「Prompt 画像」 | 开关 + 画像完整视图 + 刷新 |
| 语言 | `-fin`（可选） | 立即学习最近一次交互并简短确认（自动学习已覆盖日常场景） |
| 查看画像 | 对话里说「看看我的画像」 | 模型经 skill 读取并展示画像 |

## ⚙️ 配置

### 预设引擎行（Agent 层）

```yaml
- id: prompt-self-client
  name: './prompt-self/lib/index.js'
  config:
    enabled: true            # 主开关（组合级）
    provider: deepseek-official
    model: deepseek-v4-flash # 辅助调用模型（改写/学习，建议用快模型）
```

完整配置项（均有默认值，均可省略）：

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 组合级主开关 |
| `forceEngine` | `false` | 单组合（无预设作用域）profile 下强制启用引擎（测试用） |
| `profilePath` | `<DSH_HOME>/skills/prompt-self-optimizer/profile.md` | 画像文件路径 |
| `recordsPath` | `<DSH_HOME>/skills/prompt-self-optimizer/profile.records.md` | 学习记录档案路径（默认自动推导，0.2.0） |
| `statePath` | `profilePath + ".state.json"` | 已学习配对去重状态 |
| `configPath` | `profilePath + ".config.json"` | 运行时开关文件 |
| `provider` / `model` | `deepseek-official` / `deepseek-v4-flash` | 辅助 LLM 路由 |
| `optimizeMaxTokens` | `1200` | 改写输出上限（推理型辅助模型需留出推理余量） |
| `learnMaxTokens` | `3200` | 学习输出上限 |
| `optimizeTimeoutMs` / `learnTimeoutMs` | `30000` / `120000` | 调用超时 |
| `maxPromptChars` / `maxOutputChars` | `6000` / `10000` | 学习样本截断 |
| `maxHabits` / `maxRules` / `maxRecords` | `40` / `40` / `30`（预设行已设 `20 / 18 / 10`） | 画像容量上限 |
| `maxProfileChars` | `6000` | 改写调用注入画像的总长截断（字符，0.2.0） |

### 运行时开关（可视化 UI 写入）

`profile.md.config.json`（由开关 UI 自动维护）：

```json
{ "optimizeEnabled": true, "learnEnabled": true, "model": "deepseek-v4-flash" }
```

引擎按 mtime 缓存读取，**改动即时生效，无需重启**；`-fin` 显式学习不受 `learnEnabled` 限制。

### Web 路由（宿主层）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/prompt-self/profile` | GET | 画像三栏 + 开关状态 + 更新时间 |
| `/prompt-self/config` | GET / POST | 运行时开关读取 / 写入（POST body：`{optimizeEnabled?, learnEnabled?, model?}`） |

## 🧪 测试

`tests/engine.test.mjs` 使用真实 cordis 作用域与调度语义 + mock LLM，覆盖：注入与缓存复用、跨会话作用域隔离、turn/end 自动学习、`-fin` 强制学习、运行时开关、Web 路由处理器。

运行前提：`@deepseek-ai/*` 依赖可从测试文件的 `node_modules` 祖先目录解析（把仓库放进任意 DSH profile 目录，或已安装 DSH 依赖的环境）：

```powershell
cd <DSH_HOME>\profiles
node --test <仓库路径>\tests\engine.test.mjs
```

## ❓ FAQ

**优化后的 prompt 我看不到？** 注入发生在模型侧（消息级改写），原始消息仍按你的原话展示；会话日志中留有 `session/prompt-self-optimized` 事件可查。若希望模型说明依据，可在画像中追加相关习惯。

**为什么某次回答没有按画像优化？** 检查：主开关 `enabled`（预设行）与「自动改写优化」开关；画像为空（无任何习惯/规则/记录）时会跳过改写；辅助模型调用失败时引擎会静默放行原始请求（不阻塞对话）。

**想暂停一切？** 设置页关掉两个开关，或把预设行的 `enabled` 改为 `false` 后重启。

**画像文件在哪？** `<DSH_HOME>/skills/prompt-self-optimizer/profile.md`（核心画像：习惯清单 + 防幻觉规则，可手动编辑；学习记录由插件自动维护在同目录 `profile.records.md`）。

**换机器 / 升级 DSH 后？** 重新执行安装步骤；若 DSH 自带的 `code` 预设更新，建议以新版为基准重做 `install/code-prompt-self/agent.cordis.yml`（只多了末尾的引擎行）。

**注意**：若在插件管理里执行 pnpm 安装操作，未登记依赖的 `dsh-prompt-self-client` 目录可能被清理，重新执行第 1 步即可。

## 📄 许可

[MIT](./LICENSE)
