-- Rate limiting table for free scorecard scans (spec §14.1: 3 free scans/IP/month)
CREATE TABLE IF NOT EXISTS sc_scan_rate_limits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash      text NOT NULL,
  year_month   char(7) NOT NULL, -- 'YYYY-MM'
  scan_count   int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ip_hash, year_month)
);

CREATE INDEX IF NOT EXISTS sc_scan_rate_limits_ip_month ON sc_scan_rate_limits (ip_hash, year_month);

-- No RLS needed — only accessible via service role key
