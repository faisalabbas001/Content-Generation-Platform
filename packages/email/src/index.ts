/**
 * @repo/email — public API
 *
 * Sending a notification (any module, server-side only):
 *   import { notify } from '@repo/email'
 *   await notify({ templateKey: 'post_approved', variables: {...}, ... })
 *
 * Reading the inbox (UI / server components):
 *   import { getUnreadNotifications, getUnreadCount, markAllNotificationsRead } from '@repo/email'
 *
 * Admin template management:
 *   import { getAllTemplates, getTemplate, updateTemplate } from '@repo/email'
 */

export { notify } from './notify'

export {
  getUnreadNotifications,
  getAllNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  getAllTemplates,
  getTemplate,
  updateTemplate,
} from './inbox'

export type {
  NotifyParams,
  NotificationTemplateKey,
  NotificationVariables,
  NotificationLang,
  NotificationTemplate,
  Notification,
  ResendStatus,
} from './types'
