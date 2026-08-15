// dsh-prompt-self-client 引擎自测套件（mock LLM + 真实 cordis 作用域/调度语义）。
//
// 运行方式：在装有 @deepseek-ai 依赖的 DSH profile 内执行（依赖可从
// profile 的 node_modules 解析，例如 DSH Desktop 的
// <DSH_HOME>/profiles 目录下）：
//   node --test tests/engine.test.mjs        # 或 node tests/engine.test.mjs
//
// 覆盖：双层 apply、消息级注入与缓存复用、跨会话作用域隔离、turn/end 自动学习、
// -fin 强制学习、运行时开关（config.json）、Web 路由处理器、缓存键稳定性。

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import { createScope, scopeTarget, bindScopeParent } from "@deepseek-ai/dsh-scope";
import { apply as engineApply, name, readRuntimeConfig, handleProfileRoute, handleConfigRoute, parseProfile } from "../plugin/lib/index.js";

function fakeLlm(calls) {
  return {
    stream: async function* (options) {
      let text;
      if (options.purpose === "prompt-self-optimize") {
        calls.optimize += 1;
        text = "帮我写一个函数，使用中文回复并附上可运行示例";
      } else if (options.purpose === "prompt-self-learn") {
        calls.learn += 1;
        text = JSON.stringify({
          habits: [{ habit: "测试习惯：写代码请求常省略语言", action: "默认中文回复并附示例" }],
          hallucinationRules: ["不虚构未要求的 API"],
          entry: { date: "2099-01-01", promptSummary: "帮我写个函数", outputSummary: "提供了函数示例", insights: "表面要求函数实现，真实意图需要可运行示例", rules: ["收到写代码请求时，默认中文 + 附可运行示例"] }
        });
      } else {
        text = "mock";
      }
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "text-delta", index: 0, text };
      yield { type: "block-end", index: 0, block: { type: "text", text } };
      yield { type: "finish", reason: { kind: "stop" } };
    }
  };
}

async function bootEngine(tmp, calls) {
  const root = new Context();
  root.provide("llm", fakeLlm(calls));
  const presetKey = {};
  const scope = createScope(root, presetKey);
  await scope.ctx.plugin({ name, apply: engineApply }, {
    profilePath: join(tmp, "profile.md"),
    statePath: join(tmp, "profile.md.state.json"),
    provider: "mock",
    model: "mock-model"
  });
  return { root, scope, presetKey };
}

function makeSession(id, events, appends = []) {
  return { id, events, append(type, data) { appends.push({ type, data }); } };
}

function dispatchPreStep(scoped, agent, carrier, claim) {
  return scoped.waterfall(carrier, "agent/pre-step", { agent, signal: undefined, messages: claim }, async () => ({ kind: "enter", messages: [] }));
}

