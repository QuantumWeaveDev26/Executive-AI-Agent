import { DbClient } from '../migrator.js';

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export class UserRepository {
  constructor(private client: DbClient) {}

  async create(email: string, passwordHash: string, displayName: string): Promise<UserRecord> {
    const { rows } = await this.client.query<UserRecord>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, password_hash, display_name, created_at, updated_at;`,
      [email.toLowerCase().trim(), passwordHash, displayName.trim()]
    );
    return rows[0]!;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.client.query<UserRecord>(
      `SELECT id, email, password_hash, display_name, created_at, updated_at
       FROM users WHERE email = $1;`,
      [email.toLowerCase().trim()]
    );
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.client.query<UserRecord>(
      `SELECT id, email, password_hash, display_name, created_at, updated_at
       FROM users WHERE id = $1;`,
      [id]
    );
    return rows[0] ?? null;
  }

  async count(): Promise<number> {
    const { rows } = await this.client.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM users;`
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }
}
