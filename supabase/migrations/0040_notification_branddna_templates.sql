-- ─────────────────────────────────────────────────────────────────────────────
-- 0040_notification_branddna_templates.sql
--
-- 1. Seeds three new BrandDNA notification templates (Arabic):
--      branddna_correction_applied   — correction was accepted & written
--      branddna_correction_rejected  — correction was rejected by CEO
--      branddna_onboarding_complete  — initial onboarding analysis complete
--
-- 2. Seeds English (lang='en') placeholder rows for ALL 9 templates so that
--    the admin template editor shows an "Add English" path instead of silence.
--    Placeholders are marked is_active=FALSE so no English email fires until
--    an admin deliberately activates one.
--
-- 3. Adds retry_count column safety (idempotent — skips if already exists).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. branddna_correction_applied (ar) ──────────────────────────────────────

INSERT INTO public.notification_templates
  (template_key, lang, subject, title, body_html, body_text, variables, is_active)
VALUES (
  'branddna_correction_applied',
  'ar',
  'تم تحديث هوية علامتك التجارية — {{field_name}}',
  'تم تطبيق تعديل BrandDNA',
  $t$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#e8f0f8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
<tr><td align="center" style="padding:48px 16px">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-radius:20px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,0.14)">

  <!-- HEADER -->
  <tr><td bgcolor="#0d0d10" style="background:#0d0d10;border-top:5px solid #6366f1;border-radius:20px 20px 0 0;padding:22px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="color:#fafafa;font-size:20px;font-weight:800;letter-spacing:-0.5px">OGz <span style="color:#6366f1">Studios</span></td>
      <td align="left" style="color:#52525b;font-size:12px;font-weight:500">© 2026</td>
    </tr></table>
  </td></tr>

  <!-- EVENT STRIP -->
  <tr><td bgcolor="#6366f1" align="center" style="background:#6366f1;padding:10px 28px">
    <span style="color:#fff;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">تم تحديث BrandDNA</span>
  </td></tr>

  <!-- BODY -->
  <tr><td bgcolor="#ffffff" dir="rtl" lang="ar" style="background:#ffffff;padding:40px 32px 36px;text-align:right">

    <!-- Icon circle -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px"><tr>
      <td width="72" height="72" align="center" valign="middle" style="background:#e0e7ff;border-radius:36px;width:72px;height:72px;font-size:34px;line-height:72px;text-align:center">✓</td>
    </tr></table>

    <!-- Title -->
    <p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0f172a;text-align:center;line-height:1.3;font-family:Tahoma,'Segoe UI',Arial,sans-serif">تم تطبيق التعديل</p>

    <!-- Accent bar -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:14px auto 22px"><tr>
      <td width="56" height="4" style="background:#6366f1;border-radius:2px;width:56px;height:4px"></td>
    </tr></table>

    <!-- Greeting -->
    <p style="margin:0 0 10px;font-size:15px;color:#334155;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong style="color:#0f172a">{{brand_name}}</strong>،</p>

    <!-- Message -->
    <p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.9;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
      تم تحديث حقل <strong style="color:#6366f1">{{field_name}}</strong> في هوية علامتك التجارية بنجاح.<br>
      القيمة الجديدة: <strong style="color:#0f172a">{{new_value}}</strong>
    </p>

    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 8px"><tr>
      <td align="center" bgcolor="#6366f1" style="background:#6366f1;border-radius:50px;box-shadow:0 4px 14px rgba(99,102,241,0.4)">
        <a style="display:inline-block;padding:13px 32px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.3px;font-family:Tahoma,'Segoe UI',Arial,sans-serif">عرض الملف الشخصي</a>
      </td>
    </tr></table>

  </td></tr>

  <!-- FOOTER -->
  <tr><td bgcolor="#f8fafc" style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center">
    <p style="margin:0;font-size:12px;color:#94a3b8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios · منصة OpenClaw للمحتوى الرقمي</p>
  </td></tr>

</table>
</td></tr>
</table>$t$,
  'تم تحديث حقل {{field_name}} في BrandDNA. القيمة الجديدة: {{new_value}}',
  '["brand_name","field_name","new_value"]',
  TRUE
)
ON CONFLICT (template_key, lang) DO NOTHING;

