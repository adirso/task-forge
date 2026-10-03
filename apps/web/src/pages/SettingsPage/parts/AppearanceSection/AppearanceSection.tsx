import { Check, LayoutDashboard, List } from "lucide-react";
import type { AppearanceSectionProps } from "./types";
import styles from "./AppearanceSection.module.css";

export function AppearanceSection({ defaultView, textSize, onDefaultViewChange, onTextSizeChange }: AppearanceSectionProps) {
  return (
    <div className={styles.root}>
      <div className={styles.heading}>
        <h2>Appearance</h2>
        <p>Choose how TaskForge looks when you return.</p>
      </div>
      <div className={styles.group}>
        <h3>Default project view</h3>
        <div className={styles.choiceGrid}>
          <button type="button" className={`${styles.choice}${defaultView === "board" ? ` ${styles.choiceSelected}` : ""}`} onClick={() => onDefaultViewChange("board")}>
            <LayoutDashboard />
            <span className={styles.choiceCopy}><strong>Board</strong><small>Visual workflow columns</small></span>
            {defaultView === "board" && <Check />}
          </button>
          <button type="button" className={`${styles.choice}${defaultView === "list" ? ` ${styles.choiceSelected}` : ""}`} onClick={() => onDefaultViewChange("list")}>
            <List />
            <span className={styles.choiceCopy}><strong>List</strong><small>Structured table view</small></span>
            {defaultView === "list" && <Check />}
          </button>
        </div>
      </div>
      <div className={styles.group}>
        <h3>Text size</h3>
        <div className={styles.choiceGrid}>
          <button type="button" className={`${styles.choice}${textSize === "comfortable" ? ` ${styles.choiceSelected}` : ""}`} onClick={() => onTextSizeChange("comfortable")}>
            <span className={`${styles.textPreview} ${styles.textPreviewComfortable}`}>Aa</span>
            <span className={styles.choiceCopy}><strong>Comfortable</strong><small>Balanced information density</small></span>
            {textSize === "comfortable" && <Check />}
          </button>
          <button type="button" className={`${styles.choice}${textSize === "large" ? ` ${styles.choiceSelected}` : ""}`} onClick={() => onTextSizeChange("large")}>
            <span className={`${styles.textPreview} ${styles.textPreviewLarge}`}>Aa</span>
            <span className={styles.choiceCopy}><strong>Large</strong><small>Extra readable text and controls</small></span>
            {textSize === "large" && <Check />}
          </button>
        </div>
      </div>
    </div>
  );
}
