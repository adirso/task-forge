import type { User } from "@taskforge/contracts";

export type DeliveriesPanelProps = {
  agent: User;
  onSuccess: (text: string) => void;
  onError: (text: string) => void;
};
