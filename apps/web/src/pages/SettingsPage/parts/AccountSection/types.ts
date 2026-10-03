import type { FormEvent } from "react";
import type { User } from "@taskforge/contracts";

export type AccountSectionProps = {
  user: User;
  name: string;
  email: string;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void | Promise<void>;
};
