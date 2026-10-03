import { ListTree } from "lucide-react";
import type { PlansPanelProps } from "./types";
import styles from "./PlansPanel.module.css";

const planStatusClass: Record<string, string | undefined> = {
  proposed: styles.statusProposed,
  approved: styles.statusApproved,
  rejected: styles.statusRejected,
};

export function PlansPanel({ project, plans, tasksById, canControlRuns, reviewingPlan, onReviewPlan }: PlansPanelProps) {
  return (
    <section className={styles.root}>
      <div className="section-heading">
        <span>Implementation plans <b>{plans.length}</b></span>
        <small>Immutable proposals linked to their source run</small>
      </div>
      {plans.length ? (
        <div className={styles.list}>
          {plans.map((plan) => (
            <article className={styles.item} key={plan.id}>
              <header>
                <span>
                  <strong>Plan v{plan.version}</strong>
                  <small>Run {plan.sourceRunId.slice(0, 8)}</small>
                </span>
                <b className={`${styles.status} ${planStatusClass[plan.status.toLowerCase()] ?? ""}`}>{plan.status}</b>
              </header>
              <p>{plan.summary}</p>
              {plan.risks.length > 0 && <div><strong>Risks</strong><ul>{plan.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div>}
              {plan.acceptanceEvidence.length > 0 && <div><strong>Acceptance evidence</strong><ul>{plan.acceptanceEvidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul></div>}
              <div className={styles.items}>
                {plan.items.map((item) => (
                  <div key={item.key}>
                    <div className={styles.taskHeading}>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.type} · {item.priority}{item.estimatePoints === null ? "" : ` · ${item.estimatePoints} points`}</small>
                      </span>
                      {item.dependencyKeys.length > 0 && <small>Depends on {item.dependencyKeys.join(", ")}</small>}
                    </div>
                    <div className={styles.taskReview}>
                      <p><strong>Description</strong><span>{item.description || "No description provided"}</span></p>
                      <p><strong>Definition of Done</strong><span>{item.definitionOfDone || "No Definition of Done provided"}</span></p>
                    </div>
                  </div>
                ))}
              </div>
              {plan.status === "APPROVED" && (
                <div className={styles.createdTasks}>
                  <strong>{Object.keys(plan.createdTaskIds).length} executable task{Object.keys(plan.createdTaskIds).length === 1 ? "" : "s"} created</strong>
                  <ul>
                    {Object.entries(plan.createdTaskIds).map(([itemKey, taskId]) => {
                      const createdTask = tasksById.get(taskId);
                      return (
                        <li key={itemKey}>
                          <span>{itemKey}</span>
                          {createdTask ? <a href={`?view=board&project=${encodeURIComponent(project.key)}&task=${encodeURIComponent(`${project.key}-${createdTask.number}`)}`}>{project.key}-{createdTask.number} · {createdTask.title}</a> : null}
                          <code>{taskId}</code>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {plan.reviewComment && <p className={styles.reviewComment}>Review: {plan.reviewComment}</p>}
              {plan.status === "PROPOSED" && canControlRuns && (
                <footer>
                  <button type="button" className="button button-danger-quiet" disabled={reviewingPlan === plan.id} onClick={() => void onReviewPlan(plan, "REJECT")}>Reject</button>
                  <button type="button" className="button button-primary" disabled={reviewingPlan === plan.id} onClick={() => void onReviewPlan(plan, "APPROVE")}>Approve &amp; create tasks</button>
                </footer>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <span>
            <ListTree />
            <strong>No implementation plans yet</strong>
            <small>An active agent run can propose a versioned task graph for review.</small>
          </span>
        </div>
      )}
    </section>
  );
}
