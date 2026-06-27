import { useMutation } from "@tanstack/react-query"
import { tenantApi } from "@/api/tenant.api"
import type { TenantCreateRequest } from "@/types"

export function useCreateTenant() {
  return useMutation({
    mutationFn: (data: TenantCreateRequest) => tenantApi.create(data),
  })
}
