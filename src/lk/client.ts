import { LegendKeeper } from "@legendkeeper/sdk";
import type { Block } from "../convert/types";
import type { CreateResourceSpec, CreatedResource, ImageContentType, LkApi, ResourceFieldsPatch } from "./api";
import type { FetchLike } from "./fetch";

export interface ClientOptions {
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
}

/** Narrow structural view of the SDK calls used here, to keep the adapter readable. */
interface Sdk {
  project(): Promise<{ id: string; name?: string }>;
  resources: {
    list(options?: Record<string, unknown>): Promise<AsyncIterable<{ id: string; name: string; parentId?: string | null }>>;
    createMany(options: Record<string, unknown>): Promise<{ resources: Array<{ id: string; documents?: Array<{ id: string }> }> }>;
    update(params: { resourceId: string }, options: Record<string, unknown>): Promise<unknown>;
    move(params: { resourceId: string }, options: Record<string, unknown>): Promise<unknown>;
    delete(params: { resourceId: string }, options?: Record<string, unknown>): Promise<void>;
    get(params: { resourceId: string }): Promise<{ documents?: Array<{ id: string; deletedAt?: string }> }>;
  };
  documents: {
    getBlocks(params: { resourceId: string; documentId: string }): Promise<{ version: string }>;
    replaceBlocks(
      params: { resourceId: string; documentId: string },
      options: Record<string, unknown>,
    ): Promise<{ version: string }>;
  };
  assets: {
    list(options?: Record<string, unknown>): Promise<AsyncIterable<{ id: string; name: string; type: string }>>;
    createFolder(options: Record<string, unknown>): Promise<{ id: string }>;
    uploadImage(input: Record<string, unknown>): Promise<{ id: string; url: string }>;
  };
}

export const API_ORIGIN = "https://www.legendkeeper.com";

export function createLkApi(options: ClientOptions): LkApi {
  const sdk = new LegendKeeper({
    apiKey: options.apiKey,
    fetch: options.fetch,
    // Always pinned: left unset, the SDK would honour an environment variable and could send the key elsewhere.
    baseUrl: options.baseUrl ?? API_ORIGIN,
    maxRetries: 3,
    timeoutMs: 60_000,
  }) as unknown as Sdk;

  return {
    async project() {
      const p = await sdk.project();
      return { id: p.id, name: p.name ?? p.id };
    },

    async listTopLevelResources() {
      const out: Array<{ id: string; name: string }> = [];
      for await (const r of await sdk.resources.list({ limit: 100 })) {
        if (!r.parentId) out.push({ id: r.id, name: r.name });
      }
      return out;
    },

    async listResourceIds() {
      const ids = new Set<string>();
      for await (const r of await sdk.resources.list({ limit: 100 })) ids.add(r.id);
      return ids;
    },

    async createResources(specs: CreateResourceSpec[], idempotencyKey: string): Promise<CreatedResource[]> {
      const result = await sdk.resources.createMany({
        resources: specs.map((spec) => clean(spec)),
        idempotencyKey,
      });
      return result.resources.map((r) => ({ id: r.id, documentId: r.documents?.[0]?.id }));
    },

    async updateResource(id: string, patch: ResourceFieldsPatch) {
      await sdk.resources.update({ resourceId: id }, clean(patch));
    },

    async moveResource(id: string, parentId: string) {
      await sdk.resources.move({ resourceId: id }, { parentId });
    },

    async deleteResource(id: string, cascade: boolean) {
      await sdk.resources.delete({ resourceId: id }, cascade ? { cascade: true } : {});
    },

    async getMainDocumentId(resourceId: string) {
      const resource = await sdk.resources.get({ resourceId });
      const doc = resource.documents?.find((d) => !d.deletedAt);
      if (!doc) throw new Error(`Resource ${resourceId} has no document`);
      return doc.id;
    },

    async getPageVersion(resourceId: string, documentId: string) {
      return (await sdk.documents.getBlocks({ resourceId, documentId })).version;
    },

    async replacePage(resourceId: string, documentId: string, blocks: Block[], ifMatch?: string) {
      const result = await sdk.documents.replaceBlocks(
        { resourceId, documentId },
        { blocks, ...(ifMatch ? { ifMatch } : {}) },
      );
      return { version: result.version };
    },

    async ensureAssetFolder(name: string) {
      for await (const asset of await sdk.assets.list({ limit: 100 })) {
        if (asset.type === "FOLDER" && asset.name === name) return asset.id;
      }
      return (await sdk.assets.createFolder({ name })).id;
    },

    async uploadImage(input: { data: Uint8Array; contentType: ImageContentType; name: string; folderId?: string }) {
      const asset = await sdk.assets.uploadImage({ ...input });
      return { id: asset.id, url: asset.url };
    },
  };
}

function clean(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
