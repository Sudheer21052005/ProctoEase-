import { z } from "zod"

export const examCreateSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(500),
  description: z.string().nullable().optional(),
  duration_minutes: z.number().min(5, "Minimum 5 minutes").max(480, "Maximum 8 hours"),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  is_published: z.boolean(),
}).refine((data) => {
  if (!data.start_time || !data.end_time) return true
  return new Date(data.end_time).getTime() > new Date(data.start_time).getTime()
}, {
  message: "End time must be after start time",
  path: ["end_time"],
})

export type ExamCreateFormValues = z.infer<typeof examCreateSchema>
