export type Role = "ADMIN" | "STAFF" | "CUSTOMER";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Present for CUSTOMER users. */
  customerId?: string;
}

export interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
