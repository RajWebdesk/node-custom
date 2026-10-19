# Code rollback plan (DRAFT, 2026-10-20)

Method: check out the previous commit, reinstall with the committed lockfile, rebuild, and restart the API and web app. The database schema is not rolled back by this plan (see restore-plan).
Approval: pending.
