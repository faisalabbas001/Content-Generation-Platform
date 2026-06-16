'use client'

export function ScoreRing({ score, color }: { score: number; color: string }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (score / 100) * circumference

  return (
    <div className="relative flex-shrink-0 w-36 h-36 flex items-center justify-center">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
        <circle
          cx="60" cy="60" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold text-white leading-none" style={{ color }}>{score}</span>
        <span className="text-white/30 text-xs">/100</span>
      </div>
    </div>
  )
}
