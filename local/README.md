# Running Enclave fully offline

No AWS account needed. LocalStack in Docker emulates S3, DynamoDB, KMS and SES.
`server.py` runs the **real Lambda handlers** from `../endpoints` (unmodified)
behind a small API-Gateway-style router, and also acts as a stand-in for the
CognitoApi auth microservice.

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
```

Or by hand:

```bash
docker compose -f local/docker-compose.yml up -d
python local/server.py                  # KMS_MODE=per_user to change mode
cd web && npm run dev                   # web/.env.local -> http://localhost:4000
```

## Accounts

Auth is deliberately simple:

- **Sign up**: full name, email and a password (8+ characters). You're signed
  in straight away. There's no confirmation email and no authenticator/MFA.
- **Sign in**: email and password.

The web app's sign-up and login pages were simplified to match, so they no
longer work with the original CognitoApi auth service.

Share emails are not delivered anywhere; open the SES page above to see them
and click the download link.

## Notes

- LocalStack runs without persistence: `docker compose down` (or restarting it)
  wipes files. Restart `server.py` afterwards so it recreates the bucket and table.
  Accounts are stored in `local/.data/auth.json`; delete it to reset them.
- The only local adaptation: S3 calls are redirected to LocalStack with
  path-style URLs (the Lambdas hard-code the real regional AWS endpoint).
