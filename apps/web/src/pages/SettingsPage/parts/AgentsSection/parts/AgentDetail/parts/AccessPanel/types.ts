import type { FormEvent } from "react";
import type { ApiTokenMetadata, User } from "@taskforge/contracts";

export type AccessPanelProps = {
  agent: User;
  tokens: ApiTokenMetadata[];
  tokensLoading: boolean;
  tokensError: string;
  tokenName: string;
  expiresInDays: string;
  issuingToken: boolean;
  issuedToken: string;
  revealedTokenId: string;
  copied: boolean;
  onAgentUpdated: (user: User) => void;
  onSuccess: (text: string) => void;
  onError: (text: string) => void;
  onIssueToken: (event: FormEvent) => void | Promise<void>;
  onTokenNameChange: (value: string) => void;
  onExpiresInDaysChange: (value: string) => void;
  onRequestRevealToken: (token: ApiTokenMetadata) => void;
  onRevokeToken: (id: string) => void | Promise<void>;
  onCopyToken: () => void | Promise<void>;
};
