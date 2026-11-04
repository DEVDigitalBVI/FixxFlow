import type { Json } from './database.generated';

export type InvitationFunctions = {
  issue_workspace_invitation: {
    Args: { org: string; member: string; actor: string; token: string; token_hash: string };
    Returns: Json;
  };
  mark_workspace_invitation_sent: {
    Args: { invitation: string; hash: string; receipt: string };
    Returns: undefined;
  };
  claim_workspace_invitation: {
    Args: { invitation: string; hash: string; claim: string };
    Returns: Json;
  };
  finish_workspace_invitation: {
    Args: { invitation: string; claim: string; success: boolean };
    Returns: undefined;
  };
};
