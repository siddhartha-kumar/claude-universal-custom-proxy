# Branching Strategy

The repository uses two long-lived branches.

| Branch | Purpose |
| --- | --- |
| `main` | Production-stable branch |
| `dev` | Active integration branch |

Feature work lands on `dev`. After validation, `dev` is merged into `main` with a normal merge commit or fast-forward when appropriate. Force pushes are avoided.

Release tags are created from `main` using semantic version tags such as `v0.1.0`.
