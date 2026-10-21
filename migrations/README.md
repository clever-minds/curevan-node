# Database migrations

- File name rule: `NNNN_short_description.sql` (four digits, then snake_case). Applied in filename order.
- One change per file. **Never edit a file that has been applied** - add a new numbered file instead.
- Every migration runs inside a transaction; a failure rolls back and stops the run.
- `0000_baseline.sql` is the full schema dump of the production-matching database
  (`pg_dump --schema-only --no-owner --no-privileges -d <db>`), cleaned of owner/grant lines.

## Fresh (empty) database
```
npm run migrate
```

## Existing database that already has the schema
```
node scripts/migrate.js --baseline   # records 0000_baseline.sql as applied, does not run it
npm run migrate                      # applies everything after the baseline
```

## Check what is applied
```
npm run migrate:status
```
Applied files are tracked in the `schema_migrations` table.
