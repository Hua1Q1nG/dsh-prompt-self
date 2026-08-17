/**
 * dsh-prompt-self-client — 个人 Prompt 画像引擎（双面客户端插件的宿主侧）。
 *
 * 安装方式：
 *  - 宿主层（web profile 行）：仅提供浏览器侧客户端插件（dsh.client），apply 直接返回；
 *  - Agent 层（自定义预设行，绝对路径挂载）：运行引擎 —
 *      1. agent/pre-step：对最新用户请求做消息级自动改写（LLM + 画像），以插件消息注入模型上下文；
 *      2. session/event(turn/end)：自动分析（用户请求, 最终输出）并更新画像，彻底替代 -fin。
 */
import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
import { scopeOf } from "@deepseek-ai/dsh-scope";

const name = "prompt-self-client";
const PLUGIN = "dsh-prompt-self-client";

// ── helpers ─────────────────────────────────────────────────────────────────

function defaultConfig() {
  return {
    enabled: true,
    forceEngine: false,
    profilePath: undefined,
    statePath: undefined,
    recordsPath: undefined,
    provider: "deepseek-official",
    model: "deepseek-v4-pro",
    optimizeMaxTokens: 1200,
    learnMaxTokens: 3200,
    optimizeTimeoutMs: 30000,
    learnTimeoutMs: 120000,
    maxPromptChars: 6000,
    maxOutputChars: 10000,
    maxProfileChars: 6000,
    maxHabits: 40,
    maxRules: 40,
    maxRecords: 30
  };
}

function defaultProfilePath() {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(home, "skills", "prompt-self-optimizer", "profile.md");
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function isFinCommand(text) {
  return /^\s*-\s*fin\b/i.test(text);
}

function normalize(text) {
  return text.replace(/\s+/g, "");
}

function truncate(text, maxChars) {
  const value = String(text ?? "");
  if (value.length <= maxChars) return value;
  return value.slice(0, Math.max(0, maxChars - 3)) + "...";
}

/** 提取消息的文本内容（连接全部 text 块）。 */
function messageText(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return undefined;
  const parts = [];
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  const text = parts.join("\n\n").trim();
  return text.length > 0 ? text : undefined;
}

/** 去掉代码围栏与包裹引号。 */
function cleanOutput(raw) {
  let text = raw.trim();
  const fence = text.match(/^`{3}[a-zA-Z]*\s*\n([\s\S]*?)\n`{3}$/);
  if (fence) text = fence[1].trim();
  if (text.length > 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).trim();
  return text;
}

/** 从入站声明消息里找到最后一条真实用户消息（pre-step 时 session.events 可能尚未更新，claim 更可靠）。 */
function latestUserMessageFromClaim(messages) {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user" || message?.source?.kind !== "user") continue;
    const text = messageText(message);
    if (text === undefined) continue;
    return { id: typeof message.id === "string" && message.id.length > 0 ? message.id : "claim-" + i, text };
  }
  return undefined;
}

/** 从会话事件流找到最后一条真实用户消息（携带消息 id 作为稳定缓存键）。 */
function latestUserPrompt(session) {
  const events = session?.events;
  if (!Array.isArray(events)) return undefined;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type !== "user/message") continue;
    if (event.data?.source?.kind !== "user") continue;
    const text = messageText(event.data);
    if (text === undefined) continue;
    const id = typeof event.data?.id === "string" && event.data.id.length > 0 ? event.data.id : "seq-" + i;
    return { seq: i, id, text };
  }
  return undefined;
}

/** 收集最近一组（用户请求, 最终回答）；跳过 -fin 与无输出回合。
 *  若最后一条用户消息是 -fin，则把 -fin 之前的真实请求与其回答配对（-fin 自身的回复不计入）。 */
