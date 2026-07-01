export interface UserGrowthData {
  date: string;
  users: number;
  new_users: number;
  unique_emails: number;
  verified_users: number;
}

export interface UserDataRow {
  date: string;
  users: number;
  new_users: number;
  unique_emails: number;
  verified_users: number;
}

export interface ATSAnalyticsData {
  date: string;
  total_analyses: number;
  successful_matches: number;
  pending_reviews: number;
  completed_processes: number;
}

export interface ATSDataRow {
  date: string;
  total_analyses: number;
  successful_matches: number;
  pending_reviews: number;
  completed_processes: number;
}

export interface DataResponse {
  success: boolean;
}
