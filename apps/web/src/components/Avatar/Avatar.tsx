import { Bot } from "lucide-react";
import { initials } from "../../lib/ui";
import type { AvatarProps } from "./types";
import styles from "./Avatar.module.css";

export function Avatar({ user, size = "md" }: AvatarProps) {
  return (
    <span className={`avatar avatar-${size} ${user.kind === "AGENT" ? "avatar-agent" : ""} ${styles.root}`} title={`${user.name}${user.kind === "AGENT" ? " · Agent" : ""}`}>
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.kind === "AGENT" ? <Bot size={size === "sm" ? 12 : 15} /> : initials(user.name)}
    </span>
  );
}
