# Deployment plan (DRAFT, 2026-10-20)

Method: local Docker Compose runs the database only. The API and web app run locally. No production hosting is in scope.
Steps: 1) run CI (api and web jobs); 2) start the database and apply migrations; 3) start the API with validated configuration; 4) start the web app; 5) verify health endpoints.
Approval: pending.
