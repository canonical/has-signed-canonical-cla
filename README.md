# has-signed-canonical-cla

This GitHub Action verifies whether or not a particular GitHub user has signed the Canonical Contributor Licence Agreement (https://ubuntu.com/legal/contributors).

## Inputs

### `username`

**Required** The name of the GitHub user to verify.

### `token`

**Required** GitHub token.

## Outputs

### `has_signed`

True if the user has signed the agreement, otherwise False.

## Example usage

```
- name: Check if the current user has signed the Canonical CLA
  id: has_signed_cla
  uses: actions/has-signed-canonical-cla@v1.0
  with:
    username: ${{ github.actor }}
    token: ${{ secrets.GITHUB_TOKEN }}
- name: Passed Check
  if: steps.has_signed_cla.outputs.has_signed == 'true'
  run: echo ${{ github.actor }} has signed the Canonical CLA
- name: Failed Check
  if: steps.has_signed_cla.outputs.has_signed == 'false'
  run: echo ${{ github.actor }} has NOT signed the Canonical CLA
```