function collectPair(session, maxPromptChars, maxOutputChars) {
  const events = session?.events;
  if (!Array.isArray(events)) return undefined;
  let lastAnyIdx = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type !== "user/message" || event.data?.source?.kind !== "user") continue;
    if (messageText(event.data) === undefined) continue;
    lastAnyIdx = i;
    break;
  }
  if (lastAnyIdx < 0) return undefined;
  let userIdx;
  let bound;
  if (isFinCommand(messageText(events[lastAnyIdx].data))) {
    userIdx = -1;
    for (let i = lastAnyIdx - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event?.type !== "user/message" || event.data?.source?.kind !== "user") continue;
      const text = messageText(event.data);
      if (text === undefined || isFinCommand(text)) continue;
      userIdx = i;
      break;
    }
    if (userIdx < 0) return undefined;
    bound = lastAnyIdx;
  } else {
    userIdx = lastAnyIdx;
    bound = events.length;
  }
  let assistantIdx = -1;
  for (let i = bound - 1; i > userIdx; i -= 1) {
    if (events[i]?.type === "assistant/message") {
      assistantIdx = i;
      break;
    }
  }
  if (assistantIdx < 0) return undefined;
  const userText = truncate(messageText(events[userIdx].data) ?? "", maxPromptChars);
  const assistantText = truncate(messageText(events[assistantIdx].data?.message) ?? "", maxOutputChars);
  if (userText.length === 0 || assistantText.length === 0) return undefined;
  return { userIdx, assistantIdx, userText, assistantText };
}

function resolveRoute(cfg, rt) {
  return { provider: cfg.provider, model: rt !== undefined && rt.model.length > 0 ? rt.model : cfg.model };
}

function withTimeout(signal, timeoutMs) {
  if (signal !== undefined && signal !== null) return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  return AbortSignal.timeout(timeoutMs);
}

/** 流式调用 LLM 并返回纯文本；失败/中止返回 undefined。 */
async function streamText(ctx, options) {
  let assembler;
  try {
    assembler = new BlockAssembler();
    for await (const chunk of ctx.get("llm").stream(options)) assembler.push(chunk);
  } catch (error) {
    ctx.logger.warn(PLUGIN + ": llm stream failed: " + (error instanceof Error ? error.message : String(error)));
    return undefined;
  }
  const finish = assembler.finish;
  if (finish !== undefined && finish.reason?.kind === "aborted") return undefined;
  if (finish !== undefined && finish.reason?.kind === "error") {
    ctx.logger.warn(PLUGIN + ": llm call error: " + JSON.stringify(finish.reason));
    return undefined;
  }
  const blocks = assembler.blocks();
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return text.length > 0 ? text : undefined;
}

// ── 画像解析 / 合并 ──────────────────────────────────────────────────────────

const PROFILE_INTRO = "# 个人 Prompt 画像（由 " + PLUGIN + " 自动维护）\n\n> 本文件由客户端插件 " + PLUGIN + " 自动维护：每次交互结束后自动学习更新；每次收到新请求前自动按此优化 prompt。\n> 可手动编辑，但请保持下方两个章节结构（学习记录由插件自动写入 profile.records.md）。";

function parseProfile(text) {
  const habits = [];
  const rules = [];
  const records = [];
  let section = "";
  let current;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("## 习惯清单")) { section = "habits"; continue; }
    if (line.startsWith("## 防幻觉规则")) { section = "rules"; continue; }
    if (line.startsWith("## 学习记录")) { section = "records"; continue; }
    if (line.startsWith("## ")) { section = ""; continue; }
    if (line.startsWith("### ")) {
      if (section === "records") { current = [line]; records.push(current); }
      continue;
    }
    if (line.startsWith("- ")) {
      const content = line.slice(2).trim();
      if (content.length === 0) continue;
      if (section === "habits") habits.push(content);
      else if (section === "rules") rules.push(content);
      else if (section === "records" && current !== undefined) current.push(content);
    }
  }
  return { habits, rules, records };
}

function hasRules(profileText) {
  const parsed = parseProfile(profileText);
  return parsed.habits.length > 0 || parsed.rules.length > 0 || parsed.records.length > 0;
}

function sameHabit(existing, habit) {
  const a = normalize(existing);
  const b = normalize(habit);
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}

