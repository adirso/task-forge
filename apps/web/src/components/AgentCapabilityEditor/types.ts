import type { User } from "@taskforge/contracts";

export type AgentCapabilityEditorProps = {
  agent: User;
  onUpdated: (user: User) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  embedded?: boolean;
};
