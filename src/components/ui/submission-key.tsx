'use client';

import { useState } from 'react';

/** A mounted draft retains its retry key through errors and route refreshes. */
export function SubmissionKey({ value }: { value: string }) {
  const [key] = useState(value);
  return <input type="hidden" name="submissionKey" value={key}/>;
}
