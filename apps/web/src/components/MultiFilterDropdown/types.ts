import type { ReactNode } from "react";

export type MultiFilterOption = { value: string; label: string };

export type MultiFilterDropdownProps = {
  label: string;
  allLabel: string;
  options: MultiFilterOption[];
  value: string[];
  onChange: (next: string[]) => void;
  icon?: ReactNode;
};
