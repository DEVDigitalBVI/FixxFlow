'use client';

import { createContext } from 'react';

/** A named stage within a pending form submission; never implies byte-level progress. */
export const FormProgressContext = createContext<string | null>(null);
