import { z } from "zod";
import { ORG_PERSONAS, type Persona } from "./persona";

export const ORG_TYPES = ["institution", "employer", "sponsor", "platform"] as const;
export type OrganizationType = (typeof ORG_TYPES)[number];

/** The org type a persona governs, used to seed the founder membership. */
export const ORG_TYPE_ADMIN_PERSONA: Record<Exclude<OrganizationType, "platform">, Persona> = {
  institution: "institution",
  employer: "employer",
  sponsor: "sponsor",
};

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(50, "Use at most 50 characters.")
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])$/, "Use lowercase letters, numbers and hyphens.");

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(160),
  slug: slugSchema,
  type: z.enum(["institution", "employer", "sponsor"]),
  website: z.string().trim().url("Enter a valid URL.").max(300).optional().or(z.literal("")),
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Use a two-letter country code.")
    .transform((v) => v.toUpperCase())
    .optional()
    .or(z.literal("")),
});

export const inviteMemberSchema = z.object({
  organizationId: z.uuid("Choose an organization."),
  profileId: z.uuid("Choose a member."),
  persona: z.enum(ORG_PERSONAS),
  title: z.string().trim().max(120).optional().or(z.literal("")),
});

export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}
