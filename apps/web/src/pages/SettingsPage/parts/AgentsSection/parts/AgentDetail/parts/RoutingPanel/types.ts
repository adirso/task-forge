import type { User } from "@taskforge/contracts";

export type RoutingPanelProps = {
  agent: User;
  onAgentUpdated: (user: User) => void;
  onSuccess: (text: string) => void;
  onError: (text: string) => void;
};
