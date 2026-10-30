'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';

import { startChat, type StartChatState } from '@/app/app/chat/actions';
import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { SubmissionKey } from '@/components/ui/submission-key';
import { SubmitButton } from '@/components/ui/submit-button';

import { ChatSupportHours } from './support-hours';

export function StartChatForm({
  initialError,
  submissionKey,
  timeZone,
  initialAt,
}: {
  initialError?: string;
  submissionKey: string;
  timeZone?: string;
  initialAt?: number;
}) {
  const [state, action, pending] = useActionState(startChat, {
    error: initialError,
  } as StartChatState);
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState('');
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) feedback.current?.focus();
  }, [state]);

  return (
    <form
      action={action}
      className="settings-card chat-intake-form"
      aria-labelledby="chat-compose-title"
      aria-busy={pending}
    >
      <SubmissionKey value={submissionKey} />
      <div className="chat-recipient">
        <span className="chat-intake-icon">
          <NavigationIcon name="support" />
        </span>
        <div>
          <h2 id="chat-compose-title">IT support team</h2>
          <ChatSupportHours timeZone={timeZone} initialAt={initialAt} />
        </div>
      </div>
      {state.error && (
        <Alert tone="error" role="alert" tabIndex={-1} ref={feedback}>
          <p>{state.error}</p>
          {state.fields?.topic && (
            <a className={buttonVariants({ variant: 'quiet' })} href="#chat-topic">
              Review subject
            </a>
          )}
          {state.fields?.message && (
            <a className={buttonVariants({ variant: 'quiet' })} href="#chat-first-message">
              Review message
            </a>
          )}
        </Alert>
      )}
      <div className="chat-intake-fields">
        <p className="form-note">Both fields are required.</p>
        <div className="field">
          <label htmlFor="chat-topic">What do you need help with?</label>
          <Input
            id="chat-topic"
            name="topic"
            required
            minLength={3}
            maxLength={180}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="For example, I can’t connect to the VPN"
            aria-invalid={Boolean(state.fields?.topic)}
            aria-describedby={state.fields?.topic ? 'chat-topic-error' : undefined}
          />
          {state.fields?.topic && (
            <p className="field-error" id="chat-topic-error">
              {state.fields.topic}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="chat-first-message">Your message</label>
          <Textarea
            fieldSize="tall"
            id="chat-first-message"
            name="message"
            required
            rows={7}
            maxLength={20000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Describe what’s happening and what you’ve tried so far…"
            aria-invalid={Boolean(state.fields?.message)}
            aria-describedby={`chat-message-hint${state.fields?.message ? ' chat-message-error' : ''}`}
          />
          <p className="form-note" id="chat-message-hint">
            Include any error message and when the issue started. Enter adds a new line.
          </p>
          {state.fields?.message && (
            <p className="field-error" id="chat-message-error">
              {state.fields.message}
            </p>
          )}
        </div>
      </div>
      <footer className="chat-intake-footer">
        <div>
          <Link className={buttonVariants({ variant: 'secondary' })} href="/app/chat">
            Cancel
          </Link>
          <SubmitButton variant="primary" disabled={pending} pendingLabel="Starting chat…">
            Start a chat
          </SubmitButton>
        </div>
      </footer>
      <span className="sr-only" role="status">
        {pending ? 'Starting your chat…' : ''}
      </span>
    </form>
  );
}

export function ChatIntakeGuide() {
  return (
    <aside className="chat-intake-guide" aria-labelledby="chat-guide-title">
      <h2 id="chat-guide-title">Need a quick answer?</h2>
      <p>Search existing help before starting a conversation.</p>
      <Link className={buttonVariants({ variant: 'secondary' })} href="/app/help">
        Browse help articles
      </Link>
    </aside>
  );
}
