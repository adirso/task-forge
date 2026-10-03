export type PhaseMergeModalProps = {
  phaseNumber: number;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  body: string;
  compareUrl: string;
  onAuthorize: () => Promise<void>;
  onClose: () => void;
};
