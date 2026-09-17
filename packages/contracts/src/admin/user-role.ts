import { z } from 'zod';
// Import (bukan re-export) — didefinisikan sekali di domain `auth`.
import { userRoleSchema, userSchema } from '../auth';

/**
 * PATCH /admin/users/:id/role — docs/PRD.md §10.3 ("Menunjuk mentor") + AU-9
 * (hanya Superadmin, tercatat di `audit_log`).
 */
export const updateUserRoleRequestSchema = z.object({
  role: userRoleSchema,
});
export type UpdateUserRoleRequest = z.infer<typeof updateUserRoleRequestSchema>;

/** User yang sudah diperbarui — bentuknya sama dengan objek user umum. */
export const updateUserRoleResponseSchema = userSchema;
export type UpdateUserRoleResponse = z.infer<typeof updateUserRoleResponseSchema>;
