import type { UserRole } from '../models/enums';

export interface RegisterBody {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

export interface SafeUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

export interface AuthResult {
  user: SafeUser;
  accessToken: string;
}

export interface MeResult {
  user: SafeUser;
}
