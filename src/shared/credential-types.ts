export interface CredentialV1 {
  id: string
  domain: string
  username: string
  password: string
  notes?: string
  updatedAt: number
}

export interface CredentialsApi {
  list(): Promise<CredentialV1[]>
  getForDomain(domain: string): Promise<CredentialV1 | null>
  save(domain: string, username: string, password: string, notes?: string): Promise<CredentialV1>
  delete(id: string): Promise<void>
  fill(domain: string): Promise<boolean>
  onSubmissionDetected(callback: (capture: { domain: string; username: string; password: string }) => void): () => void
  onFillRequested(callback: () => void): () => void
}
