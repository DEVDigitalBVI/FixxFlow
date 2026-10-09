'use client';
import { useState, type ReactNode } from 'react';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { saveTimezone } from './actions';
export function TimezoneSettingsForm({ scope, initial, children }: { scope: 'personal' | 'organization'; initial: string; children: ReactNode }) {
  const [expected, setExpected] = useState(initial);
  return <ActionForm className="stack" action={async data => {
    const result = await saveTimezone(data);
    if (result.success) setExpected(String(data.get('timezone') ?? ''));
    return result;
  }}><input type="hidden" name="scope" value={scope}/><input type="hidden" name="expectedTimezone" value={expected}/>{children}<SubmitButton className="button button-primary">Save timezone</SubmitButton></ActionForm>;
}
