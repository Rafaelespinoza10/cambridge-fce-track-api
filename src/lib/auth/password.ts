import * as bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

class PasswordService {
  static async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, SALT_ROUNDS);
  }

  static async compare(plain: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plain, hashed);
  }
}

export { PasswordService };
