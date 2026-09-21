import Link from "next/link";
import { requireViewer } from "@/lib/auth/viewer";
import { createTicket } from "../tickets/actions";

export default async function StartChatPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireViewer();
  const { error } = await searchParams;
  return <div className="portal-page portal-form-page"><header className="portal-page-heading"><div><Link href="/app">← Home</Link><h1>Start a chat</h1><p>Send a message to IT. Replies will appear in your conversation.</p></div></header>{error && <div className="alert alert-error page-alert" role="alert">{error}</div>}<form action={createTicket} className="settings-card portal-request-form"><input type="hidden" name="source" value="chat"/><div className="field"><label htmlFor="title">What would you like to chat about?</label><input className="input" id="title" name="title" required minLength={3} maxLength={180} placeholder="For example, help with my laptop"/></div><div className="field"><label htmlFor="description">Your first message</label><textarea className="input textarea" id="description" name="description" required rows={5} maxLength={20000} placeholder="Tell IT what is happening"/></div><button className="button button-primary">Start conversation</button></form></div>;
}
