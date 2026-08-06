import type { Phase } from "@taskforge/contracts";

export function resolveBoardPhase(phases: Phase[], phaseRef?: string | null): Phase | null {
  if (phaseRef) {
    const requested = phases.find((phase) => phase.id === phaseRef || String(phase.number) === phaseRef);
    if (requested) return requested;
  }

  return phases.find((phase) => phase.isActive) ?? null;
}

export function boardPhaseQueryValue(selectedPhase: Phase | null, activePhase: Phase | null): string | null {
  if (!selectedPhase || selectedPhase.id === activePhase?.id) return null;
  return String(selectedPhase.number);
}
