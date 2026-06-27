import { z } from "zod"

const baseRegisterSchema = z.object({
  full_name: z.string().min(2, "Name must be at least 2 characters").max(255),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirm_password: z.string(),
  role: z.enum(["admin", "recruiter", "candidate"]).default("candidate"),
  tenant_slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, and hyphens"),
})

export const registerSchema = baseRegisterSchema.refine(
  (d) => d.password === d.confirm_password,
  {
    message: "Passwords don't match",
    path: ["confirm_password"],
  }
)

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  tenant_slug: z.string().min(2, "Organisation slug is required").max(100),
})

// Use the BASE schema for the form type (before .refine) so RHF generics work
export type RegisterFormValues = z.infer<typeof baseRegisterSchema>
export type LoginFormValues = z.infer<typeof loginSchema>