test("engine: pre-step 注入优化消息并缓存复用", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-ps-test-"));
  try {
    copyFileSync(fileURLToPath(new URL("../install/skills/prompt-self-optimizer/profile.md", import.meta.url)), join(tmp, "profile.md"));
    const calls = { optimize: 0, learn: 0 };
    const { scope, presetKey } = await bootEngine(tmp, calls);
    const scoped = scope.ctx;
    const appends = [];
    const session = makeSession("s1", [
      { type: "user/message", data: { id: "c1", source: { kind: "user" }, content: [{ type: "text", text: "帮我写个函数" }] } },
      { type: "assistant/message", data: { message: { source: { kind: "model" }, content: [{ type: "text", text: "好的" }] } } }
    ], appends);
    const agent = { id: "a1", session };
    bindScopeParent(agent, presetKey);
    const carrier = scopeTarget(agent, agent);
    const claim = [{ role: "user", id: "c1", source: { kind: "user" }, content: [{ type: "text", text: "帮我写个函数" }] }];
    const d1 = await dispatchPreStep(scoped, agent, carrier, claim);
    assert.equal(calls.optimize, 1);
    assert.equal(d1.messages.length, 1);
    assert.equal(d1.messages[0].source.plugin, "dsh-prompt-self-client");
    // 第二次派发（多步回合后续 step）应复用缓存，不再调用 LLM
    const d2 = await dispatchPreStep(scoped, agent, carrier, []);
    assert.equal(calls.optimize, 1);
    assert.ok(d2.messages.some((m) => m?.source?.form === "prompt-self-optimized"));
    scope.dispose();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("engine: 作用域过滤排除无关 agent", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-ps-test-"));
  try {
    copyFileSync(fileURLToPath(new URL("../install/skills/prompt-self-optimizer/profile.md", import.meta.url)), join(tmp, "profile.md"));
    const calls = { optimize: 0, learn: 0 };
    const { scope, presetKey } = await bootEngine(tmp, calls);
    const scoped = scope.ctx;
    const session = makeSession("s1", [
      { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "帮我写个函数" }] } }
    ]);
    const agent = { id: "a1", session };
    bindScopeParent(agent, presetKey);
    const other = { id: "other", session: makeSession("other", []) };
    const otherCarrier = scopeTarget(other, other);
    const d = await dispatchPreStep(scoped, other, otherCarrier, []);
    assert.equal(d.messages.length, 0);
    assert.equal(calls.optimize, 0);
    scope.dispose();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("engine: turn/end 自动学习并更新画像", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-ps-test-"));
  try {
    copyFileSync(fileURLToPath(new URL("../install/skills/prompt-self-optimizer/profile.md", import.meta.url)), join(tmp, "profile.md"));
    const calls = { optimize: 0, learn: 0 };
    const { scope } = await bootEngine(tmp, calls);
    const scoped = scope.ctx;
    const appends = [];
    const session = makeSession("s1", [
      { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "帮我写个函数" }] } },
      { type: "assistant/message", data: { message: { source: { kind: "model" }, content: [{ type: "text", text: "好的，函数如下..." }] } } }
    ], appends);
    scoped.emit("session/event", session, { type: "turn/end" });
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(calls.learn, 1);
    const profile = readFileSync(join(tmp, "profile.md"), "utf8");
    assert.ok(profile.includes("帮我写个函数"));
    assert.ok(profile.includes("可运行示例"));
    assert.ok(appends.some((a) => a.type === "session/prompt-self-learned"));
    assert.ok(existsSync(join(tmp, "profile.md.state.json")));
    scope.dispose();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("engine: -fin 强制学习且不与自身回复配对", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-ps-test-"));
  try {
    copyFileSync(fileURLToPath(new URL("../install/skills/prompt-self-optimizer/profile.md", import.meta.url)), join(tmp, "profile.md"));
    const calls = { optimize: 0, learn: 0 };
    const { scope, presetKey } = await bootEngine(tmp, calls);
    const scoped = scope.ctx;
    const session = makeSession("s1", [
      { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "帮我写个函数" }] } },
      { type: "assistant/message", data: { message: { source: { kind: "model" }, content: [{ type: "text", text: "好的，函数如下..." }] } } },
      { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "-fin" }] } },
      { type: "assistant/message", data: { message: { source: { kind: "model" }, content: [{ type: "text", text: "已记录" }] } } }
    ]);
    const agent = { id: "a1", session };
    bindScopeParent(agent, presetKey);
    const carrier = scopeTarget(agent, agent);
    const d = await dispatchPreStep(scoped, agent, carrier, [{ role: "user", id: "fin", source: { kind: "user" }, content: [{ type: "text", text: "-fin" }] }]);
    assert.equal(d.messages.length, 0);
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(calls.learn, 1);
    scope.dispose();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("runtime config: 开关读写与实时生效", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-ps-test-"));
  try {
    copyFileSync(fileURLToPath(new URL("../install/skills/prompt-self-optimizer/profile.md", import.meta.url)), join(tmp, "profile.md"));
    const configPath = join(tmp, "profile.md.config.json");
    // 缺省全开
    assert.equal((await readRuntimeConfig(configPath)).optimizeEnabled, true);
    writeFileSync(configPath, JSON.stringify({ optimizeEnabled: false, learnEnabled: false, model: "x" }), "utf8");
    const rt = await readRuntimeConfig(configPath);
    assert.equal(rt.optimizeEnabled, false);
    assert.equal(rt.learnEnabled, false);
    assert.equal(rt.model, "x");
    // 开关关闭时引擎不注入
    const calls = { optimize: 0, learn: 0 };
    const { scope, presetKey } = await bootEngine(tmp, calls);
    const scoped = scope.ctx;
    const session = makeSession("s1", [
      { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "帮我写个函数" }] } },
      { type: "assistant/message", data: { message: { source: { kind: "model" }, content: [{ type: "text", text: "好的" }] } } }
    ]);
    const agent = { id: "a1", session };
    bindScopeParent(agent, presetKey);
    const carrier = scopeTarget(agent, agent);
    const d = await dispatchPreStep(scoped, agent, carrier, [{ role: "user", id: "c1", source: { kind: "user" }, content: [{ type: "text", text: "帮我写个函数" }] }]);
    assert.equal(d.messages.length, 0);
    assert.equal(calls.optimize, 0);
    scoped.emit("session/event", session, { type: "turn/end" });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(calls.learn, 0);
    scope.dispose();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("web routes: 画像与开关端点", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-ps-test-"));
  try {
    copyFileSync(fileURLToPath(new URL("../install/skills/prompt-self-optimizer/profile.md", import.meta.url)), join(tmp, "profile.md"));
    const configPath = join(tmp, "profile.md.config.json");
    function mockRes() {
      return { statusCode: 0, headers: {}, body: "", writeHead(s, h) { this.statusCode = s; this.headers = h; }, end(b) { this.body = b; } };
    }
    function fakeReq(method, body) {
      const listeners = {};
      const req = { method, on(ev, cb) { listeners[ev] = cb; return req; } };
      setTimeout(() => { listeners.data?.(Buffer.from(body ?? "")); listeners.end?.(); }, 0);
      return req;
    }
    const r1 = mockRes();
    await handleConfigRoute(fakeReq("POST", JSON.stringify({ optimizeEnabled: false })), r1, join(tmp, "profile.md"), configPath);
    assert.equal(r1.statusCode, 200);
    assert.equal(JSON.parse(r1.body).optimizeEnabled, false);
    const persisted = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(persisted.optimizeEnabled, false);
    const r2 = mockRes();
    await handleProfileRoute({ method: "GET" }, r2, join(tmp, "profile.md"), configPath);
    assert.equal(r2.statusCode, 200);
    const profile = JSON.parse(r2.body);
    assert.ok(Array.isArray(profile.habits) && profile.habits.length >= 1);
    assert.ok(Array.isArray(profile.records));
    assert.equal(profile.optimizeEnabled, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