function parseAnalysis(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (parsed && typeof parsed === "object") {
        const habits = (Array.isArray(parsed.habits) ? parsed.habits : [])
          .map((h) => typeof h === "string" ? { habit: h, action: "" } : typeof h?.habit === "string" ? { habit: h.habit, action: typeof h.action === "string" ? h.action : "" } : undefined)
          .filter((h) => h !== undefined);
        const rules = (Array.isArray(parsed.hallucinationRules) ? parsed.hallucinationRules : []).filter((r) => typeof r === "string");
        const entry = parsed.entry && typeof parsed.entry === "object" ? parsed.entry : {};
        return {
          habits,
          rules,
          entry: {
            date: today(),
            promptSummary: truncate(typeof entry.promptSummary === "string" ? entry.promptSummary : "", 160),
            outputSummary: truncate(typeof entry.outputSummary === "string" ? entry.outputSummary : "", 160),
            insights: truncate(typeof entry.insights === "string" ? entry.insights : "", 500),
            rules: (Array.isArray(entry.rules) ? entry.rules : []).filter((r) => typeof r === "string").slice(0, 5)
          }
        };
      }
    } catch {}
  }
  return {
    habits: [],
    rules: [],
    entry: { date: today(), promptSummary: "", outputSummary: "", insights: truncate(raw, 500), rules: [] }
  };
}

function mergeParsed(parsed, records, analysis, cfg) {
  for (const h of analysis.habits) {
    const line = h.action.length > 0 ? h.habit + " → " + h.action : h.habit;
    if (!parsed.habits.some((existing) => sameHabit(existing, h.habit))) parsed.habits.push(line);
  }
  parsed.habits = parsed.habits.slice(-cfg.maxHabits);
  for (const r of analysis.rules) {
    if (!parsed.rules.some((existing) => normalize(existing) === normalize(r))) parsed.rules.push(r);
  }
  parsed.rules = parsed.rules.slice(-cfg.maxRules);
  const entry = analysis?.entry;
  if (entry !== undefined && entry !== null && typeof entry === "object") {
    const safeRules = Array.isArray(entry.rules) ? entry.rules : [];
    const header = "### " + (entry.date || today()) + " · " + truncate(entry.promptSummary || "交互学习", 30);
    const lines = [];
    if (entry.promptSummary) lines.push("- 原始请求：" + entry.promptSummary);
    if (entry.outputSummary) lines.push("- 输出摘要：" + entry.outputSummary);
    if (entry.insights) lines.push("- 分析：" + entry.insights);
    if (safeRules.length > 0) lines.push("- 提炼规则：" + safeRules.join("；"));
    records.unshift([header, ...lines]);
    records = records.slice(0, cfg.maxRecords);
  }
  return { habits: parsed.habits, rules: parsed.rules, records };
}

/** 兼容旧调用：单文件画像整体合并（输出核心 + 学习记录）。 */
function mergeProfile(profileText, analysis, cfg) {
  const parsed = parseProfile(profileText);
  const merged = mergeParsed(parsed, parsed.records, analysis, cfg);
  return renderProfile({ habits: merged.habits, rules: merged.rules, records: merged.records });
}

/** 分级合并：核心画像（习惯/规则）与学习记录档案分别生成。 */
function mergeProfilePair(profileText, recordsText, analysis, cfg) {
  const parsed = parseProfile(profileText);
  const records = parseProfile(recordsText).records;
  const merged = mergeParsed(parsed, records, analysis, cfg);
  return { core: renderCore(merged), records: renderRecords(merged) };
}

/** 学习记录档案路径：profile.md → profile.records.md（画像分级：核心 + 档案）。 */
function defaultRecordsPath(profilePath) {
  const p = String(profilePath ?? "");
  const idx = p.lastIndexOf(".");
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return (idx > slash ? p.slice(0, idx) : p) + ".records.md";
}

