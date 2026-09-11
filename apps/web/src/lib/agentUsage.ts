import type { AgentUsageTotals } from "@taskforge/contracts";

export function formatAgentUsage(usage: AgentUsageTotals) {
  return `${usage.totalTokens.toLocaleString("en-US")} tokens · $${(usage.costMicros / 1_000_000).toFixed(2)} · ${Math.round(usage.runtimeMs / 1000)}s · ${usage.toolCalls} tools`;
}
