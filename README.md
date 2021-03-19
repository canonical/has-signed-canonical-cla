# has-signed-canonical-cla

This GitHub Action verifies whether or not a particular GitHub user has signed the Canonical Contributor Licence Agreement (https://ubuntu.com/legal/contributors).

## Inputs

### `username`

**Required** The name of the GitHub user to verify.

### `base_ref`

**Required** The name of the branch into which the PR is merging.

## Outputs

### `has_signed`

"true" if the user has signed the agreement, otherwise "false".

## Example usage

```
name: cla-check
on: [pull_request]

jobs:
  cla-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check if CLA signed
        id: has_signed_cla
        uses: canonical/has-signed-canonical-cla@1.0.7
        with:
          username: ${{ github.event.pull_request.user.login }}
          base_ref: ${{ github.base_ref }}
      - name: Verify result
        if: steps.has_signed_cla.outputs.has_signed != 'true'
        run: exit 1
```
