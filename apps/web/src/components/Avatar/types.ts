import type { User } from "@taskforge/contracts";

export type AvatarProps = {
  user: User;
  size?: "sm" | "md" | "lg";
};
