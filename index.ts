import * as core from '@actions/core';
import * as github from '@actions/github';

import { lp_email_check } from './lp_cla_check';

const githubToken = core.getInput('github-token', {required: true})
const exemptedBots = core.getInput('exempted-bots', {required: true}).split(',').map(input => input.trim());
const implicitLicenses = core.getInput('implicit-approval-from-licenses', {required: true}).split(',').map(input => input.trim());

interface ContributorData {
    username: string;
    email: string;
    signed: boolean;
};

/** Returns the license that grants implicit CLA if found in the commit message.
 * Otherwise, returns an empty string.
 */
function hasImplicitLicense(commit_message: string): string {
  const lines = commit_message.split('\n');

  // Skip the commit subject (first line)
  for (let i = 1; i < lines.length; i++) {
      // Remove any trailing `\r` char
      const line = lines[i].trim();
      const license = line.match(/^License: ?(.+)$/);
      if (license && implicitLicenses.includes(license[1])) {
          return license[1];
      }
  }
  return '';
}

async function run() {
  // Get existing contributors
  const ghRepo = github.getOctokit(githubToken);
  const accept_existing_contributors = (core.getInput('accept-existing-contributors') == "true");
  let contributors_list = new Array<string>();

  if (accept_existing_contributors) {
    const contributors_url: string | undefined = github.context.payload.pull_request?.base.repo.contributors_url;
    const contributors = await ghRepo.request('GET ' + contributors_url);

    contributors_list = (contributors.data as { login: string; }[]).map(contributor => contributor.login);
  }

  // Get commit authors
  const commits_url: string | undefined = github.context.payload.pull_request?.commits_url;
  if (!commits_url)
    throw new Error('commits_url is undefined');
  const commits = await ghRepo.request('GET ' + commits_url);

  let commit_authors = new Map<string, ContributorData>();
  for (const data of commits.data) {
    // Check if the commit message contains a license header that matches
    // one of the licenses granting implicit CLA approval
    if (data.commit.message) {
      const goodLicense = hasImplicitLicense(data.commit.message);
      if (goodLicense) {
        console.log(`- commit ${data.sha} ✓ (${goodLicense} license)`);
        continue;
      }
    }

    let username: string | undefined = data.author?.login;
    if (!username) {
      core.error(`author is undefined for commit ${data.sha}`);
      continue;
    }
    const email = data.commit.author.email;
    commit_authors.set(username, {
        'username': username,
        'email': email,
        'signed': false
    });
  }

  // Check GitHub
  console.log('Checking the following users on GitHub:');
  const nodeFetch = (await import('node-fetch')).default;
  for (const [_, commit_author] of commit_authors) {
    const { username, email } = commit_author;

    if (username.endsWith('[bot]') && exemptedBots.includes(username.slice(0, -5))) {
      console.log(`- ${username} ✓ (Bot exempted from CLA)`);
      commit_author.signed = true;
      continue
    }
    if (email.endsWith('@canonical.com')) {
      console.log(`- ${username} ✓ (@canonical.com account)`);
      commit_author.signed = true;
      continue
    }
    if (email.endsWith('@mozilla.com')) {
      console.log(`- ${username} ✓ (@mozilla.com account)`);
      commit_author.signed = true;
      continue
    }
    if (email.endsWith('@ocadogroup.com') || email.endsWith('@ocado.com')) {
      console.log(`- ${username} ✓ (@ocado{,group}.com account)`);
      commit_author.signed = true;
      continue
    }
    if (accept_existing_contributors && contributors_list.includes(username)) {
      console.log(`- ${username} ✓ (already a contributor)`);
      commit_author.signed = true;
      continue
    }

    try {
      console.log('Check in the signed list service');
      const response = await nodeFetch(
        `https://cla-checker.canonical.com/check_user/${username}`,
      );
      if (response.status === 200) {
        console.log(`- ${username} ✓ (has signed the CLA)`);
        commit_author.signed = true;
      } else {
        console.log(`- ${username} ✕ (has not signed the CLA)`);
      }
    } catch (error: any) {
      const message = `'Error occurred while checking user: ${error.message}`;
      core.error(message);
    }
  }

  console.log();

  // Check Launchpad
  for (const [_, commit_author] of commit_authors) {
    if (commit_author.signed == false) {
      console.log('Checking the following user on Launchpad:');
      commit_author.signed = await lp_email_check(commit_author.email);
    }
  }

  console.log();

  // Determine Result
  let passed = true;
  let non_signers = new Array<string>();
  for (const [username, commit_author] of commit_authors) {
    if (!commit_author.signed) {
      passed = false;
      non_signers.push(username);
      break;
    }
  }

  if (passed) {
    console.info('CLA Check - PASSED');
  }
  else {
    core.setFailed('CLA Check - FAILED');
  }

  // We can comment on the PR only in the target context
  if (github.context.eventName !== "pull_request_target") {
    return;
  }

  // Find previous CLA comment if any
  const cla_header = '<!-- CLA signature is needed -->';
  const pull_request_number = github.context.payload.pull_request?.number;
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  const {data: comments} = await ghRepo.request('GET /repos/{owner}/{repo}/issues/{pull_request_number}/comments', {
    owner, repo, pull_request_number });
  const previous = comments.find((comment: { body: string; }) => comment.body.includes(cla_header));

  // Write a new updated comment on PR if CLA is not signed for some users
  if (!passed) {
    console.log("Posting or updating a comment on the PR")

    let authors_content = '';
    const cla_content=`not signed the Canonical CLA which is required to get this contribution merged on this project.
Please head over to https://ubuntu.com/legal/contributors to read more about it.`
    non_signers.forEach(function (author, i) {
      if (i == 0) {
        authors_content=author;
        return;
      } else if (i == non_signers.length-1) {
        authors_content=`and ${author}`;
        return;
      }
      authors_content=`, ${author}`;
    });

    if (non_signers.length > 1) {
      authors_content+=' have ';
    } else {
      authors_content+=' has ';
    }

    const body = `${cla_header}Hey! ${authors_content} ${cla_content}`
    // Create new comments
    if (!previous) {
      await ghRepo.request('POST /repos/{owner}/{repo}/issues/{pull_request_number}/comments', {
        owner, repo, pull_request_number, body});
    } else {
      // Update existing comment
      await ghRepo.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
        owner, repo, pull_request_number, body, comment_id: previous.id});
    }
  }

  // Update previous comment if everyone has now signed the CLA
  if (previous && passed) {
    await ghRepo.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
      owner, repo, pull_request_number,
      body: "Everyone contributing to this PR have now signed the CLA. Thanks!",
      comment_id: previous.id});
  }
}

run()
  .catch((error) => {
    core.setFailed(error.message);
  });
