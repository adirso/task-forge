import type { User } from "@taskforge/contracts";
import { Bot } from "lucide-react";
import { initials } from "../lib/ui";

export function Avatar({ user, size = "md" }: { user: User; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`avatar avatar-${size} ${user.kind === "AGENT" ? "avatar-agent" : ""}`} title={`${user.name}${user.kind === "AGENT" ? " · Agent" : ""}`}>
      {user.kind === "AGENT" ? <Bot size={size === "sm" ? 12 : 15} /> : initials(user.name)}
    </span>
  );
}
