import type { FormEvent } from "react";

export type NewAgentFormProps = {
  agentName: string;
  agentEmail: string;
  creatingAgent: boolean;
  onAgentNameChange: (value: string) => void;
  onAgentEmailChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void | Promise<void>;
  onCancel: () => void;
};
