import type { TaskSearchResult } from "@taskforge/contracts";

export type SearchPaletteProps = {
  onClose: () => void;
  onOpen: (task: TaskSearchResult) => void;
};
