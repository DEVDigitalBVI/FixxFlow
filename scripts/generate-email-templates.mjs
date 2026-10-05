import { mkdirSync, writeFileSync } from 'node:fs';
import { renderEmail } from '../src/features/notifications/template.ts';

export const templates = [
 ['reset-password', 'Reset your password', 'Choose a new password to get back to your FixxFlow workspace.', 'Reset password', 'If you did not request this, you can safely ignore this email. Your password will stay the same.'],
 ['confirm-sign-up', 'Welcome to FixxFlow', 'Confirm your email address to finish setting up your FixxFlow account.', 'Confirm email address', 'If you did not create this account, you can safely ignore this email.'],
 ['invite-user', 'You are invited to FixxFlow', 'Your team has invited you to join its FixxFlow workspace. Accept your invitation to get started.', 'Accept invitation', 'If you were not expecting this invitation, contact your workspace administrator.'],
 ['magic-link-or-otp', 'Your FixxFlow sign-in link', 'Use the secure link below to sign in to your FixxFlow account.', 'Sign in to FixxFlow', 'If you did not request this link, you can safely ignore this email. Do not share this link.'],
 ['change-email-address', 'Confirm your email change', 'Confirm the change of your FixxFlow account email address to {{ .NewEmail }}.', 'Confirm email change', 'If you did not request this change, contact support@fixxflow.app.'],
 ['reauthentication', 'Verify your identity', 'Enter this one-time code in FixxFlow to confirm your identity.', '', 'Do not share this code. If you did not request it, contact support@fixxflow.app.'],
 ['password-changed', 'Your password was changed', 'The password for your FixxFlow account was changed.', '', 'If this was not you, reset your password at https://www.fixxflow.app/forgot-password and contact support@fixxflow.app immediately.'],
 ['email-address-changed', 'Your email address was changed', 'Your FixxFlow account email changed from {{ .OldEmail }} to {{ .Email }}.', '', 'If this was not you, contact support@fixxflow.app immediately.'],
 ['phone-number-changed', 'Your phone number was changed', 'Your FixxFlow account phone number changed from {{ .OldPhone }} to {{ .Phone }}.', '', 'If this was not you, contact support@fixxflow.app immediately.'],
 ['sign-in-method-linked', 'A sign-in method was linked', 'A {{ .Provider }} sign-in method was linked to your FixxFlow account.', '', 'If this was not you, contact support@fixxflow.app immediately.'],
 ['sign-in-method-removed', 'A sign-in method was removed', 'A {{ .Provider }} sign-in method was removed from your FixxFlow account.', '', 'If this was not you, contact support@fixxflow.app immediately.'],
 ['mfa-method-added', 'A verification method was added', 'A {{ .FactorType }} verification method was added to your FixxFlow account.', '', 'If this was not you, contact support@fixxflow.app immediately.'],
 ['mfa-method-removed', 'A verification method was removed', 'A {{ .FactorType }} verification method was removed from your FixxFlow account.', '', 'If this was not you, contact support@fixxflow.app immediately.'],
];
mkdirSync('supabase/templates', { recursive: true });
for (const [slug, title, message, action, note] of templates) {
 const purpose = ['confirm-sign-up', 'invite-user'].includes(slug) ? 'workspace'
  : action || slug === 'reauthentication' ? 'account-access' : 'security-alert';
 writeFileSync(`supabase/templates/${slug}.html`, renderEmail({ title, message, action, note, purpose, href: action ? '{{ .ConfirmationURL }}' : undefined, code: slug === 'reauthentication' ? '{{ .Token }}' : undefined }));
}
