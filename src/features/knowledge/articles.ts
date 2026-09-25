export const articles = [
  { title: "Reset your password", body: "Use the Forgot password link on the sign-in page. Open the email we send you and choose a new password. If you cannot access your email, contact IT." },
  { title: "Connect to Wi-Fi", body: "Choose your organization’s Wi-Fi network, enter your work credentials, and reconnect. If the network is missing or your credentials are rejected, send IT a request with your location and device type." },
  { title: "Set up multi-factor authentication", body: "Open Account security, choose Set up authenticator, and scan the code with your authenticator app. Keep your recovery method in a safe place." },
  { title: "Report a lost device", body: "Contact IT as soon as possible. Tell us what device is missing, when you last had it, and how we can reach you. If your account may be exposed, reset your password." },
];

export function searchArticles(query: string) {
  const words = query.trim().toLowerCase().slice(0, 200).split(/\s+/).filter(Boolean);
  return articles.filter(article => words.every(word => `${article.title} ${article.body}`.toLowerCase().includes(word)));
}
