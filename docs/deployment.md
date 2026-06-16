# Deployment — Vercel (Hobby/free tier)

## Branch model

| Branch       | Vercel target | URL pattern                              |
| ------------ | ------------- | ---------------------------------------- |
| `main`       | Production    | your prod domain (e.g. `openclaw.com`)   |
| `dev`        | Preview       | aliased to `staging.<domain>` (optional) |
| `feature/*`  | Preview       | auto-generated `*.vercel.app`            |

- `feature/*` branches are PR'd into `dev`. CI must pass.
- `dev` is PR'd into `main` to promote to prod. CI must pass.
- No direct pushes to `main` or `dev` (enforced by branch protection).

## How a deploy happens

1. Push to `dev` or `main` (via merged PR).
2. GitHub Actions runs the `gate` job: `check-types`, `lint`, `test`, `hard-rules`, `gitleaks`.
3. If gate is green → `deploy-staging` (for `dev`) or `deploy-production` (for `main`) runs.
4. The deploy job uses `vercel pull` → `vercel build` → `vercel deploy` so env vars come from the Vercel dashboard, not from the repo.

If the gate fails, **nothing deploys**. This is the difference vs. Vercel's default Git integration, which deploys regardless of CI status.

## One-time setup

### 1. Vercel project

1. `npm i -g vercel`
2. From `apps/web/`: `vercel link` (creates `.vercel/project.json` — already gitignored).
3. In Vercel dashboard → Project → Settings → Git → **disconnect the GitHub integration**, OR set "Ignored Build Step" to `exit 0` so Vercel never deploys on its own. Actions is the only deploy path.
4. Settings → General → Root Directory: `apps/web`. Framework: Next.js. Install/Build commands: leave blank (driven by `vercel.json`).

### 2. Environment variables in Vercel

Settings → Environment Variables. For each variable in `.env.example`, add it twice:

- **Environment: Production** → values for the production Supabase project + production API keys.
- **Environment: Preview** → values for the staging Supabase project + staging/test keys. (Optionally branch-scope to `dev` if you want feature-branch previews to use yet a third config.)

`NEXT_PUBLIC_*` vars must be set per environment too — they're baked into the client bundle at build time.

### 3. GitHub secrets (repo-level, used by both environments)

Settings → Secrets and variables → Actions → New repository secret:

- `VERCEL_TOKEN` — from Vercel → Account Settings → Tokens (scope: full account or just this project)
- `VERCEL_ORG_ID` — from `.vercel/project.json` after `vercel link`
- `VERCEL_PROJECT_ID` — from `.vercel/project.json`

> **If you ever need to switch Vercel accounts:** rotate these three secrets to the new account's values. No code or workflow change needed. The next push deploys to the new account.

### 4. GitHub Environments (gating + audit trail)

Settings → Environments → create two:

- `production` — add required reviewers (yourself) so prod deploys need a click. Optional but recommended.
- `staging` — no reviewers; auto-deploys on every `dev` push.

The deploy workflow references these via `environment: production` / `environment: staging`, so each deploy shows up in the Environments tab with its URL and history.

### 5. Branch protection

Settings → Branches → Add rules for `main` and `dev`:

- Require a pull request before merging
- Require status checks to pass: `build-test-lint`
- Require branches to be up to date
- Do not allow bypassing the above

### 6. (Optional) Staging alias

If you want `dev` to deploy to a stable URL like `staging.openclaw.com`:

1. Add the domain in Vercel → Project → Domains, scope to **Preview** branch `dev`.
2. Settings → Variables → **Variables** (not secrets) → add `STAGING_ALIAS=staging.openclaw.com`.
3. The deploy job will alias each new `dev` deployment to that domain.

## Switching credentials / rotating accounts

The "intelligent shift" works because every deploy coordinate is externalised:

| What changed                  | Where to update                                                  | Code change? |
| ----------------------------- | ---------------------------------------------------------------- | ------------ |
| Vercel account / token        | GitHub repo secret `VERCEL_TOKEN` (and `ORG_ID`/`PROJECT_ID`)    | No           |
| Supabase project              | Vercel env vars (Production or Preview) + `pnpm db:swap` locally | No           |
| Any API key (Anthropic, etc.) | Vercel env var for that environment                              | No           |
| Production domain             | Vercel → Domains                                                 | No           |

## Verifying

After first setup, push a no-op commit to `dev`. Watch:

1. Actions tab: `Deploy` workflow runs, gate passes, `deploy-staging` job runs.
2. Vercel dashboard → Deployments: new preview deployment appears.
3. GitHub → Environments → `staging`: shows the deployed URL.

Repeat for `main` once staging is green.
