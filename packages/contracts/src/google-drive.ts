import { Type, Static } from '@sinclair/typebox';

export const GOOGLE_DRIVE_STATUS_ACTION = 'google_drive.connection.status' as const;
export const GOOGLE_DRIVE_SEARCH_ACTION = 'google_drive.files.search' as const;
export const GOOGLE_DRIVE_LIST_FOLDER_ACTION = 'google_drive.folders.list' as const;
export const GOOGLE_DRIVE_READ_FILE_ACTION = 'google_drive.files.read' as const;
export const GOOGLE_DRIVE_SUMMARIZE_FILE_ACTION = 'google_drive.files.summarize' as const;
export const GOOGLE_DRIVE_CREATE_FOLDER_ACTION = 'google_drive.folders.create' as const;
export const GOOGLE_DRIVE_CREATE_DOC_ACTION = 'google_drive.docs.create' as const;
export const GOOGLE_DRIVE_UPLOAD_FILE_ACTION = 'google_drive.files.upload' as const;
export const GOOGLE_DRIVE_RENAME_MOVE_ACTION = 'google_drive.files.rename_move' as const;
export const GOOGLE_DRIVE_SHARE_FILE_ACTION = 'google_drive.files.share' as const;
export const GOOGLE_DRIVE_DELETE_FILE_ACTION = 'google_drive.files.delete' as const;

export const GoogleDriveEmptySchema = Type.Object({}, { additionalProperties: false });
export type GoogleDriveEmpty = Static<typeof GoogleDriveEmptySchema>;

export const GoogleDriveFileSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 256 }),
  name: Type.String({ minLength: 1, maxLength: 512 }),
  mimeType: Type.String({ minLength: 1, maxLength: 256 }),
  webViewLink: Type.Optional(Type.String({ maxLength: 2048 })),
  iconLink: Type.Optional(Type.String({ maxLength: 2048 })),
  size: Type.Optional(Type.Number()),
  modifiedTime: Type.Optional(Type.String({ maxLength: 64 })),
  createdTime: Type.Optional(Type.String({ maxLength: 64 })),
  parents: Type.Optional(Type.Array(Type.String())),
  shared: Type.Optional(Type.Boolean()),
  owners: Type.Optional(Type.Array(Type.String())),
  summary: Type.Optional(Type.String()),
  content: Type.Optional(Type.String())
});
export type GoogleDriveFile = Static<typeof GoogleDriveFileSchema>;

export const GoogleDriveStatusSchema = Type.Object(
  {
    connectorName: Type.Literal('google_drive'),
    status: Type.Union([
      Type.Literal('not_configured'),
      Type.Literal('disconnected'),
      Type.Literal('connected'),
      Type.Literal('reconnect_required')
    ]),
    configured: Type.Boolean(),
    connected: Type.Boolean(),
    mode: Type.Union([Type.Literal('disabled'), Type.Literal('mock'), Type.Literal('live')]),
    scopes: Type.Array(Type.String()),
    lastVerifiedAt: Type.Union([Type.String(), Type.Null()]),
    connectedEmail: Type.Optional(Type.String({ minLength: 3, maxLength: 320 })),
    message: Type.Optional(Type.String({ maxLength: 1024 }))
  },
  { additionalProperties: false }
);
export type GoogleDriveStatus = Static<typeof GoogleDriveStatusSchema>;

export const GoogleDriveSearchInputSchema = Type.Object(
  {
    query: Type.Optional(Type.String({ maxLength: 500 })),
    nameFilter: Type.Optional(Type.String({ maxLength: 256 })),
    mimeTypeFilter: Type.Optional(Type.String({ maxLength: 128 })),
    folderId: Type.Optional(Type.String({ maxLength: 256 })),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 }))
  },
  { additionalProperties: false }
);
export type GoogleDriveSearchInput = Static<typeof GoogleDriveSearchInputSchema>;

