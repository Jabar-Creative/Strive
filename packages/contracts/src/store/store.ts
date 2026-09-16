import { z } from 'zod';
import { coinAmountSchema, isoDateTimeSchema, uuidSchema } from '../common';

/**
 * `store_items.kind` — docs/PRD.md §9.3 tidak menuliskan nilai enum eksplisit,
 * hanya deskripsi §7 E14 SR-1: "pustaka prompt, template workspace, aset
 * desain". ASUMSI penamaan kind di bawah ini; perlu disepakati dengan Dev A
 * saat migrasi seed 8 item ditulis (F-11).
 */
export const storeItemKindSchema = z.enum(['prompt_library', 'workspace_template', 'design_asset']);
export type StoreItemKind = z.infer<typeof storeItemKindSchema>;

/** GET /store/items — docs/PRD.md §10.3 ("Etalase"). */
export const storeItemSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  title: z.string(),
  kind: storeItemKindSchema,
  price_coins: coinAmountSchema,
  is_active: z.boolean(),
});
export type StoreItem = z.infer<typeof storeItemSchema>;

export const storeItemsResponseSchema = z.array(storeItemSchema);
export type StoreItemsResponse = z.infer<typeof storeItemsResponseSchema>;

/** POST /store/purchase — docs/PRD.md §10.3 ("Debit koin + terbitkan hak akses"). */
export const purchaseStoreItemRequestSchema = z.object({
  item_id: uuidSchema,
});
export type PurchaseStoreItemRequest = z.infer<typeof purchaseStoreItemRequestSchema>;

export const purchaseStoreItemResponseSchema = z.object({
  purchase_id: uuidSchema,
  item_id: uuidSchema,
  price_coins: coinAmountSchema,
  balance: coinAmountSchema,
});
export type PurchaseStoreItemResponse = z.infer<typeof purchaseStoreItemResponseSchema>;

/**
 * GET /store/purchases/:id/download — docs/PRD.md §10.3 ("→ signed URL 15
 * menit") + §7 E14 SR-5.
 */
export const storePurchaseDownloadResponseSchema = z.object({
  url: z.string().url(),
  expires_at: isoDateTimeSchema,
});
export type StorePurchaseDownloadResponse = z.infer<typeof storePurchaseDownloadResponseSchema>;
