-- ─────────────────────────────────────────────────────────────────────────────
-- 0098_calendar_email_flags.sql
--
-- Two boolean tracking columns on the calendars table so duplicate
-- notification emails are never sent for the same event:
--
--   generated_email_sent  — set to TRUE after the "pending review" email is
--                           sent by /api/calendar/notify (called from N8N-A01
--                           immediately after the calendar row is upserted).
--
--   approved_email_sent   — set to TRUE after the "calendar approved" email
--                           is sent by bulkApproveCalendar() in qa.ts.
--
-- Both columns default to FALSE. The application does an optimistic atomic
-- compare-and-set (UPDATE … WHERE flag = FALSE) before sending, so concurrent
-- triggers cannot double-send even under race conditions.
--
-- Also seeds two new notification_templates rows:
--   calendar_pending_review  — sent when A01 finishes generating a calendar
--   calendar_approved        — sent when admin bulk-approves a calendar
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Schema changes ─────────────────────────────────────────────────────────

ALTER TABLE public.calendars
  ADD COLUMN IF NOT EXISTS generated_email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_email_sent  BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Notification template: calendar_pending_review (ar) ───────────────────
-- Sent by /api/calendar/notify when type='generated'.
-- Variables: brand_name, month, calendar_url

INSERT INTO public.notification_templates
  (template_key, lang, subject, title, body_html, body_text, variables)
VALUES (
  'calendar_pending_review',
  'ar',
  '🗓 تقويم {{month}} في انتظار المراجعة',
  'تم إنشاء تقويم {{month}} — قيد المراجعة الإدارية',
  $t_pending$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#e8f0ec;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
<tr><td align="center" style="padding:48px 16px">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-radius:20px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,0.14)">

  <!-- HEADER -->
  <tr><td bgcolor="#0d0d10" style="background:#0d0d10;border-top:5px solid #10b981;border-radius:20px 20px 0 0;padding:22px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="color:#fafafa;font-size:20px;font-weight:800;letter-spacing:-0.5px">OGz <span style="color:#10b981">Studios</span></td>
      <td align="left" style="color:#52525b;font-size:12px;font-weight:500">© 2026</td>
    </tr></table>
  </td></tr>

  <!-- EVENT STRIP -->
  <tr><td bgcolor="#10b981" align="center" style="background:#10b981;padding:10px 28px">
    <span style="color:#022c22;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">تقويم جديد — قيد المراجعة</span>
  </td></tr>

  <!-- BODY -->
  <tr><td bgcolor="#ffffff" dir="rtl" lang="ar" style="background:#ffffff;padding:40px 32px 36px;text-align:right">

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px"><tr>
      <td width="72" height="72" align="center" valign="middle" style="background:#d1fae5;border-radius:36px;width:72px;height:72px;font-size:34px;line-height:72px;text-align:center">🗓</td>
    </tr></table>

    <p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0f172a;text-align:center;line-height:1.3;font-family:Tahoma,'Segoe UI',Arial,sans-serif">تم إنشاء تقويم {{month}}</p>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:14px auto 22px"><tr>
      <td width="56" height="4" style="background:#10b981;border-radius:2px;width:56px;height:4px"></td>
    </tr></table>

    <p style="margin:0 0 10px;font-size:15px;color:#334155;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong style="color:#0f172a">{{brand_name}}</strong>،</p>

    <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.9;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
      تم إنشاء تقويم شهر <strong style="color:#10b981">{{month}}</strong> بنجاح وهو الآن في انتظار المراجعة الإدارية.
    </p>

    <!-- Info callout -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px"><tr>
      <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-right:4px solid #10b981;border-radius:8px;padding:14px 16px;font-size:14px;color:#166534;line-height:1.7;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
        سيظهر التقويم في لوحة التحكم بمجرد اعتماده من الإدارة. ستصلك رسالة أخرى عند الاعتماد.
      </td>
    </tr></table>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>
      <td bgcolor="#10b981" style="background:#10b981;border-radius:50px;box-shadow:0 4px 16px rgba(16,185,129,0.40)">
        <a href="{{calendar_url}}" style="display:inline-block;padding:15px 48px;color:#022c22;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:0.3px;font-family:Tahoma,'Segoe UI',Arial,sans-serif">← عرض التقويم</a>
      </td>
    </tr></table>

  </td></tr>

  <!-- FOOTER -->
  <tr><td bgcolor="#f8fafc" style="background:#f8fafc;border-top:1px solid #f1f5f9;border-radius:0 0 20px 20px;padding:18px 28px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios © 2026 &nbsp;·&nbsp; هذا البريد تلقائي، لا ترد عليه مباشرة</p>
  </td></tr>

