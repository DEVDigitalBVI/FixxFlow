// Provider codes are mapped to specific, safe next steps; raw errors never reach the UI.
export function passwordUpdateMessage(code?: string) {
  switch (code) {
    case 'same_password':
      return 'Choose a different password. The password you entered is already your current password.';
    case 'weak_password':
      return 'Choose a stronger password with at least 8 characters. Avoid common or previously exposed passwords.';
    case 'reauthentication_needed':
    case 'reauthentication_not_valid':
      return 'Your session needs fresh verification. Request a new password-reset email, open the newest link, and try again.';
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
    case 'bad_jwt':
    case 'user_not_found':
      return 'Your password-reset session is no longer valid. Request a new email and open its newest link to continue.';
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a minute, then try saving your new password again.';
    default:
      return 'Your password could not be saved. Try again. If it still fails, request a new password-reset link.';
  }
}