-- ── 2. branddna_correction_rejected (ar) ─────────────────────────────────────

INSERT INTO public.notification_templates
  (template_key, lang, subject, title, body_html, body_text, variables, is_active)
VALUES (
  'branddna_correction_rejected',
  'ar',
  'لم يتم قبول تعديل BrandDNA — {{field_name}}',
  'تعديل BrandDNA لم يُطبَّق',
  $t$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#fef2f2;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
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
    <span style="color:#fff;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">تعديل لم يُطبَّق</span>
  </td></tr>

  <!-- BODY -->
  <tr><td bgcolor="#ffffff" dir="rtl" lang="ar" style="background:#ffffff;padding:40px 32px 36px;text-align:right">

    <!-- Icon circle -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px"><tr>
      <td width="72" height="72" align="center" valign="middle" style="background:#ffe4e6;border-radius:36px;width:72px;height:72px;font-size:34px;line-height:72px;text-align:center">✕</td>
    </tr></table>

    <!-- Title -->
    <p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0f172a;text-align:center;line-height:1.3;font-family:Tahoma,'Segoe UI',Arial,sans-serif">لم يتم قبول التعديل</p>

    <!-- Accent bar -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:14px auto 22px"><tr>
      <td width="56" height="4" style="background:#f43f5e;border-radius:2px;width:56px;height:4px"></td>
    </tr></table>

    <!-- Greeting -->
    <p style="margin:0 0 10px;font-size:15px;color:#334155;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong style="color:#0f172a">{{brand_name}}</strong>،</p>

    <!-- Message -->
    <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.9;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
      لم يتم تطبيق التعديل على حقل <strong style="color:#f43f5e">{{field_name}}</strong>.
    </p>

    <!-- Reason box -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:32px"><tr>
      <td style="background:#fff1f2;border-right:4px solid #f43f5e;border-radius:8px;padding:14px 16px" dir="rtl">
        <p style="margin:0;font-size:13px;color:#881337;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
          <strong>السبب:</strong> {{rejection_reason}}
        </p>
      </td>
    </tr></table>

    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 8px"><tr>
      <td align="center" bgcolor="#6366f1" style="background:#6366f1;border-radius:50px;box-shadow:0 4px 14px rgba(99,102,241,0.4)">
        <a style="display:inline-block;padding:13px 32px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.3px;font-family:Tahoma,'Segoe UI',Arial,sans-serif">حاول مجدداً</a>
      </td>
    </tr></table>

  </td></tr>

  <!-- FOOTER -->
  <tr><td bgcolor="#f8fafc" style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center">
    <p style="margin:0;font-size:12px;color:#94a3b8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios · منصة OpenClaw للمحتوى الرقمي</p>
  </td></tr>

</table>
</td></tr>
</table>$t$,
  'لم يتم تطبيق التعديل على {{field_name}}. السبب: {{rejection_reason}}',
  '["brand_name","field_name","rejection_reason"]',
  TRUE
)
ON CONFLICT (template_key, lang) DO NOTHING;

-- ── 3. branddna_onboarding_complete (ar) ─────────────────────────────────────

INSERT INTO public.notification_templates
  (template_key, lang, subject, title, body_html, body_text, variables, is_active)
