export type UserRole = 'captain' | 'crew';

export interface UserProfile {
  id: string;
  display_name: string;
  email: string;
  avatar_url?: string;
  created_at: string;
}

export interface UserRoleRecord {
  id: string;
  user_id: string;
  role: UserRole;
}
