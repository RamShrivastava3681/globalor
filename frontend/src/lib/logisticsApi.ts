import { api } from "@/lib/api-client";

export type Shipment = Record<string, any>;
export type ShipmentEvent = Record<string, any>;
export type ShipmentQuote = Record<string, any>;
export type LogisticsProvider = Record<string, any>;

export interface ShipmentDetail {
  shipment: Shipment;
  events: ShipmentEvent[];
  quotes: ShipmentQuote[];
  audit: Array<Record<string, any>>;
}

export const logisticsApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return api.get<Shipment[]>(`/shipments${qs}`);
  },
  summary: () => api.get<any>("/shipments/dashboard/summary"),
  prefill: (linked_doc_type: string, linked_doc_id: string) =>
    api.get<{ prefill: any; linked_doc_no: string | null }>(
      `/shipments/prefill?linked_doc_type=${encodeURIComponent(linked_doc_type)}&linked_doc_id=${encodeURIComponent(linked_doc_id)}`,
    ),
  create: (body: Record<string, any>) => api.post<Shipment>("/shipments", body),
  detail: (id: string) => api.get<ShipmentDetail>(`/shipments/${id}`),
  update: (id: string, body: Record<string, any>) => api.patch<Shipment>(`/shipments/${id}`, body),
  requestQuotes: (id: string, provider_id?: string) =>
    api.post<{ quotes: ShipmentQuote[]; failures: Array<{ provider: string; error: string }> }>(
      `/shipments/${id}/quotes/request`,
      provider_id ? { provider_id } : {},
    ),
  addQuote: (id: string, body: Record<string, any>) => api.post<ShipmentQuote>(`/shipments/${id}/quotes`, body),
  selectQuote: (id: string, quoteId: string) =>
    api.post<{ ok: boolean; quoted_freight: number }>(`/shipments/${id}/quotes/${quoteId}/select`, {}),
  bookManual: (id: string, body: Record<string, any>) => api.post<Shipment>(`/shipments/${id}/book/manual`, body),
  bookIntegrated: (id: string, provider_id: string) =>
    api.post<Shipment>(`/shipments/${id}/book/integrated`, { provider_id }),
  addEvent: (id: string, body: Record<string, any>) =>
    api.post<{ event: ShipmentEvent; shipment: Shipment }>(`/shipments/${id}/events`, body),
  cancel: (id: string, reason?: string) => api.post<Shipment>(`/shipments/${id}/cancel`, { reason }),
  addDocument: (id: string, body: Record<string, any>) => api.post<Shipment>(`/shipments/${id}/documents`, body),
  linkFreightInvoice: (id: string, body: Record<string, any>) =>
    api.post<Shipment>(`/shipments/${id}/freight-invoice`, body),

  providers: () => api.get<LogisticsProvider[]>("/logistics/providers"),
  createProvider: (body: Record<string, any>) => api.post<LogisticsProvider>("/logistics/providers", body),
  updateProvider: (id: string, body: Record<string, any>) =>
    api.patch<LogisticsProvider>(`/logistics/providers/${id}`, body),
  adapters: () => api.get<Array<{ key: string; label: string }>>("/logistics/providers/adapters/available"),

  settings: () => api.get<Record<string, any>>("/logistics/settings/current"),
  saveSettings: (body: Record<string, any>) => api.put<Record<string, any>>("/logistics/settings/current", body),
};
