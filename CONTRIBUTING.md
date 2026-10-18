# Contributing to ProvisionIT

## Branch naming

`<name>/<short-description>`, for example `gio/wire-real-database` or `yihan/oauth-login`.
One branch per feature or fix. Never commit straight to `main`.

## Commit messages

Present tense, short summary on the first line, no full stop at the end. For example:

```
Add oauth_credentials table for multi-provider token sharing
Fix persistence.js import path in dataService
```

If it needs more explanation, add a blank line and put the details below the summary.

## Coding conventions

- JavaScript: `camelCase` for variables and functions, `PascalCase` for classes
- SQL: `snake_case` for tables and columns
- Comments explain why, not what. Don't restate the line below in plain English
- Keep functions single-purpose. If a function does two things, split it into two
- No secrets (API keys, passwords, tokens) in the repo. Use `.env`, and keep `.env` in `.gitignore`

## Pull requests

- One PR per feature or fix, not a pile of unrelated changes
- PR description: what changed, why, and how to test it
- Don't merge your own PR without at least one teammate reviewing, if time allows

## Peer review checklist

- Does it run?
- Does it match the agreed schema and API response shapes?
- Any obvious security issue (secrets committed, missing input validation)?
- Leave comments on the PR itself, not just in chat, so there is a record for later
