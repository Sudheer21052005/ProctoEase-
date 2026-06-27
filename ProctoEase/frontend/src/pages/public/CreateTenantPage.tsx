import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Link, useNavigate } from "react-router-dom"
import { Loader2, Building } from "lucide-react"
import { toast } from "sonner"
import AuthLayout from "@/components/layout/AuthLayout"
import {
  tenantCreateSchema,
  type TenantCreateFormValues,
} from "@/lib/validations/tenant.schema"
import { useCreateTenant } from "@/hooks/useTenants"
import type { AxiosError } from "axios"

export default function CreateTenantPage() {
  const navigate = useNavigate()
  const mutation = useCreateTenant()

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<TenantCreateFormValues>({
    resolver: zodResolver(tenantCreateSchema),
  })

  const slug = watch("slug", "")

  const onSubmit = (data: TenantCreateFormValues) => {
    mutation.mutate(data, {
      onSuccess: (tenant) => {
        toast.success(`Organisation "${tenant.name}" created!`)
        navigate(`/register?tenant=${tenant.slug}`)
      },
      onError: (err) => {
        const axiosErr = err as AxiosError<{ detail: string }>
        toast.error(axiosErr.response?.data?.detail || "Failed to create organisation")
      },
    })
  }

  return (
    <AuthLayout>
      <div className="text-center mb-6">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
          <Building className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold">Create Organisation</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Set up your tenant to get started
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Name */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-1.5">
            Organisation Name
          </label>
          <input
            id="name"
            type="text"
            placeholder="Acme Corporation"
            {...register("name")}
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          {errors.name && (
            <p className="text-xs text-danger mt-1">{errors.name.message}</p>
          )}
        </div>

        {/* Slug */}
        <div>
          <label htmlFor="slug" className="block text-sm font-medium mb-1.5">
            URL Slug
          </label>
          <input
            id="slug"
            type="text"
            placeholder="acme-corp"
            {...register("slug")}
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          {slug && (
            <p className="text-xs text-muted-foreground mt-1">
              Users will register with slug:{" "}
              <span className="font-mono text-primary">{slug}</span>
            </p>
          )}
          {errors.slug && (
            <p className="text-xs text-danger mt-1">{errors.slug.message}</p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full bg-primary text-primary-foreground font-medium py-2.5 rounded-lg hover:bg-primary-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Create Organisation
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an organisation?{" "}
        <Link to="/login" className="text-primary font-medium hover:underline">
          Sign In
        </Link>
      </p>
    </AuthLayout>
  )
}
