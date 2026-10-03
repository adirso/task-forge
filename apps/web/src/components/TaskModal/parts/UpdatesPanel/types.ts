import type { ActivityEvent, TaskNote, User } from "@taskforge/contracts";
import type { AgentLog, AgentRun } from "../../../../lib/api";

export type UpdatesPanelProps = {
  currentUser: User;
  updates: TaskNote[];
  activity: ActivityEvent[];
  runs: AgentRun[];
  agentLogs: AgentLog[];
  observedAt: number;
  updateBody: string;
  postingUpdate: boolean;
  setUpdateBody: (value: string) => void;
  onPostUpdate: () => void;
};
