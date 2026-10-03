import type { User } from "@taskforge/contracts";

export type AgentPickerProps = {
  agents: User[];
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
};
