export function canMergePhaseToMain(mergeTarget: "main" | "phase", nonDoneTaskCount: number) {
  return mergeTarget === "phase" && nonDoneTaskCount === 0;
}
