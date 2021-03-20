#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import argparse

try:
    from launchpadlib.launchpad import Launchpad
except ImportError:
    sys.exit(
        "Install launchpadlib: sudo apt install python3-launchpadlib"
    )

def static_email_check(email):
    if email.endswith("@canonical.com"):
        print('- ' + email + ' ✓ (@canonical.com account)')
        return True
    if email.endswith("@mozilla.com"):
        print('- ' + email + ' ✓ (@mozilla.com account)')
        return True
    if email.endswith("@users.noreply.github.com"):
        print('- ' + email + ' ✕ (privacy-enabled github web edit email address)')
        return False
    return False

def lp_email_check(email, lp, cla_folks):
    contributor = lp.people.getByEmail(email=email)
    if not contributor:
        print('- ' + email + ' ✕ (has no Launchpad account)')
        return False

    if contributor in cla_folks:
        print('- ' + email + ' ✓ (has signed the CLA)')
        return True
    else:
        print('- ' + email + ' ✕ (has NOT signed the CLA)')
        return False

def main():
    parser = argparse.ArgumentParser(description="")
    parser.add_argument(
        "email", help="Email to verify"
    )
    opts = parser.parse_args()
    email = opts.email

    if not static_email_check(email):
        lp = Launchpad.login_anonymously("check CLA", "production")
        cla_folks = lp.people["contributor-agreement-canonical"].participants
        if not lp_email_check(email, lp, cla_folks):
            sys.exit(1)

if __name__ == "__main__":
    main()
