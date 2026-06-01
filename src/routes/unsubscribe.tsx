import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/unsubscribe')({
  head: () => ({ meta: [{ title: 'Unsubscribe — Bio Mark' }] }),
  component: UnsubscribePage,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
})

type Status = 'checking' | 'valid' | 'already' | 'invalid' | 'done' | 'error'

function UnsubscribePage() {
  const { token } = Route.useSearch()
  const [status, setStatus] = useState<Status>('checking')
  const [message, setMessage] = useState<string>('')

  useEffect(() => {
    if (!token) {
      setStatus('invalid')
      setMessage('Missing token.')
      return
    }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          setStatus('invalid')
          setMessage(data?.error ?? 'Invalid or expired link.')
          return
        }
        if (data.valid) setStatus('valid')
        else setStatus('already')
      })
      .catch(() => {
        setStatus('error')
        setMessage('Could not reach the server.')
      })
  }, [token])

  const confirm = async () => {
    try {
      const r = await fetch('/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.ok && data.success) setStatus('done')
      else if (data?.reason === 'already_unsubscribed') setStatus('already')
      else {
        setStatus('error')
        setMessage(data?.error ?? 'Failed to unsubscribe.')
      }
    } catch {
      setStatus('error')
      setMessage('Could not reach the server.')
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      <h1 className="font-display text-3xl">Email preferences</h1>

      {status === 'checking' && (
        <p className="mt-6 text-muted-foreground">Checking your link…</p>
      )}

      {status === 'valid' && (
        <>
          <p className="mt-6 text-muted-foreground">
            Click below to unsubscribe from Bio Mark emails. You'll stop receiving
            notifications about your certificates.
          </p>
          <button
            onClick={confirm}
            className="mt-8 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Confirm unsubscribe
          </button>
        </>
      )}

      {status === 'already' && (
        <p className="mt-6 text-muted-foreground">
          This address is already unsubscribed.
        </p>
      )}

      {status === 'done' && (
        <p className="mt-6 text-muted-foreground">
          You've been unsubscribed. We won't email you again.
        </p>
      )}

      {(status === 'invalid' || status === 'error') && (
        <p className="mt-6 text-sm text-destructive">{message}</p>
      )}
    </main>
  )
}
