import type { Json } from './database.generated';

export type SupportViewerFunctions = {
  support_viewer_access: { Args: { org: string; members?: string[] }; Returns: Json };
  set_support_viewer_access: {
    Args: {
      org: string;
      member: string;
      dashboard: boolean;
      shared_incidents: boolean;
      expected_revision: number;
    };
    Returns: undefined;
  };
  support_viewer_dashboard: { Args: { org: string }; Returns: Json };
  shared_incidents: {
    Args: { org: string; ticket?: string; query?: string; page?: number; filter?: string };
    Returns: Json;
  };
  save_shared_incident: {
    Args: {
      org: string;
      ticket: string;
      title: string;
      overview: string;
      resolution: string;
      published: boolean;
      expected_revision: number;
    };
    Returns: undefined;
  };
};
