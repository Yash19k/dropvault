# Running DropVault fully offline

No AWS account needed. LocalStack in Docker emulates S3, DynamoDB, KMS and SES.
`server.py` runs the **real Lambda handlers** from `../endpoints` (unmodified),
including the auth service, the authorizer and the admin panel's API, behind a
small API-Gateway-style router.

| Piece | URL |
| --- | --- |
| Web app (Vite) | http://localhost:3001 |
| API (auth + files) | http://localhost:4000/v1 |
| LocalStack | http://localhost:4566 |
| Sent emails (temp passwords, share links) | http://localhost:4566/_aws/ses |

## Start

Requirements: Docker Desktop (running), Python 3 with `boto3` + `jsonschema`, Node 20+.

```powershell
powershell -ExecutionPolicy Bypass -File local\start.ps1            # SSE-S3
powershell -ExecutionPolicy Bypass -File local\start.ps1 per_user   # per-user KMS keys
powershell -ExecutionPolicy Bypass -File local\start.ps1 -AdminEmail you@example.com   # with an admin
```

Or by hand:

```bash
docker compose -f local/docker-compose.yml up -d
python local/server.py                  # KMS_MODE=per_user to change mode, ADMIN_EMAILS=you@example.com for an admin
cd web && npm run dev                   # web/.env.local -> http://localhost:4000
```

## Accounts

Auth is deliberately simple:

- **Sign up**: full name, email and a password (8+ characters). You're signed
  in straight away. There's no confirmation email and no authenticator/MFA.
- **Sign in**: email and password.

The web app's sign-up and login pages were simplified to match, so they no
longer work with the original CognitoApi auth service.

Accounts live in LocalStack's DynamoDB (`enclave-users-local`), like
everything else, so `docker compose down` resets them along with the files.
Accounts made by older versions of this server (`local/.data/auth.json`) are
copied in when it starts, with the same passwords. Session tokens are signed
with a key kept in `local/.data/token_secret`, so sessions survive a restart
of `server.py`.

## Admin panel

Start with `-AdminEmail you@example.com` (or set `ADMIN_EMAILS` for
`server.py`). The API window prints a temporary password for that account the
first time (owner addresses can't be signed up for on the website, as on AWS);
sign in with it, change it under your name in the sidebar, and **Admin**
appears in the sidebar (`http://localhost:3001/admin`). From there you can make other
accounts admins. Everything works offline; on the Health page the tables,
storage, email and encryption are checked against LocalStack, while the API
Gateway, Lambda, CloudWatch and log checks exist only on AWS.

Share emails are not delivered anywhere; open the SES page above to see them
and click the download link.

## Notes

- LocalStack runs without persistence: `docker compose down` (or restarting it)
  wipes files. Restart `server.py` afterwards so it recreates the bucket and table.
  Accounts are stored in `local/.data/auth.json`; delete it to reset them.
- The only local adaptation: S3 calls are redirected to LocalStack with
  path-style URLs (the Lambdas hard-code the real regional AWS endpoint).
- Like the Lambda authorizer on AWS, the server checks the token before a
  protected route and passes the caller to the handler. The shared Lambda
  layer (`endpoints/common/python`) is put on the import path.
- The storage quota is 10 GB here too (`USER_QUOTA_BYTES` to change it).
  Abandoned uploads are not cleaned up offline (that needs DynamoDB streams).
