-- ─────────────────────────────────────────────────────────────────────────────
-- 0023_improved_email_templates.sql
--
-- Replaces bare-bones email templates with professionally designed HTML.
-- Uses the actual OGz Studios design-system colors from tokens.css:
--   • Primary accent  #10b981  (emerald --accent)
--   • Dark header     #09090b  (--bg)
--   • Success         #22c55e  (--success)
--   • Warning         #f59e0b  (--warning)
--   • Danger          #f43f5e  (--danger)
--   • Info            #38bdf8  (--info)
--
-- Layout: dark header (#09090b) + accent top-border → white body card → light footer
-- All styles are inline (email-client safe, no external CSS).
-- Font stack: Tahoma / Segoe UI (best Arabic support across email clients).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. calendar_delivered ─────────────────────────────────────────────────────

UPDATE public.notification_templates SET
  subject    = 'تقويم {{month}} جاهز — {{post_count}} منشور ينتظرك 🗓',
  title      = 'تقويم {{month}} جاهز للمراجعة',
  body_html  = $$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#f4f4f5;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
  <tr><td align="center" style="padding:32px 16px">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">

      <!-- Header -->
      <tr><td style="background:#09090b;border-radius:12px 12px 0 0;border-top:4px solid #10b981;padding:20px 32px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="color:#fafafa;font-size:17px;font-weight:700;letter-spacing:-0.3px">OGz Studios</td>
          <td align="left" style="color:#52525b;font-size:12px">2026</td>
        </tr></table>
      </td></tr>

      <!-- Body -->
      <tr><td dir="rtl" lang="ar" style="background:#ffffff;padding:32px 32px 28px;text-align:right">
        <h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#10b981;font-family:Tahoma,'Segoe UI',Arial,sans-serif">تقويم {{month}} جاهز 🗓</h2>
        <p style="margin:0 0 8px;font-size:15px;color:#18181b;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong>{{brand_name}}</strong>،</p>
        <p style="margin:0 0 28px;font-size:15px;color:#18181b;line-height:1.7;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          منشوراتك لشهر <strong>{{month}}</strong> جاهزة —
          <strong>{{post_count}} منشور</strong> في انتظار مراجعتك والموافقة عليها.
        </p>
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:#10b981;border-radius:8px">
            <a style="display:inline-block;padding:12px 28px;color:#022c22;font-size:14px;font-weight:600;text-decoration:none;font-family:Tahoma,'Segoe UI',Arial,sans-serif">عرض التقويم</a>
          </td>
        </tr></table>
      </td></tr>

      <!-- Footer -->
      <tr><td dir="rtl" style="background:#f9fafb;border-radius:0 0 12px 12px;border-top:1px solid #e4e4e7;padding:16px 32px;text-align:right">
        <p style="margin:0;font-size:12px;color:#71717a;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios &#169; 2026 &nbsp;&#183;&nbsp; هذا البريد تلقائي، لا ترد عليه مباشرة</p>
      </td></tr>

    </table>
  </td></tr>
</table>$$,
  body_text  = 'مرحباً {{brand_name}}، تقويم {{month}} جاهز ويحتوي على {{post_count}} منشور في انتظار مراجعتك.',
  updated_at = NOW()
WHERE template_key = 'calendar_delivered' AND lang = 'ar';


-- ── 2. post_approved ──────────────────────────────────────────────────────────

UPDATE public.notification_templates SET
  subject    = 'تمت الموافقة على المنشور {{position}} ✓',
  title      = 'تمت الموافقة على المنشور {{position}}',
  body_html  = $$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#f4f4f5;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
  <tr><td align="center" style="padding:32px 16px">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">

      <!-- Header -->
      <tr><td style="background:#09090b;border-radius:12px 12px 0 0;border-top:4px solid #22c55e;padding:20px 32px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="color:#fafafa;font-size:17px;font-weight:700;letter-spacing:-0.3px">OGz Studios</td>
          <td align="left" style="color:#52525b;font-size:12px">2026</td>
        </tr></table>
      </td></tr>

      <!-- Body -->
      <tr><td dir="rtl" lang="ar" style="background:#ffffff;padding:32px 32px 28px;text-align:right">
        <h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#22c55e;font-family:Tahoma,'Segoe UI',Arial,sans-serif">تمت الموافقة على المنشور ✓</h2>
        <p style="margin:0 0 8px;font-size:15px;color:#18181b;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong>{{brand_name}}</strong>،</p>
        <p style="margin:0 0 28px;font-size:15px;color:#18181b;line-height:1.7;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          تمت الموافقة على المنشور رقم <strong>{{position}}</strong> في تقويم <strong>{{month}}</strong>.
        </p>
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:#10b981;border-radius:8px">
            <a style="display:inline-block;padding:12px 28px;color:#022c22;font-size:14px;font-weight:600;text-decoration:none;font-family:Tahoma,'Segoe UI',Arial,sans-serif">عرض التقويم</a>
          </td>
        </tr></table>
      </td></tr>

      <!-- Footer -->
      <tr><td dir="rtl" style="background:#f9fafb;border-radius:0 0 12px 12px;border-top:1px solid #e4e4e7;padding:16px 32px;text-align:right">
        <p style="margin:0;font-size:12px;color:#71717a;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios &#169; 2026 &nbsp;&#183;&nbsp; هذا البريد تلقائي، لا ترد عليه مباشرة</p>
      </td></tr>

    </table>
  </td></tr>
</table>$$,
  body_text  = 'مرحباً {{brand_name}}، تمت الموافقة على المنشور رقم {{position}} في تقويم {{month}}.',
  updated_at = NOW()
WHERE template_key = 'post_approved' AND lang = 'ar';


-- ── 3. post_rejected ──────────────────────────────────────────────────────────

UPDATE public.notification_templates SET
  subject    = 'المنشور {{position}} يحتاج تعديل ↩',
  title      = 'طُلب تعديل المنشور {{position}}',
  body_html  = $$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#f4f4f5;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
  <tr><td align="center" style="padding:32px 16px">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">

      <!-- Header -->
      <tr><td style="background:#09090b;border-radius:12px 12px 0 0;border-top:4px solid #f59e0b;padding:20px 32px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="color:#fafafa;font-size:17px;font-weight:700;letter-spacing:-0.3px">OGz Studios</td>
          <td align="left" style="color:#52525b;font-size:12px">2026</td>
        </tr></table>
      </td></tr>

      <!-- Body -->
      <tr><td dir="rtl" lang="ar" style="background:#ffffff;padding:32px 32px 28px;text-align:right">
        <h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#f59e0b;font-family:Tahoma,'Segoe UI',Arial,sans-serif">طُلب تعديل المنشور ↩</h2>
        <p style="margin:0 0 8px;font-size:15px;color:#18181b;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong>{{brand_name}}</strong>،</p>
        <p style="margin:0 0 12px;font-size:15px;color:#18181b;line-height:1.7;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          طُلب تعديل المنشور رقم <strong>{{position}}</strong>.
        </p>
        <p style="margin:0 0 28px;font-size:14px;color:#18181b;line-height:1.6;background:#fefce8;border-right:3px solid #f59e0b;padding:12px 14px;border-radius:0 6px 6px 0;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          السبب: <strong>{{reason}}</strong>
        </p>
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:#10b981;border-radius:8px">
            <a style="display:inline-block;padding:12px 28px;color:#022c22;font-size:14px;font-weight:600;text-decoration:none;font-family:Tahoma,'Segoe UI',Arial,sans-serif">عرض المنشور</a>
          </td>
        </tr></table>
      </td></tr>

      <!-- Footer -->
      <tr><td dir="rtl" style="background:#f9fafb;border-radius:0 0 12px 12px;border-top:1px solid #e4e4e7;padding:16px 32px;text-align:right">
        <p style="margin:0;font-size:12px;color:#71717a;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios &#169; 2026 &nbsp;&#183;&nbsp; متاح حتى 3 مراجعات لكل منشور</p>
      </td></tr>

    </table>
  </td></tr>
</table>$$,
  body_text  = 'مرحباً {{brand_name}}، المنشور رقم {{position}} يحتاج تعديل. السبب: {{reason}}',
  updated_at = NOW()
WHERE template_key = 'post_rejected' AND lang = 'ar';


-- ── 4. revision_ready ─────────────────────────────────────────────────────────

UPDATE public.notification_templates SET
  subject    = 'المراجعة {{revision_number}} من 3 جاهزة — المنشور {{position}} 🔄',
  title      = 'المراجعة {{revision_number}} جاهزة للمنشور {{position}}',
  body_html  = $$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#f4f4f5;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
  <tr><td align="center" style="padding:32px 16px">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">

      <!-- Header -->
      <tr><td style="background:#09090b;border-radius:12px 12px 0 0;border-top:4px solid #38bdf8;padding:20px 32px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="color:#fafafa;font-size:17px;font-weight:700;letter-spacing:-0.3px">OGz Studios</td>
          <td align="left" style="color:#52525b;font-size:12px">2026</td>
        </tr></table>
      </td></tr>

      <!-- Body -->
      <tr><td dir="rtl" lang="ar" style="background:#ffffff;padding:32px 32px 28px;text-align:right">
        <h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#38bdf8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">المراجعة جاهزة للمعاينة 🔄</h2>
        <p style="margin:0 0 8px;font-size:15px;color:#18181b;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong>{{brand_name}}</strong>،</p>
        <p style="margin:0 0 28px;font-size:15px;color:#18181b;line-height:1.7;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          المراجعة رقم <strong>{{revision_number}} من 3</strong> للمنشور <strong>{{position}}</strong> جاهزة —
          يرجى المعاينة والموافقة من لوحة التحكم.
        </p>
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:#10b981;border-radius:8px">
            <a style="display:inline-block;padding:12px 28px;color:#022c22;font-size:14px;font-weight:600;text-decoration:none;font-family:Tahoma,'Segoe UI',Arial,sans-serif">معاينة المنشور</a>
          </td>
        </tr></table>
      </td></tr>

      <!-- Footer -->
      <tr><td dir="rtl" style="background:#f9fafb;border-radius:0 0 12px 12px;border-top:1px solid #e4e4e7;padding:16px 32px;text-align:right">
        <p style="margin:0;font-size:12px;color:#71717a;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios &#169; 2026 &nbsp;&#183;&nbsp; هذا البريد تلقائي، لا ترد عليه مباشرة</p>
      </td></tr>

    </table>
  </td></tr>
</table>$$,
  body_text  = 'مرحباً {{brand_name}}، المراجعة {{revision_number}} من 3 جاهزة للمنشور رقم {{position}}.',
  updated_at = NOW()
WHERE template_key = 'revision_ready' AND lang = 'ar';


-- ── 5. publish_success ────────────────────────────────────────────────────────

UPDATE public.notification_templates SET
  subject    = 'نُشر المنشور {{position}} على {{platform}} بنجاح ✅',
  title      = 'نُشر المنشور {{position}} على {{platform}}',
  body_html  = $$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#f4f4f5;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
  <tr><td align="center" style="padding:32px 16px">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">

      <!-- Header -->
      <tr><td style="background:#09090b;border-radius:12px 12px 0 0;border-top:4px solid #22c55e;padding:20px 32px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="color:#fafafa;font-size:17px;font-weight:700;letter-spacing:-0.3px">OGz Studios</td>
          <td align="left" style="color:#52525b;font-size:12px">2026</td>
        </tr></table>
      </td></tr>

      <!-- Body -->
      <tr><td dir="rtl" lang="ar" style="background:#ffffff;padding:32px 32px 28px;text-align:right">
        <h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#22c55e;font-family:Tahoma,'Segoe UI',Arial,sans-serif">نُشر المنشور بنجاح ✅</h2>
        <p style="margin:0 0 28px;font-size:15px;color:#18181b;line-height:1.7;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          نُشر المنشور رقم <strong>{{position}}</strong> على
          <strong>{{platform}}</strong> بتاريخ <strong>{{published_at}}</strong>.
        </p>
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:#10b981;border-radius:8px">
            <a style="display:inline-block;padding:12px 28px;color:#022c22;font-size:14px;font-weight:600;text-decoration:none;font-family:Tahoma,'Segoe UI',Arial,sans-serif">عرض في لوحة التحكم</a>
          </td>
        </tr></table>
      </td></tr>

      <!-- Footer -->
      <tr><td dir="rtl" style="background:#f9fafb;border-radius:0 0 12px 12px;border-top:1px solid #e4e4e7;padding:16px 32px;text-align:right">
        <p style="margin:0;font-size:12px;color:#71717a;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios &#169; 2026 &nbsp;&#183;&nbsp; هذا البريد تلقائي، لا ترد عليه مباشرة</p>
      </td></tr>

    </table>
  </td></tr>
</table>$$,
  body_text  = 'نُشر المنشور رقم {{position}} على {{platform}} بتاريخ {{published_at}}.',
  updated_at = NOW()
WHERE template_key = 'publish_success' AND lang = 'ar';


-- ── 6. publish_failed ─────────────────────────────────────────────────────────

UPDATE public.notification_templates SET
  subject    = 'فشل نشر المنشور {{position}} — يحتاج مراجعة ⚠',
  title      = 'فشل نشر المنشور {{position}}',
  body_html  = $$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#f4f4f5;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
  <tr><td align="center" style="padding:32px 16px">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">

      <!-- Header -->
      <tr><td style="background:#09090b;border-radius:12px 12px 0 0;border-top:4px solid #f43f5e;padding:20px 32px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="color:#fafafa;font-size:17px;font-weight:700;letter-spacing:-0.3px">OGz Studios</td>
          <td align="left" style="color:#52525b;font-size:12px">2026</td>
        </tr></table>
      </td></tr>

      <!-- Body -->
      <tr><td dir="rtl" lang="ar" style="background:#ffffff;padding:32px 32px 28px;text-align:right">
        <h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#f43f5e;font-family:Tahoma,'Segoe UI',Arial,sans-serif">فشل نشر المنشور ⚠</h2>
        <p style="margin:0 0 12px;font-size:15px;color:#18181b;line-height:1.7;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          لم يتم نشر المنشور رقم <strong>{{position}}</strong>.
        </p>
        <p style="margin:0 0 28px;font-size:14px;color:#18181b;line-height:1.6;background:#fff1f2;border-right:3px solid #f43f5e;padding:12px 14px;border-radius:0 6px 6px 0;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          السبب: <strong>{{error}}</strong>
        </p>
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:#10b981;border-radius:8px">
            <a style="display:inline-block;padding:12px 28px;color:#022c22;font-size:14px;font-weight:600;text-decoration:none;font-family:Tahoma,'Segoe UI',Arial,sans-serif">إعادة المحاولة</a>
          </td>
        </tr></table>
      </td></tr>

      <!-- Footer -->
      <tr><td dir="rtl" style="background:#f9fafb;border-radius:0 0 12px 12px;border-top:1px solid #e4e4e7;padding:16px 32px;text-align:right">
        <p style="margin:0;font-size:12px;color:#71717a;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios &#169; 2026 &nbsp;&#183;&nbsp; سيتواصل الفريق معك لحل المشكلة</p>
      </td></tr>

    </table>
  </td></tr>
</table>$$,
  body_text  = 'فشل نشر المنشور رقم {{position}}. السبب: {{error}}',
  updated_at = NOW()
WHERE template_key = 'publish_failed' AND lang = 'ar';
