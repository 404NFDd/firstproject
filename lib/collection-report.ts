export interface CollectionReport {
  id: string
  name: string
  status: "success" | "partial" | "failed"
  received: number
  accepted: number
  excluded: number
  limited: number
  missingContent: number
  reasons: Record<string, number>
  durationMs: number
  error?: string
}
