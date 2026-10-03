import type { User } from "@taskforge/contracts";

export type WebhookManagerProps = {
  agent: User;
  onAgentUpdated: (agent: User) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};