/** 核心画像：介绍 + 习惯清单 + 防幻觉规则（改写调用只注入这部分）。 */
function renderCore(parsed) {
  const blocks = [PROFILE_INTRO, "", "## 习惯清单", "<!-- 每条一行：习惯描述 → 优化动作 -->"];
  for (const h of parsed.habits) blocks.push("- " + h);
  if (parsed.habits.length === 0) blocks.push("- （暂无记录）");
  blocks.push("", "## 防幻觉规则", "<!-- 与 AI 交互中的防错约定 -->");
  for (const r of parsed.rules) blocks.push("- " + r);
  if (parsed.rules.length === 0) blocks.push("- （暂无记录）");
  return blocks.join("\n") + "\n";
}

/** 学习记录档案（独立文件，不参与改写）。 */
function renderRecords(parsed) {
  const blocks = ["## 学习记录", "<!-- 按时间倒序，由插件自动追加 -->"];
  if (parsed.records.length === 0) blocks.push("", "- （暂无记录）");
  else for (const record of parsed.records) blocks.push("", ...record);
  return blocks.join("\n") + "\n";
}

/** 兼容输出：核心 + 学习记录（供旧调用方与测试使用）。 */
function renderProfile(parsed) {
  return renderCore(parsed).trimEnd() + "\n\n" + renderRecords(parsed);
}

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

/** 运行时开关（由可视化 UI 写入 config.json）；按 mtime 缓存，缺省全开。 */
const runtimeConfigCache = new Map();
async function readRuntimeConfig(configPath) {
  try {
    const info = await stat(configPath);
    const cached = runtimeConfigCache.get(configPath);
    if (cached !== undefined && cached.mtimeMs === info.mtimeMs) return cached.value;
    const value = JSON.parse(await readFile(configPath, "utf8"));
    const normalized = {
      optimizeEnabled: value?.optimizeEnabled !== false,
      learnEnabled: value?.learnEnabled !== false,
      model: typeof value?.model === "string" && value.model.length > 0 ? value.model : ""
    };
    runtimeConfigCache.set(configPath, { mtimeMs: info.mtimeMs, value: normalized });
    return normalized;
  } catch {
    return { optimizeEnabled: true, learnEnabled: true, model: "" };
  }
}

async function loadState(statePath) {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.pairs && typeof parsed.pairs === "object") return parsed.pairs;
  } catch {}
  return {};
}

// ── LLM 调用构造 ─────────────────────────────────────────────────────────────

function optimizeSystem(profile, maxProfileChars) {
  const safe = typeof maxProfileChars === "number" && maxProfileChars > 0 ? truncate(profile, maxProfileChars) : profile;
  return [
    "你是我的个人 prompt 优化助手。下面是我的个人画像（依据历史交互自动积累）：",
    "",
    "<profile>",
    safe,
    "</profile>",
    "",
    "任务：把我的原始请求改写为更精确、无歧义的版本。",
    "规则：",
    "1. 不改变请求的根本目标，不新增用户未要求的内容或功能；",
    "2. 依据画像补齐我习惯性省略的约束（语言、格式、技术栈、范围、验收标准等），消除歧义；",
    "3. 应用画像中的防幻觉规则；",
    "4. 输出语言与原始请求保持一致；",
    "5. 只输出改写后的请求文本本身，不超过200字，禁止任何解释、引号、代码块或前后缀；若原请求已足够清晰，原样输出。"
  ].join("\n");
}

function learnSystem() {
  return [
    "你是我的个人 prompt 学习助手。根据一组「用户原始请求 + AI 最终回答」，分析并输出严格 JSON（不要输出 JSON 之外的任何内容）。",
    "",
    'JSON 结构：{"habits":[{"habit":"用户书写习惯描述","action":"下次优化动作"}],"hallucinationRules":["防幻觉/防误解规则"],"entry":{"date":"YYYY-MM-DD","promptSummary":"原始请求摘要(≤40字)","outputSummary":"最终回答摘要(≤40字)","insights":"分析结论(≤120字)：表面意思 vs 真实意图、省略项、歧义点、误解风险","rules":["提炼的优化规则1-3条"]}}',
    "",
    "要求：",
    "1. habits 只记录在本组交互中确实观察到的习惯（0-3 条）；",
    "2. 全部内容使用中文；",
    "3. date 使用今天的日期。"
  ].join("\n");
}

