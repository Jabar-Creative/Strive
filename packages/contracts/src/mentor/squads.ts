import { z } from 'zod';
import { uuidSchema } from '../common';
// Import (bukan re-export) leagueTierSchema — sama seperti domain `squad`.
import { leagueTierSchema } from '../league';

export const mentorSquadMemberRiskSchema = z.object({
  user_id: uuidSchema,
  display_name: z.string(),
  current_streak: z.number().int(),
  /** SK-9 `at_risk`: belum aktif hari ini, ≤4 jam tersisa. */
  at_risk: z.boolean(),
});
export type MentorSquadMemberRisk = z.infer<typeof mentorSquadMemberRiskSchema>;

/**
 * GET /mentor/squads — docs/PRD.md §10.3 ("Squad binaan + anggota berisiko
 * putus streak") + PR-7 (mentor hanya melihat squad yang `mentor_id`-nya
 * dirinya — ditegakkan di service, bukan di skema ini).
 */
export const mentorSquadSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  league_tier: leagueTierSchema,
  members_at_risk: z.array(mentorSquadMemberRiskSchema),
});
export type MentorSquad = z.infer<typeof mentorSquadSchema>;

export const mentorSquadsResponseSchema = z.array(mentorSquadSchema);
export type MentorSquadsResponse = z.infer<typeof mentorSquadsResponseSchema>;
