# Ticket search

The ticket queue searches number, title/description, visible messages, requester/assigned technician display names and profile email, categories, and subcategories. Search includes resolved/closed history in All tickets. Queue filters still apply. Bare numeric input searches both ticket numbers and text error codes; prefix a number with `#` for exact ticket lookup.

Text search uses case-insensitive whole words with all words required in the title/description pair or one message/person/category. It does not combine terms scattered across different messages or different sources. Input is bounded to 200 characters. Typo correction, substring matching, and relevance ranking are deferred; existing queue sorting remains available.

A SECURITY INVOKER SQL RPC reads source tables through their existing RLS policies, including MFA, organization membership, requester ownership, and internal-note audience. Message text is never copied into employee-readable ticket rows. Expression GIN indexes stay current as source rows change; there is no background indexing job or stale search cache.

API filters/sort are applied to the returned relation before pagination. Pages use 50 results plus one lookahead row, with a stable ID tie-breaker. Pagination retains search/filter URL parameters. Offset pagination can shift as tickets change; cursor pagination remains a future improvement.

The existing four knowledge articles share a word-based search helper, and ticket search links to matching knowledge results. An editable knowledge publishing system and unified relevance-ranked ticket/article results are future work.

Validation: application tests, lint, typecheck, production build, and `supabase/tests/search-regression.sql` (transactional rollback fixtures). Database coverage includes title/description, messages, names, categories, exact numbers, error codes, duplicate suppression, organization isolation, internal-note confidentiality and MFA. A local PGlite check over 5,000 synthetic tickets found 50 expected matches in approximately 42 ms; this is not a production performance guarantee.
