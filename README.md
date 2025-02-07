# has-signed-canonical-cla

This GitHub Action verifies whether or not the authors of a pull request have signed the Canonical Contributor Licence Agreement (https://ubuntu.com/legal/contributors).

## Inputs

### `github-token`

**Optional** The GitHub access token (e.g. secrets.GITHUB_TOKEN) used to create a CLA comment on the pull request (default: {{ github.token }})

### `implicit-approval-from-licenses`

**Optional** A comma-separated list of SPDX licenses identifiers (https://spdx.org/licenses/) for which approval of the CLA requirements is implicit. (default: Apache-2.0)

## Example usage

```
name: cla-check
on: [pull_request]

jobs:
  cla-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check if CLA signed
        uses: canonical/has-signed-canonical-cla@v1
```
