# Contributing to ProvisionIT

## Branch naming

Use the format `<name>/<short-description>`, for example `gio/wire-real-database`, `yihan/oauth-login`, or `vincent/connector-cleanup`.

Each branch should focus on one feature, bug fix, or maintenance goal. Related changes may be grouped together when they serve the same purpose.

Never commit directly to `main`.

## Commit messages

Use a short, descriptive summary in the present tense, with no full stop at the end. For example:

```
Add oauth_credentials table for multi-provider token sharing
Fix persistence.js import path in dataService
Clarify connector comments
```

If more explanation is needed, add a blank line and put the details below the summary.

## Coding conventions

- JavaScript: `camelCase` for variables and functions, `PascalCase` for classes
- SQL: `snake_case` for tables and columns
- Comments explain why, not what. Do not simply restate the code below
- Keep functions focused on a single responsibility
- Avoid unnecessary duplication and reuse existing utilities where appropriate
- No secrets (API keys, passwords, tokens) in the repo. Use `.env` and keep `.env` in `.gitignore`

## Pull requests

### Naming

Use short, descriptive PR titles that start with an action verb such as `Add`, `Fix`, `Update`, `Improve`, `Remove`, or `Clean up`.

For example:

```
Add GitHub Actions workflow to run tests on PRs
Clean up authentication code
Clarify connector comments
Update README with migrations, layout and /connections
```

Prefixes such as `feat:`, `fix:`, or `chore:` are optional, not required.

### Scope

- Keep each PR focused on one feature, bug fix, or maintenance goal
- Related changes across multiple files may be grouped into one PR when they contribute to the same objective
- Avoid combining unrelated changes that are difficult to review or test together

### Description

Each PR should explain:

- What changed and which parts of the project were affected
- Why the change was needed
- How to test or verify the changes

Include relevant evidence such as test results, screenshots, or successful CI checks where appropriate.

Report actual testing outcomes, including failed, skipped, or incomplete tests. Do not claim functionality has been tested unless it has been verified.

### Reviews and merging

- Request a review from at least one teammate before merging, when practical
- Address relevant review feedback before merging
- Do not merge your own PR without at least one teammate reviewing, if time allows
- Ensure required CI checks are passing before merging
- Record feedback and decisions in GitHub PR discussions

## Peer review checklist

- Does the code run?
- Have the relevant tests passed?
- Are any skipped or incomplete tests identified?
- Does it match the agreed canonical schema and API response shapes?
- Are existing interfaces and integrations preserved unless changes were intentional?
- Any obvious security issue (secrets committed, missing input validation)?
- Are the changes focused on the stated purpose of the PR?
- Is the code readable and consistent with the project's conventions?
- Does the PR explain what changed, why, and how it was tested?

Leave comments on the PR itself, not just in chat, so there is a record for later.

## Collaboration guidelines

- Communicate changes that may affect another team member's component or interface
- Coordinate integration work early to avoid incompatible implementations
- Keep changes small enough to review and test effectively
- Document important technical decisions and known limitations
- Prioritise working, tested functionality over unnecessary changes close to a deadline
