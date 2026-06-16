-- ─────────────────────────────────────────────────────────────────────────────
-- 0024_premium_email_templates.sql
--
-- Full visual redesign of all 6 email templates.
-- Each template has:
--   • Dark branded header  (#0d0d10) + event-colour top border
--   • Full-width coloured event-type strip banner
--   • Large centred icon circle with soft background
--   • Short accent divider bar under the title
--   • Arabic RTL body with coloured bold variables
--   • Pill-shaped CTA button with box-shadow
--   • Clean light-grey footer
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. calendar_delivered  (emerald #10b981) ─────────────────────────────────

UPDATE public.notification_templates SET
  subject   = '🗓 تقويم {{month}} جاهز — {{post_count}} منشور ينتظرك',
  title     = 'تقويم {{month}} جاهز للمراجعة',
  body_html = $t1$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#e8f0ec;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
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
    <span style="color:#022c22;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">تقويم جديد جاهز</span>
  </td></tr>

  <!-- BODY -->
  <tr><td bgcolor="#ffffff" dir="rtl" lang="ar" style="background:#ffffff;padding:40px 32px 36px;text-align:right">

    <!-- Icon circle -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px"><tr>
      <td width="72" height="72" align="center" valign="middle" style="background:#d1fae5;border-radius:36px;width:72px;height:72px;font-size:34px;line-height:72px;text-align:center">🗓</td>
    </tr></table>

    <!-- Title -->
    <p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0f172a;text-align:center;line-height:1.3;font-family:Tahoma,'Segoe UI',Arial,sans-serif">تقويم {{month}} جاهز ✓</p>

    <!-- Accent bar -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:14px auto 22px"><tr>
      <td width="56" height="4" style="background:#10b981;border-radius:2px;width:56px;height:4px"></td>
    </tr></table>

    <!-- Greeting -->
    <p style="margin:0 0 10px;font-size:15px;color:#334155;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong style="color:#0f172a">{{brand_name}}</strong>،</p>

    <!-- Message -->
    <p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.9;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
      منشوراتك لشهر <strong style="color:#10b981">{{month}}</strong> جاهزة —
      <strong style="color:#10b981">{{post_count}} منشور</strong> في انتظار مراجعتك والموافقة عليها.
    </p>

    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>
      <td bgcolor="#10b981" style="background:#10b981;border-radius:50px;box-shadow:0 4px 16px rgba(16,185,129,0.40)">
        <a href="#" style="display:inline-block;padding:15px 48px;color:#022c22;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:0.3px;font-family:Tahoma,'Segoe UI',Arial,sans-serif">← عرض التقويم</a>
      </td>
    </tr></table>

  </td></tr>

  <!-- FOOTER -->
  <tr><td bgcolor="#f8fafc" style="background:#f8fafc;border-top:1px solid #f1f5f9;border-radius:0 0 20px 20px;padding:18px 28px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios © 2026 &nbsp;·&nbsp; هذا البريد تلقائي، لا ترد عليه مباشرة</p>
  </td></tr>

</table>
</td></tr>
</table>$t1$,
  body_text  = 'مرحباً {{brand_name}}، تقويم {{month}} جاهز ويحتوي على {{post_count}} منشور.',
  updated_at = NOW()
WHERE template_key = 'calendar_delivered' AND lang = 'ar';


-- ── 2. post_approved  (green #22c55e) ────────────────────────────────────────

UPDATE public.notification_templates SET
  subject   = '✅ تمت الموافقة على المنشور {{position}} في تقويم {{month}}',
  title     = 'تمت الموافقة على المنشور {{position}}',
  body_html = $t2$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#e8f5ec;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
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
    <span style="color:#14532d;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">تمت الموافقة ✓</span>
  </td></tr>

  <!-- BODY -->
  <tr><td bgcolor="#ffffff" dir="rtl" lang="ar" style="background:#ffffff;padding:40px 32px 36px;text-align:right">

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px"><tr>
      <td width="72" height="72" align="center" valign="middle" style="background:#dcfce7;border-radius:36px;width:72px;height:72px;font-size:34px;line-height:72px;text-align:center">✅</td>
    </tr></table>

    <p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0f172a;text-align:center;line-height:1.3;font-family:Tahoma,'Segoe UI',Arial,sans-serif">تمت الموافقة على المنشور {{position}}</p>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:14px auto 22px"><tr>
      <td width="56" height="4" style="background:#22c55e;border-radius:2px;width:56px;height:4px"></td>
    </tr></table>

    <p style="margin:0 0 10px;font-size:15px;color:#334155;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong style="color:#0f172a">{{brand_name}}</strong>،</p>

    <p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.9;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
      تمت الموافقة على المنشور رقم <strong style="color:#22c55e">{{position}}</strong>
      في تقويم <strong style="color:#22c55e">{{month}}</strong> بنجاح.
    </p>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>
      <td bgcolor="#22c55e" style="background:#22c55e;border-radius:50px;box-shadow:0 4px 16px rgba(34,197,94,0.40)">
        <a href="#" style="display:inline-block;padding:15px 48px;color:#14532d;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:0.3px;font-family:Tahoma,'Segoe UI',Arial,sans-serif">← عرض التقويم</a>
      </td>
    </tr></table>

  </td></tr>

  <tr><td bgcolor="#f8fafc" style="background:#f8fafc;border-top:1px solid #f1f5f9;border-radius:0 0 20px 20px;padding:18px 28px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios © 2026 &nbsp;·&nbsp; هذا البريد تلقائي، لا ترد عليه مباشرة</p>
  </td></tr>

</table>
</td></tr>
</table>$t2$,
  body_text  = 'مرحباً {{brand_name}}، تمت الموافقة على المنشور رقم {{position}} في تقويم {{month}}.',
  updated_at = NOW()
WHERE template_key = 'post_approved' AND lang = 'ar';


-- ── 3. post_rejected  (amber #f59e0b) ────────────────────────────────────────

UPDATE public.notification_templates SET
  subject   = '✏️ المنشور {{position}} يحتاج تعديل',
  title     = 'طُلب تعديل المنشور {{position}}',
  body_html = $t3$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#f5f0e8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
<tr><td align="center" style="padding:48px 16px">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-radius:20px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,0.14)">

  <!-- HEADER -->
  <tr><td bgcolor="#0d0d10" style="background:#0d0d10;border-top:5px solid #f59e0b;border-radius:20px 20px 0 0;padding:22px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="color:#fafafa;font-size:20px;font-weight:800;letter-spacing:-0.5px">OGz <span style="color:#f59e0b">Studios</span></td>
      <td align="left" style="color:#52525b;font-size:12px;font-weight:500">© 2026</td>
    </tr></table>
  </td></tr>

  <!-- EVENT STRIP -->
  <tr><td bgcolor="#f59e0b" align="center" style="background:#f59e0b;padding:10px 28px">
    <span style="color:#431407;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">طلب تعديل ↩</span>
  </td></tr>

  <!-- BODY -->
  <tr><td bgcolor="#ffffff" dir="rtl" lang="ar" style="background:#ffffff;padding:40px 32px 36px;text-align:right">

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px"><tr>
      <td width="72" height="72" align="center" valign="middle" style="background:#fef3c7;border-radius:36px;width:72px;height:72px;font-size:34px;line-height:72px;text-align:center">✏️</td>
    </tr></table>

    <p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0f172a;text-align:center;line-height:1.3;font-family:Tahoma,'Segoe UI',Arial,sans-serif">المنشور {{position}} يحتاج تعديل</p>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:14px auto 22px"><tr>
      <td width="56" height="4" style="background:#f59e0b;border-radius:2px;width:56px;height:4px"></td>
    </tr></table>

    <p style="margin:0 0 10px;font-size:15px;color:#334155;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong style="color:#0f172a">{{brand_name}}</strong>،</p>
    <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.9;font-family:Tahoma,'Segoe UI',Arial,sans-serif">طُلب تعديل المنشور رقم <strong style="color:#d97706">{{position}}</strong>.</p>

    <!-- Reason callout box -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px"><tr>
      <td style="background:#fffbeb;border:1px solid #fcd34d;border-right:4px solid #f59e0b;border-radius:8px;padding:14px 16px;font-size:14px;color:#92400e;line-height:1.7;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
        السبب: <strong>{{reason}}</strong>
      </td>
    </tr></table>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>
      <td bgcolor="#f59e0b" style="background:#f59e0b;border-radius:50px;box-shadow:0 4px 16px rgba(245,158,11,0.40)">
        <a href="#" style="display:inline-block;padding:15px 48px;color:#431407;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:0.3px;font-family:Tahoma,'Segoe UI',Arial,sans-serif">← عرض المنشور</a>
      </td>
    </tr></table>

  </td></tr>

  <tr><td bgcolor="#f8fafc" style="background:#f8fafc;border-top:1px solid #f1f5f9;border-radius:0 0 20px 20px;padding:18px 28px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios © 2026 &nbsp;·&nbsp; متاح حتى 3 مراجعات لكل منشور</p>
  </td></tr>

</table>
</td></tr>
</table>$t3$,
  body_text  = 'مرحباً {{brand_name}}، المنشور رقم {{position}} يحتاج تعديل. السبب: {{reason}}',
  updated_at = NOW()
WHERE template_key = 'post_rejected' AND lang = 'ar';


-- ── 4. revision_ready  (sky #38bdf8) ─────────────────────────────────────────

UPDATE public.notification_templates SET
  subject   = '🔄 المراجعة {{revision_number}} من 3 جاهزة — المنشور {{position}}',
  title     = 'المراجعة {{revision_number}} جاهزة للمنشور {{position}}',
  body_html = $t4$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#e8f4f8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
<tr><td align="center" style="padding:48px 16px">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-radius:20px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,0.14)">

  <!-- HEADER -->
  <tr><td bgcolor="#0d0d10" style="background:#0d0d10;border-top:5px solid #38bdf8;border-radius:20px 20px 0 0;padding:22px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="color:#fafafa;font-size:20px;font-weight:800;letter-spacing:-0.5px">OGz <span style="color:#38bdf8">Studios</span></td>
      <td align="left" style="color:#52525b;font-size:12px;font-weight:500">© 2026</td>
    </tr></table>
  </td></tr>

  <!-- EVENT STRIP -->
  <tr><td bgcolor="#38bdf8" align="center" style="background:#38bdf8;padding:10px 28px">
    <span style="color:#0c4a6e;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">مراجعة جاهزة 🔄</span>
  </td></tr>

  <!-- BODY -->
  <tr><td bgcolor="#ffffff" dir="rtl" lang="ar" style="background:#ffffff;padding:40px 32px 36px;text-align:right">

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px"><tr>
      <td width="72" height="72" align="center" valign="middle" style="background:#e0f2fe;border-radius:36px;width:72px;height:72px;font-size:34px;line-height:72px;text-align:center">🔄</td>
    </tr></table>

    <p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0f172a;text-align:center;line-height:1.3;font-family:Tahoma,'Segoe UI',Arial,sans-serif">المراجعة جاهزة للمعاينة</p>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:14px auto 22px"><tr>
      <td width="56" height="4" style="background:#38bdf8;border-radius:2px;width:56px;height:4px"></td>
    </tr></table>

    <p style="margin:0 0 10px;font-size:15px;color:#334155;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong style="color:#0f172a">{{brand_name}}</strong>،</p>

    <p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.9;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
      المراجعة رقم <strong style="color:#0ea5e9">{{revision_number}} من 3</strong>
      للمنشور <strong style="color:#0ea5e9">{{position}}</strong> جاهزة —
      يرجى المعاينة والموافقة من لوحة التحكم.
    </p>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>
      <td bgcolor="#38bdf8" style="background:#38bdf8;border-radius:50px;box-shadow:0 4px 16px rgba(56,189,248,0.40)">
        <a href="#" style="display:inline-block;padding:15px 48px;color:#0c4a6e;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:0.3px;font-family:Tahoma,'Segoe UI',Arial,sans-serif">← معاينة المنشور</a>
      </td>
    </tr></table>

  </td></tr>

  <tr><td bgcolor="#f8fafc" style="background:#f8fafc;border-top:1px solid #f1f5f9;border-radius:0 0 20px 20px;padding:18px 28px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios © 2026 &nbsp;·&nbsp; هذا البريد تلقائي، لا ترد عليه مباشرة</p>
  </td></tr>

</table>
</td></tr>
</table>$t4$,
  body_text  = 'مرحباً {{brand_name}}، المراجعة {{revision_number}} من 3 جاهزة للمنشور رقم {{position}}.',
  updated_at = NOW()
WHERE template_key = 'revision_ready' AND lang = 'ar';


-- ── 5. publish_success  (green #22c55e) ──────────────────────────────────────

UPDATE public.notification_templates SET
  subject   = '🚀 نُشر المنشور {{position}} على {{platform}} بنجاح',
  title     = 'نُشر المنشور {{position}} على {{platform}}',
  body_html = $t5$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#e8f5ec;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
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
    <span style="color:#14532d;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">نُشر بنجاح 🚀</span>
  </td></tr>

  <!-- BODY -->
  <tr><td bgcolor="#ffffff" dir="rtl" lang="ar" style="background:#ffffff;padding:40px 32px 36px;text-align:right">

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px"><tr>
      <td width="72" height="72" align="center" valign="middle" style="background:#dcfce7;border-radius:36px;width:72px;height:72px;font-size:34px;line-height:72px;text-align:center">🚀</td>
    </tr></table>

    <p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0f172a;text-align:center;line-height:1.3;font-family:Tahoma,'Segoe UI',Arial,sans-serif">نُشر المنشور بنجاح!</p>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:14px auto 22px"><tr>
      <td width="56" height="4" style="background:#22c55e;border-radius:2px;width:56px;height:4px"></td>
    </tr></table>

    <p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.9;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
      نُشر المنشور رقم <strong style="color:#22c55e">{{position}}</strong>
      على <strong style="color:#22c55e">{{platform}}</strong>
      بتاريخ <strong style="color:#22c55e">{{published_at}}</strong> بنجاح.
    </p>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>
      <td bgcolor="#22c55e" style="background:#22c55e;border-radius:50px;box-shadow:0 4px 16px rgba(34,197,94,0.40)">
        <a href="#" style="display:inline-block;padding:15px 48px;color:#14532d;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:0.3px;font-family:Tahoma,'Segoe UI',Arial,sans-serif">← عرض في لوحة التحكم</a>
      </td>
    </tr></table>

  </td></tr>

  <tr><td bgcolor="#f8fafc" style="background:#f8fafc;border-top:1px solid #f1f5f9;border-radius:0 0 20px 20px;padding:18px 28px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios © 2026 &nbsp;·&nbsp; هذا البريد تلقائي، لا ترد عليه مباشرة</p>
  </td></tr>

</table>
</td></tr>
</table>$t5$,
  body_text  = 'نُشر المنشور رقم {{position}} على {{platform}} بتاريخ {{published_at}}.',
  updated_at = NOW()
WHERE template_key = 'publish_success' AND lang = 'ar';


-- ── 6. publish_failed  (rose #f43f5e) ────────────────────────────────────────

UPDATE public.notification_templates SET
  subject   = '⚠️ فشل نشر المنشور {{position}} — يحتاج مراجعة',
  title     = 'فشل نشر المنشور {{position}}',
  body_html = $t6$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#f5e8ea;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
<tr><td align="center" style="padding:48px 16px">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-radius:20px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,0.14)">

  <!-- HEADER -->
  <tr><td bgcolor="#0d0d10" style="background:#0d0d10;border-top:5px solid #f43f5e;border-radius:20px 20px 0 0;padding:22px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="color:#fafafa;font-size:20px;font-weight:800;letter-spacing:-0.5px">OGz <span style="color:#f43f5e">Studios</span></td>
      <td align="left" style="color:#52525b;font-size:12px;font-weight:500">© 2026</td>
    </tr></table>
  </td></tr>

  <!-- EVENT STRIP -->
  <tr><td bgcolor="#f43f5e" align="center" style="background:#f43f5e;padding:10px 28px">
    <span style="color:#ffffff;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">فشل النشر ⚠️</span>
  </td></tr>

  <!-- BODY -->
  <tr><td bgcolor="#ffffff" dir="rtl" lang="ar" style="background:#ffffff;padding:40px 32px 36px;text-align:right">

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px"><tr>
      <td width="72" height="72" align="center" valign="middle" style="background:#ffe4e6;border-radius:36px;width:72px;height:72px;font-size:34px;line-height:72px;text-align:center">⚠️</td>
    </tr></table>

    <p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0f172a;text-align:center;line-height:1.3;font-family:Tahoma,'Segoe UI',Arial,sans-serif">فشل نشر المنشور {{position}}</p>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:14px auto 22px"><tr>
      <td width="56" height="4" style="background:#f43f5e;border-radius:2px;width:56px;height:4px"></td>
    </tr></table>

    <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.9;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
      لم يتم نشر المنشور رقم <strong style="color:#f43f5e">{{position}}</strong>.
    </p>

    <!-- Error callout box -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px"><tr>
      <td style="background:#fff1f2;border:1px solid #fda4af;border-right:4px solid #f43f5e;border-radius:8px;padding:14px 16px;font-size:14px;color:#be123c;line-height:1.7;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
        السبب: <strong>{{error}}</strong>
      </td>
    </tr></table>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>
      <td bgcolor="#f43f5e" style="background:#f43f5e;border-radius:50px;box-shadow:0 4px 16px rgba(244,63,94,0.40)">
        <a href="#" style="display:inline-block;padding:15px 48px;color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:0.3px;font-family:Tahoma,'Segoe UI',Arial,sans-serif">← إعادة المحاولة</a>
      </td>
    </tr></table>

  </td></tr>

  <tr><td bgcolor="#f8fafc" style="background:#f8fafc;border-top:1px solid #f1f5f9;border-radius:0 0 20px 20px;padding:18px 28px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios © 2026 &nbsp;·&nbsp; سيتواصل الفريق معك لحل المشكلة</p>
  </td></tr>

</table>
</td></tr>
</table>$t6$,
  body_text  = 'فشل نشر المنشور رقم {{position}}. السبب: {{error}}',
  updated_at = NOW()
WHERE template_key = 'publish_failed' AND lang = 'ar';