VALUES (
  'branddna_onboarding_complete',
  'ar',
  '🎉 تحليل هويتك التجارية اكتمل — نسبة الاكتمال {{completeness_score}}%',
  'BrandDNA جاهز للمراجعة',
  $t$<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#f0fdf4;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
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
    <span style="color:#052e16;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">تحليل الهوية التجارية اكتمل 🎉</span>
  </td></tr>

  <!-- BODY -->
  <tr><td bgcolor="#ffffff" dir="rtl" lang="ar" style="background:#ffffff;padding:40px 32px 36px;text-align:right">

    <!-- Icon circle -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px"><tr>
      <td width="72" height="72" align="center" valign="middle" style="background:#dcfce7;border-radius:36px;width:72px;height:72px;font-size:34px;line-height:72px;text-align:center">🎯</td>
    </tr></table>

    <!-- Title -->
    <p style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0f172a;text-align:center;line-height:1.3;font-family:Tahoma,'Segoe UI',Arial,sans-serif">BrandDNA جاهز!</p>

    <!-- Score pill -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:14px auto 22px"><tr>
      <td style="background:#dcfce7;border:2px solid #22c55e;border-radius:50px;padding:6px 20px">
        <span style="font-size:16px;font-weight:800;color:#15803d;font-family:Tahoma,'Segoe UI',Arial,sans-serif">{{completeness_score}}% اكتمال</span>
      </td>
    </tr></table>

    <!-- Greeting -->
    <p style="margin:0 0 10px;font-size:15px;color:#334155;line-height:1.6;font-family:Tahoma,'Segoe UI',Arial,sans-serif">مرحباً <strong style="color:#0f172a">{{brand_name}}</strong>،</p>

    <!-- Message -->
    <p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.9;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
      اكتمل تحليل هوية علامتك التجارية بنسبة <strong style="color:#22c55e">{{completeness_score}}%</strong>.<br>
      راجع الملف الشخصي لعلامتك التجارية لمعرفة التفاصيل وتعديل أي حقل لا يعكس هويتك بدقة.
    </p>

    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 8px"><tr>
      <td align="center" bgcolor="#22c55e" style="background:#22c55e;border-radius:50px;box-shadow:0 4px 14px rgba(34,197,94,0.4)">
        <a style="display:inline-block;padding:13px 32px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:0.3px;font-family:Tahoma,'Segoe UI',Arial,sans-serif">عرض الملف الشخصي</a>
      </td>
    </tr></table>

  </td></tr>

  <!-- FOOTER -->
  <tr><td bgcolor="#f8fafc" style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center">
    <p style="margin:0;font-size:12px;color:#94a3b8;font-family:Tahoma,'Segoe UI',Arial,sans-serif">OGz Studios · منصة OpenClaw للمحتوى الرقمي</p>
  </td></tr>

</table>
</td></tr>
</table>$t$,
  'اكتمل تحليل هوية {{brand_name}} بنسبة {{completeness_score}}%. راجع الملف الشخصي لمراجعة النتائج.',
  '["brand_name","completeness_score"]',
  TRUE
)
ON CONFLICT (template_key, lang) DO NOTHING;

-- ── 4. English placeholder rows for all 9 templates ──────────────────────────
-- Marked is_active=FALSE so no English email fires until an admin activates one.
-- Each placeholder body_html renders correctly but states it is a placeholder.

INSERT INTO public.notification_templates
  (template_key, lang, subject, title, body_html, body_text, variables, is_active)
