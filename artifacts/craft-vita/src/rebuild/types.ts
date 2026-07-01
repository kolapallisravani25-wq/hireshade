export type LaunchSession = {
  id: string;
  companyName?: string | null;
  round?: string | null;
  jobDescription?: string | null;
  status?: string | null;
  free?: boolean;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type LaunchResume = {
  id: string;
  filename?: string | null;
  title?: string | null;
  source?: string | null;
  score?: number | null;
  createdAt?: string | null;
};

export type LaunchProject = {
  id: string;
  title?: string | null;
  description?: string | null;
  roleType?: string | null;
  createdAt?: string | null;
};
