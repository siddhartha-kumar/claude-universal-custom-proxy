# Contributing to claude-universal-custom-proxy

Thanks for considering a contribution. This project follows a small set of
conventions that keep the codebase stable and the `main` branch enterprise-
auditable.

## Branch model

- **`main`** — protected, signed-commit-only, always green CI. Every commit
  must reach `main` through a fast-forward merge from `dev`.
- **`dev`** — integration branch. PRs target `dev`. CI must pass before a
  merge to `main`.
- **`feature/*`, `fix/*`** — short-lived topic branches off `dev`. Squash or
  rebase before merging.

## Commit signing

All commits on `main` and `dev` are signed. SSH-signing is preferred; configure
it once:

```sh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global gpg.format ssh
git config --global commit.gpgsign true
```

Add the public key to GitHub at Settings → SSH and GPG keys → New SSH key →
key type **Signing Key**. Maintain `~/.ssh/allowed_signers` so local
verification works:

```sh
echo "you@example.com $(cat ~/.ssh/id_ed25519.pub)" >> ~/.ssh/allowed_signers
git config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers
```

Unsigned commits are rejected on `main`.

## Commit messages

Imperative mood, conventional structure:

```
<short subject — under 70 chars>

<wrapped body, 72 chars per line, explaining the why>

<optional trailers, e.g. Fixes #123>
```

Do **not** add `Co-Authored-By` lines for automated tooling. Keep authorship
to the human who reviewed and approved the change.

## Development loop

```sh
npm install
npm test                    # mechanics + e2e routing (no network, no credits)
node --check proxy.mjs      # syntax check
```

Optional smoke checks against the running proxy:

```sh
OLLAMA_API_KEY=<key> node proxy.mjs &
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/v1/models

# Send one tiny real prompt per free-tier provider (uses your keys):
node scripts/real-upstream-smoke.mjs
```

## Adding a new provider

1. Add the provider entry to `loadConfig` in `proxy.mjs` with `upstreamBaseUrl`,
   `upstreamApiKey`, `format` (`anthropic` or `openai-chat`), `authScheme`
   (`bearer` or `x-api-key`), and optionally `maxTokensField`.
2. Add its short code to `PROVIDER_BRAND_PREFIX`/`PROVIDER_CODE` in
   `scripts/generate-registry.mjs` if it is a picker-sensitive provider.
3. Add a route + streaming test in `test/proxy.test.mjs` modelled on the
   existing Ollama tests.
4. Update `.env.example`, the README provider table, and CHANGELOG.md.

## Adding / refreshing models

The catalog (`PROVIDER_MODELS` in `proxy.mjs`) is generated from live provider
data, not hand-maintained:

```sh
npm run models:probe                  # writes scripts/.model-probe.json
node scripts/generate-registry.mjs    # emit the PROVIDER_MODELS array
```

Paste the regenerated array into `proxy.mjs`. Only include models the provider
actually serves on its free tier (the probe filters subscription-gated and
non-chat models automatically). For a one-off override at runtime, use
`MODEL_MAP`, `MODEL_ALIASES`, and `MODEL_ROUTES` env vars.

## Versioning

Semantic Versioning. Each released change bumps `package.json` `version` and the
`SERVER_VERSION` constant in `proxy.mjs`.

## Pull request checklist

- [ ] CI passes (`npm test`, all syntax checks).
- [ ] CHANGELOG.md updated under an `[Unreleased]` (or version-bumped)
      section.
- [ ] README updated if user-visible behaviour changes.
- [ ] No secrets, no `.env` files, no `dist/` artefacts in the diff.
- [ ] Commits are signed (run `git log --show-signature -3` to verify).
- [ ] PR description references any issue it fixes.

## Code style

- Vanilla ES modules, no TypeScript, no transpiler.
- No runtime dependencies beyond what's already in `package.json`.
- Use `node:` prefix on built-in imports.
- Keep `proxy.mjs` flat: small named functions, no classes, no implicit
  globals.
- Prefer early returns over deep conditional nesting.

## License

By submitting a contribution, you agree it will be licensed under the
project's MIT License.
