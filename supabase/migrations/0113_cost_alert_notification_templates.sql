-- 0113: Cost ceiling alert email templates
-- Two new notification template keys:
--   cost_ceiling_approaching  → sent at alert_at_pct (default 70%)
--   cost_ceiling_breached     → sent at halt_at_pct  (default 100%)
-- Both sent to: admin + brand client users (wired in S03 anomaly router)

INSERT INTO notification_templates
  (template_key, lang, subject, title, body_html, body_text, variables, is_active)
VALUES

-- ── cost_ceiling_approaching — English ─────────────────────────────────────
(
  'cost_ceiling_approaching', 'en',
  'Cost Alert: {{brand_name}} has reached {{spend_pct}}% of monthly budget',
  'Cost ceiling approaching for {{brand_name}}',
  '<p>The brand <strong>{{brand_name}}</strong> has spent <strong>${{spend_usd}}</strong> this month,
   which is <strong>{{spend_pct}}%</strong> of its ${{ceiling_usd}} monthly ceiling.</p>
   <p>An alert is triggered at {{alert_at_pct}}%. Generation will be halted if the ceiling is fully reached.</p>
   <p><a href="{{cost_page_url}}">View cost details →</a></p>',
  'Brand {{brand_name}} has spent ${{spend_usd}} ({{spend_pct}}% of ${{ceiling_usd}} ceiling). Alert threshold: {{alert_at_pct}}%. View: {{cost_page_url}}',
  to_jsonb(ARRAY['brand_name','spend_usd','ceiling_usd','spend_pct','alert_at_pct','cost_page_url']),
  true
),

-- ── cost_ceiling_approaching — Arabic ──────────────────────────────────────
(
  'cost_ceiling_approaching', 'ar',
  'تنبيه التكلفة: {{brand_name}} وصلت إلى {{spend_pct}}% من الميزانية الشهرية',
  'اقتراب سقف التكلفة لـ {{brand_name}}',
  '<p>أنفقت العلامة التجارية <strong>{{brand_name}}</strong> مبلغ <strong>${{spend_usd}}</strong> هذا الشهر،
   أي ما يعادل <strong>{{spend_pct}}%</strong> من سقفها الشهري البالغ ${{ceiling_usd}}.</p>
   <p>يُطلق التنبيه عند بلوغ {{alert_at_pct}}%. سيتوقف التوليد إذا وصل الإنفاق إلى السقف الكامل.</p>
   <p><a href="{{cost_page_url}}">عرض تفاصيل التكلفة ←</a></p>',
  'أنفقت العلامة {{brand_name}} مبلغ ${{spend_usd}} ({{spend_pct}}% من سقف ${{ceiling_usd}}). حد التنبيه: {{alert_at_pct}}%. الرابط: {{cost_page_url}}',
  to_jsonb(ARRAY['brand_name','spend_usd','ceiling_usd','spend_pct','alert_at_pct','cost_page_url']),
  true
),

-- ── cost_ceiling_breached — English ────────────────────────────────────────
(
  'cost_ceiling_breached', 'en',
  'URGENT: {{brand_name}} has exceeded its monthly cost ceiling',
  'Monthly cost ceiling breached — {{brand_name}}',
  '<p><strong>ACTION REQUIRED:</strong> The brand <strong>{{brand_name}}</strong> has spent
   <strong>${{spend_usd}}</strong> ({{spend_pct}}% of the ${{ceiling_usd}} ceiling).</p>
   <p>Automatic action taken: <strong>{{action}}</strong>.</p>
   <p>All AI and visual generation for this brand is now halted until the ceiling is raised or the month resets.</p>
   <p><a href="{{cost_page_url}}">Manage ceiling →</a></p>',
  'URGENT: {{brand_name}} spent ${{spend_usd}} ({{spend_pct}}%). Action: {{action}}. Manage: {{cost_page_url}}',
  to_jsonb(ARRAY['brand_name','spend_usd','ceiling_usd','spend_pct','action','cost_page_url']),
  true
),

-- ── cost_ceiling_breached — Arabic ─────────────────────────────────────────
(
  'cost_ceiling_breached', 'ar',
  'عاجل: {{brand_name}} تجاوزت سقف التكلفة الشهري',
  'تجاوز سقف التكلفة الشهري — {{brand_name}}',
  '<p><strong>إجراء مطلوب:</strong> أنفقت العلامة التجارية <strong>{{brand_name}}</strong>
   مبلغ <strong>${{spend_usd}}</strong> ({{spend_pct}}% من سقف ${{ceiling_usd}}).</p>
   <p>الإجراء التلقائي المتخذ: <strong>{{action}}</strong>.</p>
   <p>تم إيقاف جميع عمليات التوليد لهذه العلامة حتى يتم رفع السقف أو تجديد الشهر.</p>
   <p><a href="{{cost_page_url}}">إدارة السقف ←</a></p>',
  'عاجل: أنفقت {{brand_name}} مبلغ ${{spend_usd}} ({{spend_pct}}%). الإجراء: {{action}}. الإدارة: {{cost_page_url}}',
  to_jsonb(ARRAY['brand_name','spend_usd','ceiling_usd','spend_pct','action','cost_page_url']),
  true
)

ON CONFLICT (template_key, lang) DO UPDATE SET
  subject    = EXCLUDED.subject,
  title      = EXCLUDED.title,
  body_html  = EXCLUDED.body_html,
  body_text  = EXCLUDED.body_text,
  variables  = EXCLUDED.variables,
  is_active  = EXCLUDED.is_active;
