# Search

## Global search

The Search button and Cmd/Ctrl+K open the shared command dialog. Navigation shortcuts remain separate. Tickets, people and published articles share one **Best matches** list, with a written type on each row. Employees search permitted tickets and guides; people results remain staff-only.

The database returns at most 20 results: exact ticket numbers first, followed by exact title/name matches, prefixes and fragments, other literal matches, then approximate word matches. Equal scores use stable title/type/ID ordering. Readable message content remains searchable. Errors offer Retry even when navigation shortcuts are available.

All query terms must match. Alphabetic words of 4–7 letters allow one edit; words of 8–32 letters allow two. Edits include insertion, deletion, replacement and adjacent transposition: `pritner` can find `printer`. Approximate results say **Similar match**. Numbers, email addresses, punctuation and shorter fragments remain literal. `#123` is an exact ticket lookup. Wi-Fi and wifi are normalized for relevance scoring. Empty queries show shortcuts without a database request.

`search_workspace` is a SECURITY INVOKER RPC using the authenticated client, live organization membership, MFA and source-table RLS. Existing literal RPCs preserve deep ticket/message/category and article-content matches. Typo matching applies to ticket title/description, profile name/email/job title, and article title/summary. Trigram GIN indexes prefilter candidates and bounded edit distance rejects loose matches. Private message text is never copied into employee-readable search documents. Hidden library preferences also apply to approximate matches. Responses are private and uncached.

Apply `20261027210812_ranked_workspace_search.sql` before releasing the application change. This migration remains local alongside the pending chat and knowledge-base work.

## Feature lists

Feature lists retain literal case-insensitive fragments with all whitespace-separated terms required across their searchable fields. Punctuation and wildcard characters are literal. Ticket queues search number, title/description, readable messages, requester/assigned technician profiles, categories and subcategories. All tickets includes resolved/closed history while preserving filters and sorting.

Input is bounded to 200 characters. Bare numbers match ticket-number fragments and text error codes; `#123` remains exact. Feature lists are not typo-corrected. Filters and sorting apply before pagination, with stable ID tie-breakers. Offset pagination can shift as tickets change.

## Validation

Coverage includes mixed-entity ranking, exact numbers, transpositions, multiple typo terms, all-term matching, literal punctuation, private notes, hidden guides, publication/audience boundaries, staff-only people, organization isolation, bounded results and keyboard selection. Database tests execute the actual migrated SQL. Existing list-search regressions remain in place.
