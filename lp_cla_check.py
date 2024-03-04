#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import argparse
from launchpadlib.launchpad import Launchpad

def lp_email_check(email, lp, cla_members):
    user = lp.people.getByEmail(email=email)
    if email.find('noreply')!=-1:
        print('- ' + email + ' ✓ noreply address')
        return True
    if not user:
        print('- ' + email + ' ✕ (has no Launchpad account)')
        return False
    if user in cla_members:
        print('- ' + email + ' ✓ (has signed the CLA)')
        return True
    else:
        print('- ' + email + ' ✕ (has not signed the CLA)')
        return False

def main():
    parser = argparse.ArgumentParser(description="")
    parser.add_argument(
        "email", help="Email address to verify"
    )
    opts = parser.parse_args()
    lp = Launchpad.login_anonymously("check CLA", "production")
    cla_members = lp.people["contributor-agreement-canonical"].participants
    
    if not lp_email_check(opts.email, lp, cla_members):
        sys.exit(1)

if __name__ == "__main__":
    main()
