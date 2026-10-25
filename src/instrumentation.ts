import type { Instrumentation } from 'next';

import { reportUncaughtRequestError } from '@/lib/request-observability';

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  reportUncaughtRequestError(error, request, context);
};
