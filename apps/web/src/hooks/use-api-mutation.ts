'use client'

import { useCallback, useState } from 'react'

export interface MutationState<TResult> {
  status: 'idle' | 'pending' | 'success' | 'error'
  data: TResult | null
  error: string | null
}

export function useApiMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
) {
  const [state, setState] = useState<MutationState<TResult>>({
    status: 'idle',
    data: null,
    error: null,
  })

  const mutateAsync = useCallback(
    async (input: TInput) => {
      setState({ status: 'pending', data: null, error: null })
      try {
        const result = await mutationFn(input)
        setState({ status: 'success', data: result, error: null })
        return result
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'Unexpected request error.'
        setState({ status: 'error', data: null, error: message })
        throw error
      }
    },
    [mutationFn],
  )

  return {
    ...state,
    isPending: state.status === 'pending',
    mutateAsync,
    reset: () =>
      setState({
        status: 'idle',
        data: null,
        error: null,
      }),
  }
}
