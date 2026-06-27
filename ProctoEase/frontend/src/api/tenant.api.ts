import api from "./axios"
import type { Tenant, TenantCreateRequest } from "@/types"

export const tenantApi = {
  create: (data: TenantCreateRequest) =>
    api.post<Tenant>("/tenants/", data).then((r) => r.data),
}
