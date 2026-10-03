import type { AgentArtifact, AgentRunInterventionAction, Project, User } from "@taskforge/contracts";
import type { AgentCycleState, AgentLog, AgentRun } from "../../../../lib/api";

export type AgentsPanelProps = {
  project: Project;
  currentUser: User;
  members: User[];
  runs: AgentRun[];
  cycle: AgentCycleState | null;
  agentLogs: AgentLog[];
  artifacts: AgentArtifact[];
  observedAt: number;
  forcingCycle: boolean;
  controllingRun: string | null;
  runInputs: Record<string, string>;
  runAgents: Record<string, string>;
  canControlRuns: boolean;
  runningAgents: number;
  setRunInputs: (updater: (items: Record<string, string>) => Record<string, string>) => void;
  setRunAgents: (updater: (items: Record<string, string>) => Record<string, string>) => void;
  onForceCycle: () => void;
  onControlRun: (run: AgentRun, action: AgentRunInterventionAction) => void;
  onDownloadArtifact: (artifact: AgentArtifact) => void;
};
