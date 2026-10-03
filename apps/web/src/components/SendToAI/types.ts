import type { Project, Task } from "@taskforge/contracts";
import type { AIPromptMode } from "../../lib/aiPrompt";

export type SendToAIProps = {
  project: Project;
  task: Task;
  phaseNumber: number | null;
  initialMode: AIPromptMode;
  onClose: () => void;
};
