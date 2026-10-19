# Initial account setup (documented process, pilot)

Status: process documented. Run by the WDS team on a local database. No account is created by this document.

Accounts to create (names are placeholders until the WDS team supplies them):
- Administrator: `[Administrator Name]`, `[Administrator Email]`
- Manager (Project Manager): `Hazel`, `[Hazel Email]`
- Manager (designated reviewer): `AS`, `[AS Email]`

Steps (from `app/`, with the database running and migrated):
1. Set the password in the local environment only. Use a password of at least 12 characters. Never commit it.
2. Run: `npx tsx src/scripts/create-account.ts <email> "<name>" <ADMINISTRATOR|MANAGER|EMPLOYEE>`
3. The script prints only the outcome, never the password.
4. Clear the password variable from the shell afterwards.

Rules:
- No passwords in source, documents, or chat.
- Accounts are created only after the WDS team confirms the names and emails.
- The designated reviewer role is a Manager with the reviewer flag. The reviewer flag is not yet part of the data model. Reviewer checks are pending.
