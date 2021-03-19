# has-signed-canonical-cla

This GitHub Action verifies whether or not a particular GitHub user has signed the Canonical Contributor Licence Agreement (https://ubuntu.com/legal/contributors).

## Example usage

```
name: cla-check
on: [pull_request]

jobs:
  cla-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check if CLA signed
        uses: canonical/has-signed-canonical-cla@1.0.8
```
