# Import assets

IT staff can open **Assets → Import spreadsheet**, or use the same link on **Add asset**.

1. Download the CSV template (opens in Excel), or use its column headers in an existing workbook.
2. Choose a UTF-8 CSV, XLSX, or XLS file up to 2 MB with at most 500 rows below the header.
3. Preview and validate. For workbooks with multiple worksheets, select the desired worksheet and preview again. Only that sheet is imported.
4. Review the normalized values and any row errors. Fix errors in the original spreadsheet, select the updated file, and preview again.
5. Select **Import assets**. The entire batch saves together or is rejected together.

Required columns: `tag`, `name`.

Optional columns: `kind`, `status`, `serial_number`, `model`, `assigned_email`, `location`, `purchased_on`, `warranty_until`.

Blank type and lifecycle default to `computer` and `available`. Enum keys and existing display labels are accepted. Employee email and active location name must match exactly within the current organization. Unmatched or ambiguous references block the batch. Leave them blank to assign equipment later.

Format tags and serial numbers as text to preserve leading zeroes. Use `YYYY-MM-DD` or Excel date cells for dates. Formulas, merged cells, unknown or duplicate headers, invalid dates, duplicate tags and existing tags are rejected. Remove unused formatted rows and columns when they exceed the template limits.

Imports only create assets. They never update existing equipment. After a network interruption, check inventory before retrying; unique tags prevent duplicate assets. Files are parsed in a browser worker with a 15-second timeout; the file itself is not uploaded or retained. Validated row data is sent to the app for organization-scoped preview checks and revalidated when saving. Normal asset RLS, membership checks and audit triggers apply. No database migration is needed.

Validation: parser/action tests in `src/features/assets/import.test.mjs`; transactional database regression in `supabase/tests/asset-import.sql` (all test fixtures roll back).
