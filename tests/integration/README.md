# Integration tests (real PostgreSQL)

These run the real Express app, controllers and SQL against a real PostgreSQL. Only Razorpay, Firebase,
e-mail and Shiprocket are replaced by stubs.

```
# 1. any empty PostgreSQL database, e.g. in Docker:
#    docker run -e POSTGRES_PASSWORD=testpw -e POSTGRES_USER=curevan -e POSTGRES_DB=curevan_test -p 54329:5432 postgres:16
set DB_HOST=127.0.0.1 DB_PORT=54329 DB_NAME=curevan_test DB_USER=curevan DB_PASSWORD=testpw

# 2. load the test schema and run the real migrations
node tests/integration/setup_db.js

# 3. run the checks (pay-first = handoff pack flow, then the optional approval-first mode)
node tests/integration/acceptance.test.js
node tests/integration/acceptance.test.js --approval
```

`DEBUG_TEST=1` prints server-side errors.

`test_schema.sql` is a **test-only** reconstruction of the tables the code uses. It is not the production
schema. Once `migrations/0000_baseline.sql` is a real `pg_dump`, replace the schema step in `setup_db.js`
with that file so the tests run on the true schema.
