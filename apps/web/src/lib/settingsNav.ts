export const SETTINGS_TABS = ["account", "appearance", "agents", "backup", "agentops"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const AGENT_DETAIL_TABS = ["identity", "access", "deliveries", "routing", "danger"] as const;
export type AgentDetailTab = (typeof AGENT_DETAIL_TABS)[number];

const MEMBER_SETTINGS_TABS: readonly SettingsTab[] = ["account", "appearance", "agents"];

export function parseSettingsTab(value: string | null | undefined, isAdmin: boolean): SettingsTab {
  const allowed = isAdmin ? SETTINGS_TABS : MEMBER_SETTINGS_TABS;
  if (value && (allowed as readonly string[]).includes(value)) return value as SettingsTab;
  return "account";
}

export function parseAgentDetailTab(value: string | null | undefined): AgentDetailTab {
  if (value && (AGENT_DETAIL_TABS as readonly string[]).includes(value)) return value as AgentDetailTab;
  return "identity";
}

export function readSettingsLocation(search = window.location.search, isAdmin = false) {
  const params = new URLSearchParams(search);
  return {
    tab: parseSettingsTab(params.get("settings"), isAdmin),
    agentId: params.get("agent")?.trim() || "",
    agentTab: parseAgentDetailTab(params.get("agentTab")),
  };
}

export function writeSettingsLocation(options: {
  tab: SettingsTab;
  agentId?: string;
  agentTab?: AgentDetailTab;
  search?: string;
  pathname?: string;
  href?: string;
}) {
  const url = new URL(options.href ?? `${options.pathname ?? "/"}${options.search ?? ""}`, "http://local.test");
  url.searchParams.set("settings", options.tab);
  url.searchParams.delete("project");
  url.searchParams.delete("task");
  url.searchParams.delete("phase");
  url.searchParams.delete("view");

  if (options.tab === "agents" && options.agentId) {
    url.searchParams.set("agent", options.agentId);
    url.searchParams.set("agentTab", options.agentTab ?? "identity");
  } else {
    url.searchParams.delete("agent");
    url.searchParams.delete("agentTab");
  }

  return `${url.pathname}${url.search}`;
}
