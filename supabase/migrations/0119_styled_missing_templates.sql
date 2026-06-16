-- 0119: Styled HTML for cost_ceiling_approaching, cost_ceiling_breached, calendar_rejected
-- Design matches 0051_improved_email_templates.sql:
--   dark header #09090b + 4px accent top border → white body card → light footer
--   Font: Tahoma / Segoe UI  •  inline styles only  •  dir="rtl" lang="ar"

-- ── 1. cost_ceiling_approaching ──────────────────────────────────────────────

UPDATE public.notification_templates SET
  subject    = 'تنبيه التكلفة: {{brand_name}} وصلت إلى {{spend_pct}}% من الميزانية',
  title      = 'اقتراب سقف التكلفة لـ {{brand_name}}',
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
        <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#f59e0b;font-family:Tahoma,'Segoe UI',Arial,sans-serif">⚡ تنبيه: اقتراب سقف التكلفة</h2>
        <p style="margin:0 0 20px;font-size:13px;color:#a1a1aa;font-family:Tahoma,'Segoe UI',Arial,sans-serif">{{brand_name}}</p>

        <!-- Spend meter card -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px">
          <tr><td style="padding:20px 20px 8px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td dir="rtl" style="font-size:13px;color:#92400e;font-family:Tahoma,'Segoe UI',Arial,sans-serif">الإنفاق الحالي</td>
              <td dir="ltr" align="right" style="font-size:22px;font-weight:700;color:#92400e;font-family:Tahoma,'Segoe UI',Arial,sans-serif">${{spend_usd}}</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:4px 20px 12px">
            <!-- Progress bar -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="background:#fde68a;border-radius:4px;height:8px;overflow:hidden">
                <td style="background:#f59e0b;border-radius:4px;height:8px;width:{{spend_pct}}%;max-width:100%"></td>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:0 20px 16px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td dir="rtl" style="font-size:12px;color:#a16207;font-family:Tahoma,'Segoe UI',Arial,sans-serif">{{spend_pct}}% من السقف الشهري</td>
              <td dir="ltr" align="right" style="font-size:12px;color:#a16207;font-family:Tahoma,'Segoe UI',Arial,sans-serif">السقف: ${{ceiling_usd}}</td>
            </tr></table>
          </td></tr>
        </table>

        <p style="margin:0 0 28px;font-size:14px;color:#3f3f46;line-height:1.7;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          يُطلق هذا التنبيه عند الوصول إلى <strong>{{alert_at_pct}}%</strong> من السقف. سيتوقف التوليد التلقائي عند بلوغ <strong>100%</strong> — يُرجى مراجعة الإنفاق الآن.
        </p>

        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:#f59e0b;border-radius:8px">
            <a href="{{cost_page_url}}" style="display:inline-block;padding:12px 28px;color:#1c1917;font-size:14px;font-weight:600;text-decoration:none;font-family:Tahoma,'Segoe UI',Arial,sans-serif">عرض تفاصيل التكلفة</a>
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
  body_text  = 'تنبيه التكلفة: أنفقت العلامة {{brand_name}} مبلغ ${{spend_usd}} ({{spend_pct}}% من سقف ${{ceiling_usd}}). حد التنبيه: {{alert_at_pct}}%. الرابط: {{cost_page_url}}',
  updated_at = NOW()
WHERE template_key = 'cost_ceiling_approaching' AND lang = 'ar';


-- ── 2. cost_ceiling_breached ──────────────────────────────────────────────────

