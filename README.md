# has-signed-canonical-cla

This GitHub Action verifies whether or not the authors of a pull request have signed the Canonical Contributor Licence Agreement (https://ubuntu.com/legal/contributors).

It will comment on the PR if any authors have not signed the CLA and update the messages when new commits or run are processed. **Note:** to enable this feature, the action needs to run on `pull_request_target` instead of `pull_request` event.

## Inputs

### `accept-existing-contributors`

**Optional** Pass CLA check for existing project contributors (default: false)

### `github-token`

**Optional** Choose which GitHub access token (e.g. secrets.GITHUB_TOKEN) is used to create or update the comment CLA and check for existing project contributors (default: {{ github.token }})

## Example usage

```
name: cla-check
on: [pull_request_target]

jobs:
  cla-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check if CLA signed
        uses: canonical/has-signed-canonical-cla@v1
```