VALUES
  ('post_approved', 'en', 'Your post #{{position}} has been approved — {{month}}', 'Post #{{position}} approved ✓',
   '<div dir="ltr" lang="en" style="font-family:Arial,sans-serif;padding:32px;color:#334155"><h2 style="color:#22c55e">Post Approved ✓</h2><p>Hi <strong>{{brand_name}}</strong>, your post <strong>#{{position}}</strong> for <strong>{{month}}</strong> has been approved.</p></div>',
   'Hi {{brand_name}}, post #{{position}} for {{month}} has been approved.', '["brand_name","position","month"]', FALSE),

  ('post_rejected', 'en', 'Revision requested for post #{{position}}', 'Revision needed for post #{{position}}',
   '<div dir="ltr" lang="en" style="font-family:Arial,sans-serif;padding:32px;color:#334155"><h2 style="color:#f59e0b">Revision Requested</h2><p>Hi <strong>{{brand_name}}</strong>, post <strong>#{{position}}</strong> needs a revision.</p><blockquote style="border-left:4px solid #f59e0b;padding-left:12px;color:#92400e">{{reason}}</blockquote></div>',
   'Hi {{brand_name}}, post #{{position}} needs a revision: {{reason}}', '["brand_name","position","reason"]', FALSE),

  ('revision_ready', 'en', 'Revision #{{revision_number}} is ready for post #{{position}}', 'Revision ready for post #{{position}}',
   '<div dir="ltr" lang="en" style="font-family:Arial,sans-serif;padding:32px;color:#334155"><h2 style="color:#38bdf8">Revision Ready</h2><p>Hi <strong>{{brand_name}}</strong>, revision <strong>#{{revision_number}}</strong> for post <strong>#{{position}}</strong> is ready.</p></div>',
   'Hi {{brand_name}}, revision #{{revision_number}} for post #{{position}} is ready.', '["brand_name","position","revision_number"]', FALSE),

  ('calendar_delivered', 'en', '🗓 Your {{month}} calendar is ready — {{post_count}} posts', '{{month}} calendar delivered',
   '<div dir="ltr" lang="en" style="font-family:Arial,sans-serif;padding:32px;color:#334155"><h2 style="color:#10b981">Calendar Delivered 🗓</h2><p>Hi <strong>{{brand_name}}</strong>, your <strong>{{month}}</strong> calendar with <strong>{{post_count}} posts</strong> is ready for review.</p></div>',
   'Hi {{brand_name}}, your {{month}} calendar with {{post_count}} posts is ready.', '["brand_name","month","post_count"]', FALSE),

  ('publish_success', 'en', '✅ Post #{{position}} published on {{platform}}', 'Post #{{position}} published successfully',
   '<div dir="ltr" lang="en" style="font-family:Arial,sans-serif;padding:32px;color:#334155"><h2 style="color:#22c55e">Published ✅</h2><p>Post <strong>#{{position}}</strong> was published on <strong>{{platform}}</strong> at <strong>{{published_at}}</strong>.</p></div>',
   'Post #{{position}} was published on {{platform}} at {{published_at}}.', '["position","platform","published_at"]', FALSE),

  ('publish_failed', 'en', '⚠ Failed to publish post #{{position}}', 'Publish failed for post #{{position}}',
   '<div dir="ltr" lang="en" style="font-family:Arial,sans-serif;padding:32px;color:#334155"><h2 style="color:#f43f5e">Publish Failed ⚠</h2><p>Post <strong>#{{position}}</strong> could not be published.</p><blockquote style="border-left:4px solid #f43f5e;padding-left:12px;color:#9f1239">{{error}}</blockquote></div>',
   'Post #{{position}} could not be published. Error: {{error}}', '["position","error"]', FALSE),

  ('branddna_correction_applied', 'en', 'BrandDNA updated — {{field_name}}', 'BrandDNA field {{field_name}} updated',
   '<div dir="ltr" lang="en" style="font-family:Arial,sans-serif;padding:32px;color:#334155"><h2 style="color:#6366f1">BrandDNA Updated ✓</h2><p>Hi <strong>{{brand_name}}</strong>, the field <strong>{{field_name}}</strong> has been updated to <strong>{{new_value}}</strong>.</p></div>',
   'Hi {{brand_name}}, BrandDNA field {{field_name}} updated to {{new_value}}.', '["brand_name","field_name","new_value"]', FALSE),

  ('branddna_correction_rejected', 'en', 'BrandDNA correction not applied — {{field_name}}', 'BrandDNA correction rejected for {{field_name}}',
   '<div dir="ltr" lang="en" style="font-family:Arial,sans-serif;padding:32px;color:#334155"><h2 style="color:#f43f5e">Correction Not Applied</h2><p>Hi <strong>{{brand_name}}</strong>, the correction for <strong>{{field_name}}</strong> was not applied.</p><blockquote style="border-left:4px solid #f43f5e;padding-left:12px;color:#9f1239">{{rejection_reason}}</blockquote></div>',
   'Hi {{brand_name}}, correction for {{field_name}} was not applied: {{rejection_reason}}', '["brand_name","field_name","rejection_reason"]', FALSE),

  ('branddna_onboarding_complete', 'en', '🎉 Your BrandDNA analysis is complete — {{completeness_score}}% score', 'BrandDNA analysis complete',
   '<div dir="ltr" lang="en" style="font-family:Arial,sans-serif;padding:32px;color:#334155"><h2 style="color:#22c55e">BrandDNA Ready 🎯</h2><p>Hi <strong>{{brand_name}}</strong>, your BrandDNA analysis is complete with a score of <strong>{{completeness_score}}%</strong>. Review your profile to check the results.</p></div>',
   'Hi {{brand_name}}, your BrandDNA analysis is complete: {{completeness_score}}% score.', '["brand_name","completeness_score"]', FALSE)

ON CONFLICT (template_key, lang) DO NOTHING;

-- ── 5. Ensure retry_count column exists (idempotent) ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN retry_count SMALLINT NOT NULL DEFAULT 0;
  END IF;
END $$;
