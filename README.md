# has-signed-canonical-cla

This GitHub Action verifies whether or not the authors of a pull request have signed the Canonical Contributor Licence Agreement (https://ubuntu.com/legal/contributors).

When run on the `pull_request_target` event, this action will also comment on the PR if any authors have not signed the CLA, and update those messages when new commits or runs are processed.

## Inputs

### `github-token`

**Optional** The GitHub access token (e.g. secrets.GITHUB_TOKEN) used to create a CLA comment on the pull request (default: {{ github.token }})

### `exempted-bots`

**Optional** A comma-separated list of GitHub bots to exempt from CLA requirements. (default: dependabot,renovate)

### `implicit-approval-from-licenses`

**Optional** A comma-separated list of SPDX licenses identifiers (https://spdx.org/licenses/) for which approval of the CLA requirements is implicit. (default: Apache-2.0)

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
