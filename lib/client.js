window.__ModuleLoader__.load({
	id: "dsh-prompt-self-client",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");
		var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		var createElement = react.createElement;
		var useState = react.useState;
		var useEffect = react.useEffect;
		var useCallback = react.useCallback;
		var Button = primitives.Button;
		var IconPersonalization = primitives.IconPersonalizationOutline16;

		const name = "prompt-self-client";
		const inject = ["slots", "locale"];
		const NS = "prompt-self";

		const zh = {
			"nav": "Prompt 画像",
			"title": "Prompt 画像引擎",
			"description": "消息级 prompt 自动改写与画像自动学习。开关实时生效，画像由插件自动维护。",
			"optToggle": "自动改写优化",
			"optHint": "收到新请求时按画像自动改写后再执行",
			"learnToggle": "自动学习画像",
			"learnHint": "每次交互结束后自动分析并更新画像",
			"refresh": "刷新",
			"habits": "习惯清单",
			"rules": "防幻觉规则",
			"records": "学习记录",
			"emptyHabits": "暂无记录 — 交互几次后自动积累",
			"emptyRules": "暂无规则",
			"emptyRecords": "暂无记录",
			"loading": "加载中…",
			"loadFailed": "加载失败：",
			"readFailed": "画像读取失败：",
			"model": "辅助模型",
			"updatedAt": "画像更新于",
			"refreshedAt": "上次刷新",
			"dockOn": "已开启",
			"dockPartial": "部分开启",
			"dockOff": "已暂停",
			"dockOpen": "打开画像面板",
			"dockClose": "关闭"
		};
		const en = {
			"nav": "Prompt Profile",
			"title": "Prompt Profile Engine",
			"description": "Message-level prompt rewriting and automatic profile learning. Switches take effect immediately; the profile is maintained by the plugin.",
			"optToggle": "Auto-rewrite prompts",
			"optHint": "Rewrite new requests against the profile before execution",
			"learnToggle": "Auto-learn profile",
			"learnHint": "Analyze each interaction and update the profile automatically",
			"refresh": "Refresh",
			"habits": "Habits",
			"rules": "Anti-hallucination rules",
			"records": "Learning records",
			"emptyHabits": "Nothing yet — accumulates after a few interactions",
			"emptyRules": "No rules yet",
			"emptyRecords": "No records yet",
			"loading": "Loading…",
			"loadFailed": "Failed to load: ",
			"readFailed": "Failed to read profile: ",
			"model": "Aux model",
			"updatedAt": "Profile updated",
			"refreshedAt": "Last refreshed",
			"dockOn": "On",
			"dockPartial": "Partial",
			"dockOff": "Paused",
			"dockOpen": "Open profile panel",
			"dockClose": "Close"
		};

		const muted = "var(--dsw-alias-label-tertiary)";
		const text = "var(--dsw-alias-label-primary)";
		const border = "var(--dsw-alias-border-l1)";
		const accent = "var(--dsw-alias-brand)";
		const danger = "var(--dsw-alias-state-error-primary)";
		const okGreen = "#2f9e5f";
		const warnAmber = "#c98a1b";
		const offGray = "#8a8f98";

		const containerStyle = { display: "flex", flexDirection: "column", gap: 16, padding: "4px 0 16px 0", width: "100%" };
		const cardStyle = { border: "1px solid " + border, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8, background: "var(--dsw-alias-bg-base)" };
		const rowStyle = { display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: text, cursor: "pointer" };
		const bulletStyle = { fontSize: 13, lineHeight: "20px", color: text, paddingLeft: 12, borderLeft: "2px solid " + accent, marginBottom: 6 };
		const itemMutedStyle = { fontSize: 12, color: muted };

		function ToggleRow({ checked, disabled, onChange, label, hint }) {
			return createElement("label", { style: rowStyle },
				createElement("input", {
					type: "checkbox",
					checked,
					disabled,
					style: { width: 16, height: 16, accentColor: accent },
					onChange: (event) => onChange(event.target.checked)
				}),
				createElement("span", null, label),
				hint === undefined ? null : createElement("span", { style: itemMutedStyle }, hint)
			);
		}

		function Section({ title, count, children, collapsible }) {
			const heading = createElement("div", { style: { fontSize: 13, fontWeight: 600, color: text } },
				title,
				count === undefined ? null : createElement("span", { style: { ...itemMutedStyle, marginLeft: 8, fontWeight: 400 } }, "（" + count + "）")
			);
			if (collapsible) {
				return createElement("details", { style: cardStyle, open: count <= 2 },
					createElement("summary", { style: { cursor: "pointer", listStyle: "none" } }, heading),
					children
				);
			}
			return createElement("div", { style: cardStyle }, heading, children);
		}

		function RecordCard({ record }) {
			const header = record[0] ?? "";
			const lines = record.slice(1);
			return createElement("div", { style: { padding: "10px 0", borderBottom: "1px solid " + border } },
				createElement("div", { style: { fontSize: 13, fontWeight: 600, color: text } }, header),
				...lines.map((line) => createElement("div", { key: line, style: bulletStyle }, line))
			);
		}

		function PromptSelfViewer({ t, compact }) {
			const tr = (key) => (t ? t(key) : zh[key]);
			const [state, setState] = useState({
				status: "loading",
				profile: null,
				config: { optimizeEnabled: true, learnEnabled: true, model: "" },
				error: null,
				saving: false,
				refreshedAt: null
			});
			const load = useCallback(async () => {
				setState((s) => ({ ...s, status: "loading", error: null }));
				try {
					const [profileRes, configRes] = await Promise.all([
						fetch("/prompt-self/profile"),
						fetch("/prompt-self/config")
					]);
					const profile = await profileRes.json();
					const config = await configRes.json();
					setState((s) => ({ ...s, status: "ready", profile, config, error: null, refreshedAt: Date.now() }));
				} catch (error) {
					setState((s) => ({ ...s, status: "error", error: error instanceof Error ? error.message : String(error) }));
				}
			}, []);
			useEffect(() => { load(); }, [load]);
			const setConfig = useCallback(async (patch) => {
				setState((s) => ({ ...s, saving: true }));
				try {
					const res = await fetch("/prompt-self/config", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(patch)
					});
					const next = await res.json();
					if (next.ok) {
						setState((s) => ({ ...s, config: next, saving: false, error: null }));
						load();
					} else {
						setState((s) => ({ ...s, saving: false, error: next.error ?? "" }));
					}
				} catch (error) {
					setState((s) => ({ ...s, saving: false, error: error instanceof Error ? error.message : String(error) }));
				}
			}, [load]);

			const { status, profile, config, error, saving } = state;
			return createElement("div", { style: containerStyle },
				createElement("div", { style: { ...cardStyle, flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center" } },
					createElement(IconPersonalization, { style: { width: 18, height: 18, color: accent, flex: "none" } }),
					createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2, marginRight: "auto", minWidth: 0 } },
						createElement("div", { style: { fontSize: 15, fontWeight: 600, color: text } }, tr("title")),
						compact ? null : createElement("div", { style: itemMutedStyle }, tr("description"))
					),
					createElement(Button, { variant: "outline", size: "sm", onClick: () => load() }, tr("refresh"))
				),
				createElement("div", { style: cardStyle },
					ToggleRow({ checked: config.optimizeEnabled !== false, disabled: saving, onChange: (value) => setConfig({ optimizeEnabled: value }), label: tr("optToggle"), hint: tr("optHint") }),
					ToggleRow({ checked: config.learnEnabled !== false, disabled: saving, onChange: (value) => setConfig({ learnEnabled: value }), label: tr("learnToggle"), hint: tr("learnHint") }),
					createElement("div", { style: itemMutedStyle }, tr("model") + "：" + (config.model || "默认"))
				),
				status === "loading" ? createElement("div", { style: itemMutedStyle }, tr("loading"))
				: status === "error" ? createElement("div", { style: { color: danger, fontSize: 13 } }, tr("loadFailed") + error)
				: profile && profile.ok !== false ? createElement(react.Fragment, null,
					createElement(Section, { title: tr("habits"), count: (profile.habits ?? []).length },
						(profile.habits ?? []).length === 0
							? createElement("div", { style: itemMutedStyle }, tr("emptyHabits"))
							: (profile.habits ?? []).map((habit) => createElement("div", { key: habit, style: bulletStyle }, habit))
					),
					createElement(Section, { title: tr("rules"), count: (profile.rules ?? []).length },
						(profile.rules ?? []).length === 0
							? createElement("div", { style: itemMutedStyle }, tr("emptyRules"))
							: (profile.rules ?? []).map((rule) => createElement("div", { key: rule, style: bulletStyle }, rule))
					),
					createElement(Section, { title: tr("records"), count: (profile.records ?? []).length, collapsible: (profile.records ?? []).length > 2 },
						(profile.records ?? []).length === 0
							? createElement("div", { style: itemMutedStyle }, tr("emptyRecords"))
							: (profile.records ?? []).map((record) => createElement(RecordCard, { key: record[0] + record.length, record }))
					),
					createElement("div", { style: itemMutedStyle },
						profile.updatedAt ? tr("updatedAt") + " " + new Date(profile.updatedAt).toLocaleString() : null,
						state.refreshedAt ? "　·　" + tr("refreshedAt") + " " + new Date(state.refreshedAt).toLocaleTimeString() : null
					)
				)
				: createElement("div", { style: { color: danger, fontSize: 13 } }, tr("readFailed") + ((profile && profile.error) || ""))
			);
		}

		function PromptSelfSection({ renderSlot, t }) {
			return createElement("div", { style: { width: "100%" } }, renderSlot("settings.prompt-self.item", {}));
		}

		/** 对话输入坞快捷入口：状态徽点 + 弹出面板（与设置页共用同一个 Viewer）。 */
		function PromptSelfDock({ t }) {
			const tr = (key) => (t ? t(key) : zh[key]);
			const [open, setOpen] = useState(false);
			const [config, setConfig] = useState({ optimizeEnabled: true, learnEnabled: true });
			const reload = useCallback(() => {
				fetch("/prompt-self/config").then((r) => r.json()).then((c) => {
					if (c && c.ok !== false) setConfig(c);
				}).catch(() => {});
			}, []);
			useEffect(() => { reload(); }, [reload]);
			const on = config.optimizeEnabled !== false;
			const learn = config.learnEnabled !== false;
			const dot = on && learn ? okGreen : on || learn ? warnAmber : offGray;
			const statusLabel = on && learn ? tr("dockOn") : on || learn ? tr("dockPartial") : tr("dockOff");
			return createElement(react.Fragment, null,
				createElement("div", {
					style: {
						boxSizing: "border-box",
						width: "100%",
						maxWidth: "calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))",
						margin: "0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px)",
						padding: "0 var(--dsh-composer-dock-inset)",
						flex: "none",
						display: "flex",
						justifyContent: "center"
					},
					onClick: () => setOpen((v) => !v),
					title: tr("dockOpen")
				},
					createElement("div", {
						style: {
							display: "flex",
							alignItems: "center",
							gap: 8,
							padding: "5px 12px",
							borderRadius: 999,
							border: "1px solid " + border,
							background: "var(--dsw-specific-tip)",
							cursor: "pointer",
							fontSize: 12,
							color: text,
							userSelect: "none"
						}
					},
						createElement("span", { style: { width: 8, height: 8, borderRadius: "50%", background: dot, flex: "none" } }),
						createElement("span", null, tr("nav")),
						createElement("span", { style: itemMutedStyle }, statusLabel)
					)
				),
				open ? createElement("div", {
						style: {
							position: "fixed",
							right: 16,
							bottom: 104,
							width: 440,
							maxWidth: "calc(100vw - 32px)",
							maxHeight: "min(72vh, 720px)",
							overflowY: "auto",
							zIndex: 2000,
							background: "var(--dsw-alias-bg-base)",
							border: "1px solid " + border,
							borderRadius: 14,
							padding: 12,
							boxShadow: "0 12px 40px rgba(0,0,0,0.25)"
						}
					},
					createElement("div", { style: { display: "flex", justifyContent: "flex-end", marginBottom: 4 } },
						createElement(Button, { variant: "ghost", size: "sm", onClick: () => setOpen(false) }, tr("dockClose"))
					),
					createElement(PromptSelfViewer, { t, compact: true, onChanged: reload })
				)
				: null
			);
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "prompt-self: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "prompt-self",
				order: 100,
				label: () => t("nav"),
				locale: NS,
				children: { "settings.prompt-self.item": { kind: "list", scope: "root" } }
			}, PromptSelfSection));
			ctx.slots.inject("settings.prompt-self.item", () => ctx.slots.register({
				name: "settings.prompt-self.item",
				id: "viewer",
				order: 0,
				locale: NS
			}, PromptSelfViewer));
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "prompt-self",
				order: 50,
				locale: NS
			}, PromptSelfDock));
		}

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;
		return exports;
	}
});
