/**
 * Notification system types.
 *
 * NotificationVariables enforces at compile-time that every caller passes
 * the exact variables a template needs — no more, no less.
 *
 * Adding a new notification type:
 *   1. Add the key to NotificationTemplateKey
 *   2. Add its variable shape to NotificationVariables
 *   3. Add the SQL row to 0021_notifications.sql (or a new migration)
 *   4. Ship — no other code changes needed
 */

export type NotificationLang = 'ar' | 'en'

export type NotificationTemplateKey =
  | 'post_approved'
  | 'post_rejected'
  | 'revision_ready'
  | 'calendar_delivered'
  | 'calendar_pending_review'
  | 'calendar_approved'
  | 'calendar_rejected'
  | 'publish_success'
  | 'publish_failed'
  | 'branddna_correction_applied'
  | 'branddna_correction_rejected'
  | 'branddna_onboarding_complete'
  | 'anomaly_alert'
  | 'cost_ceiling_approaching'
  | 'cost_ceiling_breached'

// Each key maps to exactly the variables its template uses.
export type NotificationVariables = {
  post_approved: {
    brand_name: string
    position: number
    month: string
  }
  post_rejected: {
    brand_name: string
    position: number
    reason: string
  }
  revision_ready: {
    brand_name: string
    position: number
    revision_number: number
  }
  calendar_delivered: {
    brand_name: string
    month: string
    post_count: number
  }
  calendar_pending_review: {
    brand_name: string
    month: string
    calendar_url: string
  }
  calendar_approved: {
    brand_name: string
    month: string
    calendar_url: string
  }
  calendar_rejected: {
    brand_name: string
    month: string
    reason: string
  }
  publish_success: {
    position: number
    platform: string
    published_at: string
  }
  publish_failed: {
    position: number
    error: string
  }
  branddna_correction_applied: {
    brand_name: string
    field_name: string
    new_value: string
  }
  branddna_correction_rejected: {
    brand_name: string
    field_name: string
    rejection_reason: string
  }
  branddna_onboarding_complete: {
    brand_name: string
    completeness_score: number
  }
  anomaly_alert: {
    anomaly_type: string
    severity: string
    source_flow: string
    message: string
    target_copilot: string
    anomaly_id: string
    brand_id: string
  }
  cost_ceiling_approaching: {
    brand_name: string
    spend_usd: string
    ceiling_usd: string
    spend_pct: string
    alert_at_pct: string
    cost_page_url: string
  }
  cost_ceiling_breached: {
    brand_name: string
    spend_usd: string
    ceiling_usd: string
    spend_pct: string
    action: string
    cost_page_url: string
  }
}

export interface NotifyParams<K extends NotificationTemplateKey> {
  templateKey: K
  variables: NotificationVariables[K]
  brandId: string
  authUserId: string
  userEmail: string
  postId?: string
  calendarId?: string
  lang?: NotificationLang
}

// DB row shapes — kept here so inbox.ts and notify.ts share the same types
export interface NotificationTemplate {
  template_key: string
  lang: string
  subject: string
  title: string
  body_html: string
  body_text: string | null
  variables: string[]
  is_active: boolean
  updated_at: string
  updated_by: string | null
}

export type ResendStatus = 'queued' | 'sent' | 'failed' | 'bounced'

export interface Notification {
  notification_id: string
  brand_id: string
  auth_user_id: string
  template_key: string
  lang: string
  rendered_subject: string
  rendered_title: string
  rendered_body_html: string
  variables_used: Record<string, unknown>
  post_id: string | null
  calendar_id: string | null
  resend_message_id: string | null
  resend_status: ResendStatus
  resend_error: string | null
  sent_at: string | null
  read_at: string | null
  created_at: string
}
