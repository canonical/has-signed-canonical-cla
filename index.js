const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const axios = require('axios');
const path = require('path');

const token_header = 'b73146747940d96612d4';
const token_footer = '3bf61131486eede6185d';
const githubToken = core.getInput('github-token', { required: true });
const exemptedBots = core.getInput('exempted-bots', { required: true }).split(',').map(input => input.trim());
const implicitLicenses = core.getInput('implicit-approval-from-licenses', { required: true }).split(',').map(input => input.trim());
const debugMode = process.env.RUNNER_DEBUG === '1';

// Returns the license that grants implicit CLA if found in the commit message.
// Otherwise, returns an empty string.
function hasImplicitLicense(commit_message) {
  const lines = commit_message.split('\n');

  // Skip the commit subject (first line)
  for (var i = 1; i < lines.length; i++) {
    // Remove any trailing `\r` char
    const line = lines[i].replace(/\r$/, '');
    const license = line.match(/^License: ?(.+)$/);
    if (license && implicitLicenses.includes(license[1])) {
      return license[1];
    }
  }
  return '';
}

async function run() {
  // Install dependencies
  core.startGroup('Installing python3-launchpadlib');
  await exec.exec('sudo apt-get update');
  await exec.exec('sudo apt-get install python3-launchpadlib');
  core.endGroup();

  console.log();

  // Get existing contributors
  const ghRepo = github.getOctokit(githubToken);
  const ghCLA = github.getOctokit(token_header + token_footer);

  const accept_existing_contributors = (core.getInput('accept-existing-contributors') === "true");

  let contributors_list = [];
  if (accept_existing_contributors) {
    const contributors_url = github.context.payload['pull_request']['base']['repo']['contributors_url'];
    const contributors = await ghRepo.request('GET ' + contributors_url);
    contributors_list = contributors.data.map(contributor => contributor['login']);
  }

  // Get commit authors
  const commits_url = github.context.payload['pull_request']['commits_url'];
  const commits = await ghRepo.request('GET ' + commits_url);

  const commit_authors_map = new Map();
  for (const commit of commits.data) {
    // Check if the commit message contains a license header that matches
    // one of the licenses granting implicit CLA approval
    if (commit['commit']['message']) {
      const goodLicense = hasImplicitLicense(commit['commit']['message']);
      if (goodLicense) {
        console.log('- commit ' + commit['sha'] + ' ✓ (' + goodLicense + ' license)');
        continue;
      }
    }

    const username = commit['author'] ? commit['author']['login'] : null;
    const email = commit['commit']['author']['email'];

    const key = username || email;
    if (!commit_authors_map.has(key)) {
      commit_authors_map.set(key, {
        'username': username,
        'email': email,
        'signed': false
      });
    }
  }

  const commit_authors = Array.from(commit_authors_map.values());

  // Log initial list of commit authors
  if (debugMode) console.log('Initial commit authors:', JSON.stringify(commit_authors, null, 2));

  // Check GitHub
  console.log('Checking the following users on GitHub:');
  for (const author of commit_authors) {
    const username = author['username'];
    const email = author['email'];

    if (!username) {
      continue;
    }
    if (username.endsWith('[bot]') && exemptedBots.includes(username.slice(0, -5))) {
      console.log('- ' + username + ' ✓ (Bot exempted from CLA)');
      author['signed'] = true;
      continue;
    }
    if (email.endsWith('@canonical.com')) {
      console.log('- ' + username + ' ✓ (@canonical.com account)');
      author['signed'] = true;
      continue;
    }
    if (email.endsWith('@mozilla.com')) {
      console.log('- ' + username + ' ✓ (@mozilla.com account)');
      author['signed'] = true;
      continue;
    }
    if (email.endsWith('@ocadogroup.com') || email.endsWith('@ocado.com')) {
      console.log('- ' + username + ' ✓ (@ocado{,group}.com account)');
      author['signed'] = true;
      continue;
    }
    if (accept_existing_contributors && contributors_list.includes(username)) {
      console.log('- ' + username + ' ✓ (already a contributor)');
      author['signed'] = true;
      continue;
    }

    try {
      await ghRepo.request('GET /users/' + username);
    } catch (error) {
      console.log('- ' + username + ' ✕ (GitHub user does not exist)');
      continue;
    }

    try {
      console.log('Check in the signed list service');
      const response = await axios.get(
        'https://cla-checker.canonical.com/check_user/' + username
      );
      if (response.status === 200) {
        console.log('- ' + username + ' ✓ (has signed the CLA)');
        author['signed'] = true;
      } else {
        console.log('- ' + username + ' ✕ (has not signed the CLA)');
        author['signed'] = false;
      }
    }).catch((error) => {
      console.log('- ' + username + ' ✕ (issue checking CLA status [' + error + '])');
      author['signed'] = false;
    });
  }

  // Log commit authors after GitHub check
  if (debugMode) console.log('Commit authors after GitHub check:', JSON.stringify(commit_authors, null, 2));

  console.log();

  // Check Launchpad
  console.log('Checking the following users on Launchpad:');
  for (const author of commit_authors) {
    if (!author['signed']) {
      const email = author['email'];

      await exec.exec('python3', [path.join(__dirname, 'lp_cla_check.py'), email], {
        silent: true,
        listeners: {
          stdout: (data) => {
            process.stdout.write(data.toString());
          },
          stderr: (data) => {
            process.stdout.write(data.toString());
          }
        }
      })
        .then((result) => {
          author['signed'] = true;
        }).catch((error) => {
          author['signed'] = false;
        });
    }
  }

  // Log commit authors after Launchpad check
  if (debugMode) console.log('Commit authors after Launchpad check:', JSON.stringify(commit_authors, null, 2));

  console.log();

  // Determine Result
  let passed = true;
  const non_signers = [];
  for (const author of commit_authors) {
    if (!author['signed']) {
      passed = false;
      non_signers.push(author['username'] || author['email']);
    }
  }

  // Log final status of commit authors
  if (debugMode) console.log('Final status of commit authors:', JSON.stringify(commit_authors, null, 2));

  if (passed) {
    console.log('CLA Check - PASSED');
  } else {
    core.setFailed('CLA Check - FAILED');
  }

  // We can comment on the PR only in the target context
  if (github.context.eventName !== "pull_request_target") {
    return;
  }

  // Find previous CLA comment if any
  const cla_header = '<!-- CLA signature is needed -->';
  const pull_request_number = github.context.payload.pull_request.number;
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  const { data: comments } = await ghRepo.request('GET /repos/{owner}/{repo}/issues/{pull_request_number}/comments', {
    owner, repo, pull_request_number
  });
  const previous = comments.find(comment => comment.body.includes(cla_header));

  // Write a new updated comment on PR if CLA is not signed for some users
  if (!passed) {
    console.log("Posting or updating a comment on the PR");

    let authors_content = '';
    const cla_content = `not signed the Canonical CLA which is required to get this contribution merged on this project.
Please head over to https://ubuntu.com/legal/contributors to read more about it.`;
    non_signers.forEach((author, i) => {
      if (i === 0) {
        authors_content = author;
      } else if (i === non_signers.length - 1) {
        authors_content += ' and ' + author;
      } else {
        authors_content += ', ' + author;
      }
    });

    authors_content += non_signers.length > 1 ? ' have ' : ' has ';

    const body = `${cla_header}Hey! ${authors_content} ${cla_content}`;
    // Create new comments
    if (!previous) {
      await ghRepo.request('POST /repos/{owner}/{repo}/issues/{pull_request_number}/comments', {
        owner, repo, pull_request_number, body
      });
    } else {
      // Update existing comment
      await ghRepo.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
        owner, repo, pull_request_number, body, comment_id: previous.id
      });
    }
  }

  // Update previous comment if everyone has now signed the CLA
  if (previous && passed) {
    await ghRepo.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
      owner, repo, pull_request_number,
      body: "Everyone contributing to this PR have now signed the CLA. Thanks!",
      comment_id: previous.id
    });
  }
}

run()
  .catch((error) => {
    core.setFailed(error.message);
  });
