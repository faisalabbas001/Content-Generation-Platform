'use client'

/**
 * Last-resort error boundary used when the root layout itself throws.
 * Must render <html> and <body> manually.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en" dir="ltr">
      <body
        style={{
          background: '#09090b',
          color: '#fafafa',
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: 480,
            background: '#111114',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            padding: 32,
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: 22, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
            Application crashed
          </h1>
          <p style={{ color: '#a1a1aa', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>
            A fatal error happened. Try reloading the page.
          </p>
          {error.digest && (
            <p style={{ color: '#71717a', fontSize: 12, fontFamily: 'monospace', margin: '0 0 20px' }}>
              ref · {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              background: '#10b981',
              color: '#022c22',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              padding: '10px 18px',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Reload page
          </button>
        </div>
      </body>
    </html>
  )
}
