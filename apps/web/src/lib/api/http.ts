import type { ApiErrorShape } from './types'

export class ApiError extends Error {
  code?: string
  details?: string

  constructor(payload: ApiErrorShape) {
    super(payload.message)
    this.name = 'ApiError'
    this.code = payload.code
    this.details = payload.details
  }
}

export async function apiFetch<TResponse>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'message' in payload
        ? (payload as ApiErrorShape)
        : { message: `Request failed with status ${response.status}` }
    throw new ApiError(error)
  }

  return payload as TResponse
}
