-- ─────────────────────────────────────────────────────────────────────────────
-- 0021_notifications.sql
--
-- Two tables:
--   notification_templates  — admin-editable per (template_key, lang)
--   notifications           — inbox + Resend delivery log
--
-- Design notes:
--   • rendered_* columns store the already-rendered content at send-time so
--     future template edits never corrupt historical inbox entries.
--   • variables_used stores the exact snapshot used at render time for audit.
--   • resend_status index on 'queued' lets n8n / cron poll efficiently.
--   • Arabic (lang='ar') is the default and primary language.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. notification_templates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_templates (
  template_key  TEXT        NOT NULL,
  lang          TEXT        NOT NULL CHECK (lang IN ('ar', 'en')),
  subject       TEXT        NOT NULL,
  title         TEXT        NOT NULL,
  body_html     TEXT        NOT NULL,
  body_text     TEXT,
  variables     JSONB       NOT NULL DEFAULT '[]',
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID,                              -- admin auth_user_id who last edited
  PRIMARY KEY (template_key, lang)
);

-- ── 2. notifications ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  notification_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           UUID        NOT NULL,
  auth_user_id       UUID        NOT NULL,
  template_key       TEXT        NOT NULL,
  lang               TEXT        NOT NULL DEFAULT 'ar',
  -- Content rendered at send-time — never changes after insert
  rendered_subject   TEXT        NOT NULL,
  rendered_title     TEXT        NOT NULL,
  rendered_body_html TEXT        NOT NULL,
  variables_used     JSONB       NOT NULL DEFAULT '{}',
  -- Context links (both optional — a notification may not relate to a post)
  post_id            UUID,
  calendar_id        UUID,
  -- Resend delivery tracking
  resend_message_id  TEXT,
  resend_status      TEXT        NOT NULL DEFAULT 'queued'
                                 CHECK (resend_status IN ('queued','sent','failed','bounced')),
  resend_error       TEXT,
  sent_at            TIMESTAMPTZ,
  -- Inbox state
  read_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON public.notifications (auth_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_brand
  ON public.notifications (brand_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (auth_user_id)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_queued
  ON public.notifications (resend_status)
  WHERE resend_status = 'queued';

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications           ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notification_templates' AND policyname='notification_templates_read_all') THEN
    CREATE POLICY "notification_templates_read_all"
      ON public.notification_templates FOR SELECT USING (TRUE);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notifications' AND policyname='notifications_read_own') THEN
    CREATE POLICY "notifications_read_own"
      ON public.notifications FOR SELECT
      USING (auth.uid() = auth_user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notifications' AND policyname='notifications_update_read_at_own') THEN
    CREATE POLICY "notifications_update_read_at_own"
      ON public.notifications FOR UPDATE
      USING (auth.uid() = auth_user_id)
      WITH CHECK (auth.uid() = auth_user_id);
  END IF;
END $$;

-- INSERT / DELETE are service_role only (no policy = denied for anon/user)

-- ── 5. Seed: Arabic templates ─────────────────────────────────────────────────
INSERT INTO public.notification_templates
  (template_key, lang, subject, title, body_html, body_text, variables)
VALUES

-- post_approved
('post_approved', 'ar',
 'تمت الموافقة على المنشور {{position}} ✓',
 'تمت الموافقة على المنشور {{position}}',
 '<div dir="rtl" lang="ar" style="font-family:Tahoma,''Segoe UI'',sans-serif;direction:rtl;text-align:right;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
  <div style="border-bottom:3px solid #f0a500;padding-bottom:12px;margin-bottom:24px">
    <span style="font-size:22px;font-weight:700;color:#f0a500">OpenClaw</span>
  </div>
  <h2 style="font-size:18px;margin:0 0 16px;color:#1a1a1a">تمت الموافقة على المنشور ✓</h2>
  <p style="margin:0 0 8px">مرحباً <strong>{{brand_name}}</strong>،</p>
  <p style="margin:0 0 16px">تمت الموافقة على المنشور رقم <strong>{{position}}</strong> في تقويم <strong>{{month}}</strong>.</p>
  <p style="color:#666;font-size:13px;margin:0">افتح لوحة التحكم لعرضه وجدولة نشره.</p>
</div>',
 'مرحباً {{brand_name}}، تمت الموافقة على المنشور رقم {{position}} في تقويم {{month}}.',
 '["brand_name","position","month"]'),

-- post_rejected
('post_rejected', 'ar',
 'المنشور {{position}} يحتاج مراجعة',
 'المنشور {{position}} مرفوض مؤقتاً',
 '<div dir="rtl" lang="ar" style="font-family:Tahoma,''Segoe UI'',sans-serif;direction:rtl;text-align:right;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
  <div style="border-bottom:3px solid #f0a500;padding-bottom:12px;margin-bottom:24px">
    <span style="font-size:22px;font-weight:700;color:#f0a500">OpenClaw</span>
  </div>
  <h2 style="font-size:18px;margin:0 0 16px;color:#1a1a1a">المنشور يحتاج تعديل</h2>
  <p style="margin:0 0 8px">مرحباً <strong>{{brand_name}}</strong>،</p>
  <p style="margin:0 0 8px">المنشور رقم <strong>{{position}}</strong> يحتاج إلى مراجعة.</p>
  <p style="margin:0 0 16px">السبب: <em style="color:#c0392b">{{reason}}</em></p>
  <p style="color:#666;font-size:13px;margin:0">يمكنك طلب مراجعة جديدة من صفحة التقويم — متاح حتى 3 مراجعات.</p>
</div>',
 'مرحباً {{brand_name}}، المنشور رقم {{position}} يحتاج مراجعة. السبب: {{reason}}',
 '["brand_name","position","reason"]'),

-- revision_ready
('revision_ready', 'ar',
 'تم تحديث المنشور {{position}} 🔄',
 'المراجعة {{revision_number}} جاهزة للمنشور {{position}}',
 '<div dir="rtl" lang="ar" style="font-family:Tahoma,''Segoe UI'',sans-serif;direction:rtl;text-align:right;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
  <div style="border-bottom:3px solid #f0a500;padding-bottom:12px;margin-bottom:24px">
    <span style="font-size:22px;font-weight:700;color:#f0a500">OpenClaw</span>
  </div>
  <h2 style="font-size:18px;margin:0 0 16px;color:#1a1a1a">المراجعة جاهزة 🔄</h2>
  <p style="margin:0 0 8px">مرحباً <strong>{{brand_name}}</strong>،</p>
  <p style="margin:0 0 16px">تم تحديث المنشور رقم <strong>{{position}}</strong> — هذه المراجعة <strong>{{revision_number}} من 3</strong>.</p>
  <p style="color:#666;font-size:13px;margin:0">يرجى المراجعة والموافقة من لوحة التحكم.</p>
</div>',
 'مرحباً {{brand_name}}، المراجعة {{revision_number}} من 3 جاهزة للمنشور رقم {{position}}.',
 '["brand_name","position","revision_number"]'),

-- calendar_delivered
('calendar_delivered', 'ar',
 'تقويم {{month}} جاهز 🗓️',
 'تقويم {{month}} جاهز للمراجعة',
 '<div dir="rtl" lang="ar" style="font-family:Tahoma,''Segoe UI'',sans-serif;direction:rtl;text-align:right;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
  <div style="border-bottom:3px solid #f0a500;padding-bottom:12px;margin-bottom:24px">
    <span style="font-size:22px;font-weight:700;color:#f0a500">OpenClaw</span>
  </div>
  <h2 style="font-size:18px;margin:0 0 16px;color:#1a1a1a">تقويمك جاهز 🗓️</h2>
  <p style="margin:0 0 8px">مرحباً <strong>{{brand_name}}</strong>،</p>
  <p style="margin:0 0 16px">تم إعداد تقويم <strong>{{month}}</strong> ويحتوي على <strong>{{post_count}} منشور</strong>.</p>
  <p style="color:#666;font-size:13px;margin:0">افتح لوحة التحكم للاطلاع على جميع المنشورات والموافقة عليها.</p>
</div>',
 'مرحباً {{brand_name}}، تم إعداد تقويم {{month}} ويحتوي على {{post_count}} منشور.',
 '["brand_name","month","post_count"]'),

-- publish_success
('publish_success', 'ar',
 'تم نشر المنشور {{position}} ✅',
 'تم نشر المنشور {{position}} بنجاح',
 '<div dir="rtl" lang="ar" style="font-family:Tahoma,''Segoe UI'',sans-serif;direction:rtl;text-align:right;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
  <div style="border-bottom:3px solid #f0a500;padding-bottom:12px;margin-bottom:24px">
    <span style="font-size:22px;font-weight:700;color:#f0a500">OpenClaw</span>
  </div>
  <h2 style="font-size:18px;margin:0 0 16px;color:#1a1a1a">تم النشر بنجاح ✅</h2>
  <p style="margin:0 0 16px">تم نشر المنشور رقم <strong>{{position}}</strong> على <strong>{{platform}}</strong> بتاريخ <strong>{{published_at}}</strong>.</p>
</div>',
 'تم نشر المنشور رقم {{position}} على {{platform}} بتاريخ {{published_at}}.',
 '["position","platform","published_at"]'),

-- publish_failed
('publish_failed', 'ar',
 'فشل نشر المنشور {{position}} ⚠️',
 'فشل نشر المنشور {{position}} — يحتاج مراجعة',
 '<div dir="rtl" lang="ar" style="font-family:Tahoma,''Segoe UI'',sans-serif;direction:rtl;text-align:right;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
  <div style="border-bottom:3px solid #f0a500;padding-bottom:12px;margin-bottom:24px">
    <span style="font-size:22px;font-weight:700;color:#f0a500">OpenClaw</span>
  </div>
  <h2 style="font-size:18px;margin:0 0 16px;color:#1a1a1a">فشل النشر ⚠️</h2>
  <p style="margin:0 0 8px">لم يتم نشر المنشور رقم <strong>{{position}}</strong>.</p>
  <p style="margin:0 0 16px">السبب: <em style="color:#c0392b">{{error}}</em></p>
  <p style="color:#666;font-size:13px;margin:0">سيتواصل الفريق معك لمراجعة المشكلة.</p>
</div>',
 'فشل نشر المنشور رقم {{position}}. السبب: {{error}}',
 '["position","error"]')
ON CONFLICT (template_key, lang) DO NOTHING;