UPDATE public.notification_templates SET
  subject    = 'عاجل: {{brand_name}} تجاوزت سقف التكلفة الشهري 🔴',
  title      = 'تجاوز سقف التكلفة — {{brand_name}}',
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
        <h2 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#f43f5e;font-family:Tahoma,'Segoe UI',Arial,sans-serif">🔴 تجاوز سقف التكلفة الشهري</h2>
        <p style="margin:0 0 20px;font-size:13px;color:#a1a1aa;font-family:Tahoma,'Segoe UI',Arial,sans-serif">{{brand_name}}</p>

        <!-- Spend card -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;background:#fff1f2;border:1px solid #fecdd3;border-radius:10px">
          <tr><td style="padding:20px 20px 8px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td dir="rtl" style="font-size:13px;color:#9f1239;font-family:Tahoma,'Segoe UI',Arial,sans-serif">إجمالي الإنفاق</td>
              <td dir="ltr" align="right" style="font-size:22px;font-weight:700;color:#e11d48;font-family:Tahoma,'Segoe UI',Arial,sans-serif">${{spend_usd}}</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:4px 20px 12px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="background:#fecdd3;border-radius:4px;height:8px">
                <td style="background:#f43f5e;border-radius:4px;height:8px;width:100%"></td>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:0 20px 16px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td dir="rtl" style="font-size:12px;color:#9f1239;font-family:Tahoma,'Segoe UI',Arial,sans-serif">{{spend_pct}}% من السقف الشهري</td>
              <td dir="ltr" align="right" style="font-size:12px;color:#9f1239;font-family:Tahoma,'Segoe UI',Arial,sans-serif">السقف: ${{ceiling_usd}}</td>
            </tr></table>
          </td></tr>
        </table>

        <!-- Action taken notice -->
        <p style="margin:0 0 12px;font-size:14px;color:#18181b;line-height:1.6;background:#fff1f2;border-right:3px solid #f43f5e;padding:12px 14px;border-radius:0 6px 6px 0;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          الإجراء التلقائي المتخذ: <strong>{{action}}</strong>
        </p>

        <p style="margin:0 0 28px;font-size:14px;color:#3f3f46;line-height:1.7;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          تم إيقاف جميع عمليات التوليد لهذه العلامة حتى يتم رفع السقف أو تجديد الشهر.
        </p>

        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:#f43f5e;border-radius:8px">
            <a href="{{cost_page_url}}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;font-family:Tahoma,'Segoe UI',Arial,sans-serif">إدارة السقف الآن</a>
          </td>
        </tr></table>
      </td></tr>

      <!-- Footer -->
      <tr><td dir="rtl" style="background:#f9fafb;border-radius:0 0 12px 12px;border-top:1px solid #e4e4e7;padding:16px 32px;text-align:right">
        <p style="margin:0;font-size:12px;color:#71717a;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios &#169; 2026 &nbsp;&#183;&nbsp; سيتواصل الفريق معك لمراجعة الإعدادات</p>
      </td></tr>

    </table>
  </td></tr>
</table>$$,
  body_text  = 'عاجل: أنفقت {{brand_name}} مبلغ ${{spend_usd}} ({{spend_pct}}% من سقف ${{ceiling_usd}}). الإجراء: {{action}}. الإدارة: {{cost_page_url}}',
  updated_at = NOW()
WHERE template_key = 'cost_ceiling_breached' AND lang = 'ar';


-- ── 3. calendar_rejected (INSERT — row does not exist yet) ────────────────────

INSERT INTO public.notification_templates
  (template_key, lang, subject, title, body_html, body_text, variables, is_active)
VALUES (
  'calendar_rejected', 'ar',
  'تقويم {{month}} يحتاج مراجعة — {{brand_name}}',
  'طُلب مراجعة تقويم {{month}}',
  $$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#f4f4f5;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
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
        <h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#f43f5e;font-family:Tahoma,'Segoe UI',Arial,sans-serif">طُلب مراجعة تقويم {{month}} ↩</h2>
        <p style="margin:0 0 8px;font-size:15px;color:#18181b;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong>{{brand_name}}</strong>،</p>
        <p style="margin:0 0 12px;font-size:15px;color:#18181b;line-height:1.7;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          تمت مراجعة تقويم <strong>{{month}}</strong> من قِبل الفريق وقد طُلبت بعض التعديلات قبل النشر.
        </p>
        <p style="margin:0 0 28px;font-size:14px;color:#18181b;line-height:1.6;background:#fff1f2;border-right:3px solid #f43f5e;padding:12px 14px;border-radius:0 6px 6px 0;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          السبب: <strong>{{reason}}</strong>
        </p>
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:#10b981;border-radius:8px">
            <a style="display:inline-block;padding:12px 28px;color:#022c22;font-size:14px;font-weight:600;text-decoration:none;font-family:Tahoma,'Segoe UI',Arial,sans-serif">عرض التقويم</a>
          </td>
        </tr></table>
      </td></tr>

      <!-- Footer -->
      <tr><td dir="rtl" style="background:#f9fafb;border-radius:0 0 12px 12px;border-top:1px solid #e4e4e7;padding:16px 32px;text-align:right">
        <p style="margin:0;font-size:12px;color:#71717a;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios &#169; 2026 &nbsp;&#183;&nbsp; سيتواصل الفريق معك لإجراء التعديلات المطلوبة</p>
      </td></tr>

    </table>
  </td></tr>
</table>$$,
  'مرحباً {{brand_name}}، تقويم {{month}} يحتاج بعض التعديلات. السبب: {{reason}}',
  to_jsonb(ARRAY['brand_name','month','reason']),
  true
)
ON CONFLICT (template_key, lang) DO UPDATE SET
  subject    = EXCLUDED.subject,
  title      = EXCLUDED.title,
  body_html  = EXCLUDED.body_html,
  body_text  = EXCLUDED.body_text,
  variables  = EXCLUDED.variables,
  is_active  = EXCLUDED.is_active,
  updated_at = NOW();