export const GoogleDriveListFolderInputSchema = Type.Object(
  {
    folderId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    folderName: Type.Optional(Type.String({ maxLength: 256 }))
  },
  { additionalProperties: false }
);
export type GoogleDriveListFolderInput = Static<typeof GoogleDriveListFolderInputSchema>;

export const GoogleDriveReadFileInputSchema = Type.Object(
  {
    fileId: Type.String({ maxLength: 256 }),
    fileName: Type.Optional(Type.String({ maxLength: 256 }))
  },
  { additionalProperties: false }
);
export type GoogleDriveReadFileInput = Static<typeof GoogleDriveReadFileInputSchema>;

export const GoogleDriveCreateFolderInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 256 }),
    parentFolderId: Type.Optional(Type.String({ maxLength: 256 }))
  },
  { additionalProperties: false }
);
export type GoogleDriveCreateFolderInput = Static<typeof GoogleDriveCreateFolderInputSchema>;

export const GoogleDriveCreateDocInputSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 256 }),
    content: Type.Optional(Type.String({ maxLength: 200000 })),
    parentFolderId: Type.Optional(Type.String({ maxLength: 256 }))
  },
  { additionalProperties: false }
);
export type GoogleDriveCreateDocInput = Static<typeof GoogleDriveCreateDocInputSchema>;

export const GoogleDriveUploadInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 256 }),
    content: Type.String({ maxLength: 200000 }),
    mimeType: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    folderId: Type.Optional(Type.String({ maxLength: 256 }))
  },
  { additionalProperties: false }
);
export type GoogleDriveUploadInput = Static<typeof GoogleDriveUploadInputSchema>;

export const GoogleDriveShareInputSchema = Type.Object(
  {
    fileId: Type.String({ minLength: 1, maxLength: 256 }),
    fileName: Type.Optional(Type.String({ maxLength: 256 })),
    email: Type.String({ minLength: 3, maxLength: 320 }),
    role: Type.Union([Type.Literal('reader'), Type.Literal('commenter'), Type.Literal('writer')]),
    confirmed: Type.Optional(Type.Boolean()),
    confirmationToken: Type.Optional(Type.String({ maxLength: 256 }))
  },
  { additionalProperties: false }
);
export type GoogleDriveShareInput = Static<typeof GoogleDriveShareInputSchema>;

export const GoogleDriveRenameMoveInputSchema = Type.Object(
  {
    fileId: Type.String({ minLength: 1, maxLength: 256 }),
    fileName: Type.Optional(Type.String({ maxLength: 256 })),
    newName: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    targetFolderId: Type.Optional(Type.String({ maxLength: 256 })),
    removeParents: Type.Optional(Type.String({ maxLength: 512 })),
    confirmed: Type.Optional(Type.Boolean()),
    confirmationToken: Type.Optional(Type.String({ maxLength: 256 }))
  },
  { additionalProperties: false }
);
export type GoogleDriveRenameMoveInput = Static<typeof GoogleDriveRenameMoveInputSchema>;

export const GoogleDriveDeleteInputSchema = Type.Object(
  {
    fileId: Type.String({ minLength: 1, maxLength: 256 }),
    fileName: Type.Optional(Type.String({ maxLength: 256 })),
    approvalToken: Type.Optional(Type.String({ maxLength: 256 }))
  },
  { additionalProperties: false }
);
export type GoogleDriveDeleteInput = Static<typeof GoogleDriveDeleteInputSchema>;

export const GoogleDriveOperationResultSchema = Type.Object({
  success: Type.Boolean(),
  operation: Type.String(),
  message: Type.String(),
  files: Type.Optional(Type.Array(GoogleDriveFileSchema)),
  file: Type.Optional(GoogleDriveFileSchema),
  folder: Type.Optional(GoogleDriveFileSchema),
  webViewLink: Type.Optional(Type.String()),
  requiresApproval: Type.Optional(Type.Boolean()),
  requiresConfirmation: Type.Optional(Type.Boolean()),
  approvalId: Type.Optional(Type.String())
});
export type GoogleDriveOperationResult = Static<typeof GoogleDriveOperationResultSchema>;
