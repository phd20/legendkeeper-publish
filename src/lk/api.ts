import type { Block } from "../convert/types";

export interface ResourceFieldsPatch {
  name?: string;
  tags?: string[];
  aliases?: string[];
  iconGlyph?: string;
  iconColor?: string;
  iconShape?: string;
  isHidden?: boolean;
}

export interface CreateResourceSpec extends ResourceFieldsPatch {
  id: string;
  name: string;
  /** Omit to create a top-level resource (used for the mount point). */
  parentId?: string;
}

export interface CreatedResource {
  id: string;
  /** Id of the resource's first (blank "Main") document. */
  documentId?: string;
}

export type ImageContentType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** The LegendKeeper operations the plugin uses. The SDK adapter implements it; tests use a fake. */
export interface LkApi {
  project(): Promise<{ id: string; name: string }>;
  listTopLevelResources(): Promise<Array<{ id: string; name: string }>>;
  /** Ids of every live resource in the project; used to re-link pages after the publish record is lost. */
  listResourceIds(): Promise<Set<string>>;
  createResources(specs: CreateResourceSpec[], idempotencyKey: string): Promise<CreatedResource[]>;
  updateResource(id: string, patch: ResourceFieldsPatch): Promise<void>;
  moveResource(id: string, parentId: string): Promise<void>;
  deleteResource(id: string, cascade: boolean): Promise<void>;
  /** The resource's first non-deleted document id. */
  getMainDocumentId(resourceId: string): Promise<string>;
  getPageVersion(resourceId: string, documentId: string): Promise<string>;
  replacePage(resourceId: string, documentId: string, blocks: Block[], ifMatch?: string): Promise<{ version: string }>;
  ensureAssetFolder(name: string): Promise<string>;
  uploadImage(input: { data: Uint8Array; contentType: ImageContentType; name: string; folderId?: string }): Promise<{ id: string; url: string }>;
}

export interface LkErrorInfo {
  status?: number;
  code?: string;
  message: string;
  requestId?: string;
}

/** Read the useful parts of any thrown value, including the SDK's LegendKeeperError, structurally. */
export function lkErrorInfo(error: unknown): LkErrorInfo {
  if (error && typeof error === "object") {
    const e = error as { status?: unknown; code?: unknown; message?: unknown; requestId?: unknown; errors?: unknown };
    const issues = Array.isArray(e.errors)
      ? (e.errors as Array<{ path?: unknown; message?: unknown }>)
          .slice(0, 3)
          .map((i) => `${typeof i.path === "string" ? i.path : "?"}: ${typeof i.message === "string" ? i.message : ""}`)
          .join("; ")
      : "";
    const base = typeof e.message === "string" ? e.message : "Unknown error";
    return {
      status: typeof e.status === "number" ? e.status : undefined,
      code: typeof e.code === "string" ? e.code : undefined,
      message: issues ? `${base} (${issues})` : base,
      requestId: typeof e.requestId === "string" ? e.requestId : undefined,
    };
  }
  return { message: typeof error === "string" ? error : "Unknown error" };
}
