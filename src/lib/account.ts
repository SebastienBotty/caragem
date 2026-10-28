import type { GarageState, User } from './domain';
export type AccountSummary = {
  email: string;
  name: string;
  hasPassword: boolean;
  googleLinked: boolean;
};
export type GarageAccess = { id: string; name: string; userId: string; role: User['role'] };
export type SessionData = {
  state: GarageState | null;
  userId: string;
  expires: number;
  account: AccountSummary | null;
  garages: GarageAccess[];
  smtp: boolean;
  onboardingSeen: boolean;
};
