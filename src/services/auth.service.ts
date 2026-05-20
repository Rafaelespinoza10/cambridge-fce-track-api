import { getDatabaseConnection } from '../lib/database';
import { PasswordService } from '../lib/password';
import { JwtService } from '../lib/jwt';
import { UserRole } from '../models/enums';
import type { User } from '../models/User';
import type {
  AuthResult,
  JwtPayload,
  LoginBody,
  MeResult,
  RegisterBody,
  SafeUser,
} from '../interfaces/auth.interface';
import { AuthRepository } from '../repositories/auth.repository';

function createError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

class AuthService {
  private static toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name ?? '',
      lastName: user.last_name ?? '',
      role: user.role,
    };
  }

  async register(body: RegisterBody): Promise<AuthResult> {
    const email = body.email.trim().toLowerCase();
    const { password, firstName, lastName } = body;

    if (!email) {
      throw createError('Email is required', 400);
    }

    if (!password || password.length < 8) {
      throw createError('Password must be at least 8 characters', 400);
    }

    const ds = await getDatabaseConnection();
    const repo = new AuthRepository(ds);

    const existing = await repo.findByEmail(email);
    if (existing !== null) {
      throw createError('Email already registered', 409);
    }

    const password_hash = await PasswordService.hash(password);
    const user = await repo.create({
      email,
      password_hash,
      first_name: firstName,
      last_name: lastName,
      role: UserRole.STUDENT,
      is_active: true,
    });

    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = JwtService.sign(payload);

    return { user: AuthService.toSafeUser(user), accessToken };
  }

  async login(body: LoginBody): Promise<AuthResult> {
    const email = body.email.trim().toLowerCase();
    const { password } = body;

    const ds = await getDatabaseConnection();
    const repo = new AuthRepository(ds);

    const user = await repo.findByEmail(email);
    if (user === null || user.password_hash === null) {
      throw createError('Invalid credentials', 401);
    }

    const valid = await PasswordService.compare(password, user.password_hash);
    if (!valid) {
      throw createError('Invalid credentials', 401);
    }

    if (!user.is_active) {
      throw createError('Account is inactive', 403);
    }

    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = JwtService.sign(payload);

    return { user: AuthService.toSafeUser(user), accessToken };
  }

  async getMe(token: string): Promise<MeResult> {
    let payload: JwtPayload;

    try {
      payload = JwtService.verify(token);
    } catch {
      throw createError('Invalid or expired token', 401);
    }

    const ds = await getDatabaseConnection();
    const repo = new AuthRepository(ds);

    const user = await repo.findById(payload.sub);
    if (user === null) {
      throw createError('User not found', 401);
    }

    if (!user.is_active) {
      throw createError('Account is inactive', 403);
    }

    return { user: AuthService.toSafeUser(user) };
  }
}

export { AuthService };
