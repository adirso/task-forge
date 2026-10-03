import type { Tag } from "@taskforge/contracts";

export type TaskTagPillsProps = {
  tags: Tag[];
  limit?: number;
};

export type TaskTagEditorProps = {
  value: string[];
  availableTags: Tag[];
  onChange: (tags: string[]) => void;
};
