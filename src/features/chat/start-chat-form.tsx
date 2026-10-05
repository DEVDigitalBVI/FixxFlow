'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { startChat, type StartChatState } from '@/app/app/chat/actions';
import { SubmitButton } from '@/components/ui/submit-button';
import { NavigationIcon } from '@/components/navigation/navigation-icon';

export function StartChatForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState(startChat, { error: initialError } as StartChatState);
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState('');
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.error) feedback.current?.focus(); }, [state]);

  return <form action={action} className="settings-card chat-intake-form" aria-labelledby="chat-compose-title" aria-busy={pending}>
    <div className="chat-recipient">
      <span className="chat-intake-icon"><NavigationIcon name="support"/></span>
      <div><span className="muted">New conversation with</span><h2 id="chat-compose-title">IT support</h2></div>
    </div>
    {state.error && <div className="alert alert-error" role="alert" tabIndex={-1} ref={feedback}>
      <p>{state.error}</p>
      {state.fields?.topic && <a className="button button-quiet" href="#chat-topic">Review subject</a>}
      {state.fields?.message && <a className="button button-quiet" href="#chat-first-message">Review message</a>}
    </div>}
    <div className="chat-intake-fields">
      <p className="form-note">Both fields are required.</p>
      <div className="field">
        <label htmlFor="chat-topic">What do you need help with?</label>
        <input className="input" id="chat-topic" name="topic" required minLength={3} maxLength={180} value={topic} onChange={event => setTopic(event.target.value)} placeholder="For example, I can’t connect to the VPN" aria-invalid={Boolean(state.fields?.topic)} aria-describedby={state.fields?.topic ? 'chat-topic-error' : undefined}/>
        {state.fields?.topic && <p className="field-error" id="chat-topic-error">{state.fields.topic}</p>}
      </div>
      <div className="field">
        <label htmlFor="chat-first-message">Your message</label>
        <textarea className="input textarea" id="chat-first-message" name="message" required rows={7} maxLength={20000} value={message} onChange={event => setMessage(event.target.value)} placeholder="Describe what’s happening and what you’ve tried so far…" aria-invalid={Boolean(state.fields?.message)} aria-describedby={`chat-message-hint${state.fields?.message ? ' chat-message-error' : ''}`}/>
        <p className="form-note" id="chat-message-hint">Include any error message and when the issue started. Enter adds a new line.</p>
        {state.fields?.message && <p className="field-error" id="chat-message-error">{state.fields.message}</p>}
      </div>
    </div>
    <footer className="chat-intake-footer">
      <p>Your first message starts the conversation.</p>
      <div><Link className="button button-secondary" href="/app/chat">Cancel</Link><SubmitButton className="button button-primary" disabled={pending} pendingLabel="Starting chat…">Start a chat</SubmitButton></div>
    </footer>
    <span className="sr-only" role="status">{pending ? 'Starting your chat…' : ''}</span>
  </form>;
}

export function ChatIntakeGuide() {
  return <aside className="chat-intake-guide" aria-labelledby="chat-guide-title">
    <h2 id="chat-guide-title">What happens next</h2>
    <p>Share the issue in your own words. You can add more details as you talk with IT.</p>
    <div className="chat-guide-detail"><NavigationIcon name="chat"/><div><h3>Pick up where you left off</h3><p>Return to Chats to read replies and keep the conversation going.</p></div></div>
    <div className="chat-guide-detail"><NavigationIcon name="people"/><div><h3>The IT team will follow up</h3><p>A technician may not be available immediately. You don’t need to keep this page open.</p></div></div>
    <div className="chat-guide-help"><h3>Looking for a quick answer?</h3><p>A help article may already have what you need.</p><Link className="button button-secondary" href="/app/help">Browse knowledge base</Link></div>
  </aside>;
}