function optimizedFrame(optimized) {
  return [
    "以下内容是你最新收到的用户请求的自动优化版本（由个人画像插件 " + PLUGIN + " 生成：消除歧义、补齐习惯性省略的约束、防止误解与幻觉）。",
    "请以优化版本为准执行；不要向用户复述优化过程。仅当优化补上的假设会显著改变结果时，用一句话向用户说明依据。",
    "",
    "<optimized_prompt>",
    optimized,
    "</optimized_prompt>"
  ].join("\n");
}

function hasInjection(messages) {
  return messages.some((m) => m?.source?.kind === "plugin" && m.source.plugin === PLUGIN && m.source.form === "prompt-self-optimized");
}

// ── Web 路由（可视化开关与画像查看）─────────────────────────────────────────

function jsonResponse(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleProfileRoute(req, res, profilePath, configPath, recordsPath) {
  if (req.method !== "GET") {
    jsonResponse(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  try {
    const recordsTarget = recordsPath ?? defaultRecordsPath(profilePath);
    const text = await readText(profilePath);
    const recordsText = await readText(recordsTarget);
    const parsed = parseProfile(text);
    const recParsed = parseProfile(recordsText);
    const records = recParsed.records.length > 0 ? recParsed.records : parsed.records;
    const rt = await readRuntimeConfig(configPath);
    const info = await stat(profilePath).catch(() => undefined);
    jsonResponse(res, 200, {
      ok: true,
      habits: parsed.habits,
      rules: parsed.rules,
      records,
      optimizeEnabled: rt.optimizeEnabled,
      learnEnabled: rt.learnEnabled,
      model: rt.model,
      updatedAt: info?.mtimeMs ?? 0
    });
  } catch (error) {
    jsonResponse(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleConfigRoute(req, res, profilePath, configPath) {
  try {
    const current = await readRuntimeConfig(configPath);
    if (req.method === "GET") {
      jsonResponse(res, 200, { ok: true, ...current });
      return;
    }
    if (req.method === "POST") {
      const raw = await readRequestBody(req);
      const patch = raw.length === 0 ? {} : JSON.parse(raw);
      const next = {
        optimizeEnabled: typeof patch.optimizeEnabled === "boolean" ? patch.optimizeEnabled : current.optimizeEnabled,
        learnEnabled: typeof patch.learnEnabled === "boolean" ? patch.learnEnabled : current.learnEnabled,
        model: typeof patch.model === "string" && patch.model.length > 0 ? patch.model : current.model
      };
      await mkdir(dirname(configPath), { recursive: true });
      const tmp = configPath + ".tmp";
      await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
      await rename(tmp, configPath);
      runtimeConfigCache.delete(configPath);
      jsonResponse(res, 200, { ok: true, ...next });
      return;
    }
    jsonResponse(res, 405, { ok: false, error: "method not allowed" });
  } catch (error) {
    jsonResponse(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function installWebRoutes(ctx, profilePath, configPath, recordsPath) {
  ctx.inject(["webServer"], (sctx) => {
    const server = sctx.get("webServer");
    sctx.effect(() => server.register({
      kind: "exact",
      path: "/prompt-self/profile",
      handler: (req, res) => handleProfileRoute(req, res, profilePath, configPath, recordsPath)
    }), "prompt-self: profile route");
    sctx.effect(() => server.register({
      kind: "exact",
      path: "/prompt-self/config",
      handler: (req, res) => handleConfigRoute(req, res, profilePath, configPath)
    }), "prompt-self: config route");
  });
}

// ── 插件主体 ────────────────────────────────────────────────────────────────

function apply(ctx, config = {}) {
  const cfg = { ...defaultConfig(), ...config };
  const profilePath = cfg.profilePath ?? defaultProfilePath();
  const recordsPath = cfg.recordsPath ?? defaultRecordsPath(profilePath);
  const statePath = cfg.statePath ?? profilePath + ".state.json";
  const configPath = cfg.configPath ?? profilePath + ".config.json";
  if (scopeOf(ctx) === undefined && cfg.forceEngine !== true) {
    ctx.logger.info(PLUGIN + ": host layer active (web routes + browser half; engine lives in the agent preset layer)");
    installWebRoutes(ctx, profilePath, configPath, recordsPath);
    return;
  }
  if (scopeOf(ctx) === undefined && cfg.forceEngine === true) {
    ctx.logger.info(PLUGIN + ": forceEngine — engine active in a single-composition (unscoped) profile");
  }
  const lastOptimized = new WeakMap();
  const optimizeCache = new WeakMap();
  const lastLearned = new WeakMap();
  const learnTails = new WeakMap();
  const state = { pairs: new Map() };
  let writeTail = Promise.resolve();
  loadState(statePath).then((pairs) => {
    for (const [k, v] of Object.entries(pairs)) state.pairs.set(k, v);
  }).catch(() => {});
  ctx.logger.info(PLUGIN + ": engine active (profile: " + profilePath + ")");

  function persist(text, target) {
    writeTail = writeTail.catch(() => {}).then(async () => {
      await mkdir(dirname(target), { recursive: true });
      const tmp = target + ".tmp";
      await writeFile(tmp, text, "utf8");
      await rename(tmp, target);
    });
    return writeTail;
  }

  function scheduleLearn(session, force = false) {
    const prev = learnTails.get(session) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => learnOnce(session, force));
    learnTails.set(session, next);
  }

  async function learnOnce(session, force) {
    try {
      const pair = collectPair(session, cfg.maxPromptChars, cfg.maxOutputChars);
      if (pair === undefined) return;
      const key = pair.userIdx + ":" + pair.assistantIdx;
      if (!force && (lastLearned.get(session) === key || state.pairs.get(session.id) === key)) return;
      const rt = await readRuntimeConfig(configPath);
      if (!force && rt.learnEnabled === false) return;
      const analysis = await runLearn(session, pair, rt);
      if (analysis === undefined) return;
      const profileText = await readText(profilePath);
      let recordsText = await readText(recordsPath);
      const fileRecords = parseProfile(recordsText).records;
      const legacyRecords = parseProfile(profileText).records;
      if (fileRecords.length === 0 && legacyRecords.length > 0) {
        recordsText = renderRecords({ habits: [], rules: [], records: legacyRecords });
      }
      const merged = mergeProfilePair(profileText, recordsText, analysis, cfg);
      await persist(merged.core, profilePath);
      await persist(merged.records, recordsPath);
      lastLearned.set(session, key);
      state.pairs.set(session.id, key);
      if (state.pairs.size > 64) state.pairs.delete(state.pairs.keys().next().value);
      await persist(JSON.stringify({ pairs: Object.fromEntries(state.pairs) }, null, 2), statePath);
      try {
        session.append("session/prompt-self-learned", { userSeq: pair.userIdx, assistantSeq: pair.assistantIdx, habits: analysis.habits.length, rules: analysis.rules.length });
      } catch (error) {
        ctx.logger.warn(PLUGIN + ": append learned event failed: " + (error instanceof Error ? error.message : String(error)));
      }
    } catch (error) {
      ctx.logger.warn(PLUGIN + ": learning failed");
      ctx.logger.warn(error);
    }
  }

  async function runOptimize(session, text, signal) {
    const rt = await readRuntimeConfig(configPath);
    const route = resolveRoute(cfg, rt);
    const profileText = await readText(profilePath);
    const coreText = renderCore(parseProfile(profileText));
    const result = await streamText(ctx, {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({
        content: [{ type: "text", text: "用户的原始请求：\n" + truncate(text, cfg.maxPromptChars) }],
        source: { kind: "plugin", plugin: PLUGIN }
      })],
      system: optimizeSystem(coreText, cfg.maxProfileChars),
      maxTokens: cfg.optimizeMaxTokens,
      sessionId: session.id,
      purpose: "prompt-self-optimize",
      signal: withTimeout(signal, cfg.optimizeTimeoutMs)
    });
    if (result === undefined) return undefined;
    const cleaned = cleanOutput(result);
    if (cleaned.length === 0 || normalize(cleaned) === normalize(text)) return undefined;
    return cleaned;
  }

  async function runLearn(session, pair, rt) {
    const route = resolveRoute(cfg, rt ?? { model: "" });
    const result = await streamText(ctx, {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({
        content: [{ type: "text", text: [
          "用户原始请求：",
          "---",
          pair.userText,
          "---",
          "AI 最终回答：",
          "---",
          pair.assistantText,
          "---"
        ].join("\n") }],
        source: { kind: "plugin", plugin: PLUGIN }
      })],
      system: learnSystem(),
      maxTokens: cfg.learnMaxTokens,
      sessionId: session.id,
      purpose: "prompt-self-learn",
      signal: AbortSignal.timeout(cfg.learnTimeoutMs)
    });
    if (result === undefined) return undefined;
    return parseAnalysis(result);
  }

  function injectOptimized(decision, optimized) {
    return {
      kind: "enter",
      messages: [...decision.messages, createUserMessage({
        content: [{ type: "text", text: optimizedFrame(optimized) }],
        source: { kind: "plugin", plugin: PLUGIN, form: "prompt-self-optimized" }
      })]
    };
  }

  // —— 1) 消息级自动改写 ——
  ctx.on("agent/pre-step", async ({ agent, signal, messages }, next) => {
    const decision = await next();
    if (decision.kind === "reject") return decision;
    try {
      const session = agent.session;
      let latest = latestUserMessageFromClaim(messages);
      if (latest === undefined) {
        const fromEvents = latestUserPrompt(session);
        latest = fromEvents === undefined ? undefined : { id: fromEvents.id, text: fromEvents.text };
      }
      if (latest === undefined) return decision;
      if (isFinCommand(latest.text)) {
        scheduleLearn(session, true);
        return decision;
      }
      if (cfg.enabled !== true) return decision;
      const profileText = await readText(profilePath);
      if (!hasRules(profileText)) return decision;
      const rt = await readRuntimeConfig(configPath);
      if (rt.optimizeEnabled === false) return decision;
      if (lastOptimized.get(session) === latest.id) {
        if (hasInjection(decision.messages)) return decision;
        const cached = optimizeCache.get(session);
        if (cached !== undefined && cached.id === latest.id) return injectOptimized(decision, cached.text);
        return decision;
      }
      const optimized = await runOptimize(session, latest.text, signal);
      if (optimized === undefined) return decision;
      lastOptimized.set(session, latest.id);
      optimizeCache.set(session, { id: latest.id, text: optimized });
      try {
        session.append("session/prompt-self-optimized", { userKey: latest.id, original: latest.text, optimized });
      } catch (error) {
        ctx.logger.warn(PLUGIN + ": append optimized event failed: " + (error instanceof Error ? error.message : String(error)));
      }
      return injectOptimized(decision, optimized);
    } catch (error) {
      ctx.logger.warn(PLUGIN + ": pre-step optimization failed");
      ctx.logger.warn(error);
      return decision;
    }
  });

  // —— 2) 自动学习（替代 -fin）——
  ctx.on("session/event", (session, event) => {
    if (event?.type !== "turn/end") return;
    scheduleLearn(session, false);
  });
}

export { apply, name, cleanOutput, collectPair, defaultRecordsPath, handleConfigRoute, handleProfileRoute, hasRules, isFinCommand, latestUserMessageFromClaim, latestUserPrompt, mergeParsed, mergeProfile, mergeProfilePair, messageText, parseAnalysis, parseProfile, readRuntimeConfig, renderCore, renderProfile, renderRecords };
