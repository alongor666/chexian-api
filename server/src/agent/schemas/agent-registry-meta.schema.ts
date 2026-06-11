import { z } from 'zod';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const AgentRegistryIdSchema = z.enum([
  'agent-metric',
  'agent-data-capability',
  'agent-forecast-output',
  'unsupported-metric',
]);

export const AgentRegistryChangelogEntrySchema = z.object({
  version: z.string().regex(SEMVER_PATTERN),
  date: z.string().regex(DATE_PATTERN),
  changes: z.string().min(1),
});

export const AgentRegistryMetaSchema = z
  .object({
    registryId: AgentRegistryIdSchema,
    version: z.string().regex(SEMVER_PATTERN),
    changelog: z.array(AgentRegistryChangelogEntrySchema).min(1),
  })
  .refine((meta) => meta.changelog[meta.changelog.length - 1]?.version === meta.version, {
    message: 'version 必须等于 changelog 最后一条的 version',
    path: ['version'],
  });

export const AgentRegistryVersionSchema = z.object({
  registryId: AgentRegistryIdSchema,
  version: z.string().regex(SEMVER_PATTERN),
  entryCount: z.number().int().nonnegative(),
});

export type AgentRegistryId = z.infer<typeof AgentRegistryIdSchema>;
export type AgentRegistryChangelogEntry = z.infer<typeof AgentRegistryChangelogEntrySchema>;
export type AgentRegistryMeta = z.infer<typeof AgentRegistryMetaSchema>;
export type AgentRegistryVersion = z.infer<typeof AgentRegistryVersionSchema>;

export function toRegistryVersion(
  meta: AgentRegistryMeta,
  entryCount: number
): AgentRegistryVersion {
  return AgentRegistryVersionSchema.parse({
    registryId: meta.registryId,
    version: meta.version,
    entryCount,
  });
}
