# Keka-Time-Management

Client-side scripts that augment the Keka HR portal (Tampermonkey / bookmarklet / console).

The active script — `Enhanced Keka Log Duration by UV with Advanced Notifications.js` — is also published as a Gist (`ffc09708226db8bef988a0ecf1848518`) that the bookmarklet fetches at runtime.

## Auto-sync the Gist

`.github/workflows/sync-gist.yml` `PATCH`es the Gist whenever the script file is pushed to `master`.

One-time setup:

1. Create a GitHub Personal Access Token with **Gists: read & write** (fine-grained PAT recommended, scope it to your gists).
2. Repo Settings → Secrets and variables → Actions → New repository secret → name `GIST_TOKEN`, value the PAT.
3. Push a change to the script. The workflow appears under the Actions tab and the Gist updates within seconds.

You can also fire it manually from the Actions tab via **Run workflow** (the `workflow_dispatch` trigger).
