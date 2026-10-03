import type { User } from "@taskforge/contracts";

export type WebhookDeliveriesPanelProps = {
  agent: User;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};
