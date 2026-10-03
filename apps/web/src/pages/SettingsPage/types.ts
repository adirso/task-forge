import type { User } from "@taskforge/contracts";

export type SettingsPageProps = {
  user: User;
  users: User[];
  defaultView: "board" | "list";
  textSize: "comfortable" | "large";
  onUserUpdated: (user: User) => void;
  onAgentCreated: (user: User) => void;
  onAgentUpdated: (user: User) => void;
  onAgentDeleted: (id: string) => void;
  onDefaultViewChange: (view: "board" | "list") => void;
  onTextSizeChange: (size: "comfortable" | "large") => void;
};
