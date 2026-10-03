import { Check, Download, Upload } from "lucide-react";
import type { BackupSectionProps } from "./types";
import styles from "./BackupSection.module.css";

export function BackupSection({ backupBusy, backupError, backupMessage, onExport, onUpload }: BackupSectionProps) {
  return (
    <div className={styles.root}>
      <div className={styles.heading}>
        <h2>Database backup</h2>
        <p>Export a redacted transfer backup or restore a compatible secure archive. Redacted exports cannot be restored because they do not contain credentials; secrets are never shown in this interface.</p>
      </div>
      <div className={styles.actions}>
        <section className={styles.card}>
          <Download />
          <div>
            <h3>Export backup</h3>
            <p>Download a gzip archive containing workspace data and attachments.</p>
          </div>
          <button type="button" className="button button-primary" onClick={() => void onExport()} disabled={backupBusy}>
            <Download /> {backupBusy ? "Working…" : "Export and download"}
          </button>
        </section>
        <section className={styles.card}>
          <Upload />
          <div>
            <h3>Restore backup</h3>
            <p>Upload a validated archive to replace this workspace. Invalid or incompatible files leave the current database unchanged.</p>
          </div>
          <label className="button button-secondary">
            <Upload /> {backupBusy ? "Validating…" : "Choose backup file"}
            <input type="file" accept=".tar.gz,.tgz,application/gzip,application/x-gzip" onChange={(event) => void onUpload(event)} disabled={backupBusy} />
          </label>
        </section>
      </div>
      {backupError && <div className={`form-error ${styles.feedback}`} role="alert">{backupError}</div>}
      {backupMessage && <div className={`form-success ${styles.feedback}`} role="status"><Check />{backupMessage}</div>}
    </div>
  );
}
