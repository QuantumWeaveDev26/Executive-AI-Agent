import { Role } from '@thaara/contracts';
import { DbClient } from '../migrator.js';

export interface MembershipRecord {
  id: string;
  workspace_id: string;
  user_id: string;
  role: Role;
  created_at: string;
  updated_at: string;
}

export class MembershipRepository {
  constructor(private client: DbClient) {}

  async create(workspaceId: string, userId: string, role: Role): Promise<MembershipRecord> {
    const { rows } = await this.client.query<MembershipRecord>(
      `INSERT INTO memberships (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       RETURNING id, workspace_id, user_id, role, created_at, updated_at;`,
      [workspaceId, userId, role]
    );
    return rows[0]!;
  }

  async findByUserAndWorkspace(workspaceId: string, userId: string): Promise<MembershipRecord | null> {
    const { rows } = await this.client.query<MembershipRecord>(
      `SELECT id, workspace_id, user_id, role, created_at, updated_at
       FROM memberships
       WHERE workspace_id = $1 AND user_id = $2;`,
      [workspaceId, userId]
    );
    return rows[0] ?? null;
  }

  async listByUser(userId: string): Promise<MembershipRecord[]> {
    const { rows } = await this.client.query<MembershipRecord>(
      `SELECT id, workspace_id, user_id, role, created_at, updated_at
       FROM memberships
       WHERE user_id = $1;`,
      [userId]
    );
    return rows;
  }

  async listUserMembershipsForAuth(userId: string, email: string): Promise<MembershipRecord[]> {
    const { rows } = await this.client.query<MembershipRecord>(
      `SELECT id, workspace_id, user_id, role, created_at, updated_at
       FROM get_authenticated_user_memberships($1, $2);`,
      [userId, email]
    );
    return rows;
  }
}
