import { DbClient } from '../migrator.js';

export interface WorkspaceRecord {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export class WorkspaceRepository {
  constructor(private client: DbClient) {}

  async create(name: string): Promise<WorkspaceRecord> {
    const { rows } = await this.client.query<WorkspaceRecord>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id, name, created_at, updated_at;`,
      [name]
    );
    return rows[0]!;
  }

  async findById(id: string): Promise<WorkspaceRecord | null> {
    const { rows } = await this.client.query<WorkspaceRecord>(
      `SELECT id, name, created_at, updated_at FROM workspaces WHERE id = $1;`,
      [id]
    );
    return rows[0] ?? null;
  }

  async count(): Promise<number> {
    const { rows } = await this.client.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM workspaces;`
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }
}
