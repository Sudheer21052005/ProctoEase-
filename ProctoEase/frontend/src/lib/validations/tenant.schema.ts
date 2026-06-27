import { z } from "zod"

export const tenantCreateSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(255),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, and hyphens"),
})

export type TenantCreateFormValues = z.infer<typeof tenantCreateSchema>