</table>
</td></tr>
</table>$t_pending$,
  'مرحباً {{brand_name}}، تم إنشاء تقويم {{month}} وهو قيد المراجعة الإدارية. ستصلك رسالة أخرى عند الاعتماد.',
  '["brand_name","month","calendar_url"]'
)
ON CONFLICT (template_key, lang) DO NOTHING;

-- ── 3. Notification template: calendar_approved (ar) ─────────────────────────
-- Sent by bulkApproveCalendar() when admin approves all posts for a calendar.
-- Variables: brand_name, month, calendar_url

INSERT INTO public.notification_templates
  (template_key, lang, subject, title, body_html, body_text, variables)
VALUES (
  'calendar_approved',
  'ar',
  '✅ تم اعتماد تقويم {{month}} — يمكنك الاطلاع عليه الآن',
  'تم اعتماد تقويم {{month}}',
  $t_approved$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#e8f5ec;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
<tr><td align="center" style="padding:48px 16px">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-radius:20px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,0.14)">

  <!-- HEADER -->
  <tr><td bgcolor="#0d0d10" style="background:#0d0d10;border-top:5px solid #22c55e;border-radius:20px 20px 0 0;padding:22px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="color:#fafafa;font-size:20px;font-weight:800;letter-spacing:-0.5px">OGz <span style="color:#22c55e">Studios</span></td>
      <td align="left" style="color:#52525b;font-size:12px;font-weight:500">© 2026</td>
    </tr></table>
  </td></tr>

  <!-- EVENT STRIP -->
  <tr><td bgcolor="#22c55e" align="center" style="background:#22c55e;padding:10px 28px">
    <span style="color:#14532d;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">تم الاعتماد ✓</span>
  </td></tr>

  <!-- BODY -->
  <tr><td bgcolor="#ffffff" dir="rtl" lang="ar" style="background:#ffffff;padding:40px 32px 36px;text-align:right">

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px"><tr>
      <td width="72" height="72" align="center" valign="middle" style="background:#dcfce7;border-radius:36px;width:72px;height:72px;font-size:34px;line-height:72px;text-align:center">✅</td>
    </tr></table>

    <p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0f172a;text-align:center;line-height:1.3;font-family:Tahoma,'Segoe UI',Arial,sans-serif">تم اعتماد تقويم {{month}} ✓</p>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:14px auto 22px"><tr>
      <td width="56" height="4" style="background:#22c55e;border-radius:2px;width:56px;height:4px"></td>
    </tr></table>

    <p style="margin:0 0 10px;font-size:15px;color:#334155;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong style="color:#0f172a">{{brand_name}}</strong>،</p>

    <p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.9;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
      تمت الموافقة الإدارية على تقويم شهر <strong style="color:#22c55e">{{month}}</strong>.
      يمكنك الآن الاطلاع عليه والتحقق من جميع المنشورات في لوحة التحكم.
    </p>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>
      <td bgcolor="#22c55e" style="background:#22c55e;border-radius:50px;box-shadow:0 4px 16px rgba(34,197,94,0.40)">
        <a href="{{calendar_url}}" style="display:inline-block;padding:15px 48px;color:#14532d;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:0.3px;font-family:Tahoma,'Segoe UI',Arial,sans-serif">← عرض التقويم الآن</a>
      </td>
    </tr></table>

  </td></tr>

  <!-- FOOTER -->
  <tr><td bgcolor="#f8fafc" style="background:#f8fafc;border-top:1px solid #f1f5f9;border-radius:0 0 20px 20px;padding:18px 28px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios © 2026 &nbsp;·&nbsp; هذا البريد تلقائي، لا ترد عليه مباشرة</p>
  </td></tr>

</table>
</td></tr>
</table>$t_approved$,
  'مرحباً {{brand_name}}، تم اعتماد تقويم {{month}} من قِبل الإدارة. يمكنك الاطلاع عليه الآن.',
  '["brand_name","month","calendar_url"]'
)
ON CONFLICT (template_key, lang) DO NOTHING;
