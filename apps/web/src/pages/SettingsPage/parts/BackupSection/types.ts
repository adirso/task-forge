import type { ChangeEvent } from "react";

export type BackupSectionProps = {
  backupBusy: boolean;
  backupError: string;
  backupMessage: string;
  onExport: () => void | Promise<void>;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
};
