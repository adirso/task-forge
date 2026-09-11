import type { AgentArtifact, AgentArtifactType } from "@taskforge/contracts";

const labels: Record<AgentArtifactType, string> = {
  CHANGED_FILES: "Changed files", COMMIT: "Commit", TEST_RESULT: "Test result", COVERAGE: "Coverage", SCREENSHOT: "Screenshot",
  TOOL_OUTCOME: "Tool outcome", PROMPT: "Prompt", MODEL: "Model", EXECUTION_ENVIRONMENT: "Execution environment",
};

export function artifactTypeLabel(type: AgentArtifactType) { return labels[type]; }
export function artifactProvenance(artifact: AgentArtifact) { return `${artifact.headSha.slice(0, 12)} · sha256:${artifact.contentHash.slice(0, 12)} · ${artifact.size.toLocaleString()} bytes`; }
