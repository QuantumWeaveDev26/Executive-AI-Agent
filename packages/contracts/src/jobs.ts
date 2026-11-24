import { Type, Static } from '@sinclair/typebox';
import { JobStatusSchema } from './states.js';

export const JobSubmissionSchema = Type.Object({
  jobName: Type.String({ minLength: 1 }),
  payload: Type.Record(Type.String(), Type.Unknown()),
  idempotencyKey: Type.Optional(Type.String({ minLength: 8 }))
});
export type JobSubmission = Static<typeof JobSubmissionSchema>;

export const JobRunSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  jobName: Type.String(),
  status: JobStatusSchema,
  idempotencyKey: Type.Union([Type.String(), Type.Null()]),
  payload: Type.Record(Type.String(), Type.Unknown()),
  result: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
  retriesCount: Type.Integer(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  completedAt: Type.Union([Type.String(), Type.Null()])
});
export type JobRun = Static<typeof JobRunSchema>;
