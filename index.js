const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const path = require('path');

const token_header = 'b73146747940d96612d4'
const token_footer = '3bf61131486eede6185d'
const githubToken = core.getInput('github-token', {required: true})

async function run() {
  // Install dependencies
  core.startGroup('Installing python3-launchpadlib')
  await exec.exec('sudo apt-get update');
  await exec.exec('sudo apt-get install python3-launchpadlib');
  core.endGroup()

  console.log();

  // Get existing contributors
  const octokit = github.getOctokit(token_header + token_footer);

  const accept_existing_contributors = (core.getInput('accept-existing-contributors') == "true");

  if (accept_existing_contributors) {
    const contributors_url = github.context.payload['pull_request']['base']['repo']['contributors_url'];
    const contributors = await octokit.request('GET ' + contributors_url);

    var contributors_list = []
    for (const i in contributors.data) {
      contributors_list.push(contributors.data[i]['login']);
    }
  }

  // Get commit authors
  const commits_url = github.context.payload['pull_request']['commits_url'];
  const commits = await octokit.request('GET ' + commits_url);

  function getUsername(commit) {
    var username;
    if (commit['author']) {
      username = commit['author']['login'];
    }
    return username;
  }

  function getEmail(commit) {
    return commit['commit']['author']['email'];
  }

  function isWebMerge(commit) {
    return commit['committer']['login'] == 'web-flow' && commit['parents'].length > 1;
  }

  const signed_users = {};

  function isSigned(commit) {
    return signed_users[getUsername(commit)] == true;
  }

  function setSigned(commit, signed) {
    signed_users[getUsername(commit)] = signed;
  }

  // Check GitHub
  console.log('Checking the following users on GitHub:');
  for (const i in commits.data) {
    const commit = commits.data[i];
    const username = getUsername(commit);
    const email = getEmail(commit);

    if (!username || isSigned(commit)) {
      continue;
    }
    if (isWebMerge(commit)) {
      setSigned(commit, true);
      continue;
    }
    if (username == 'dependabot[bot]') {
      console.log('- ' + username + ' ✓ (GitHub Dependabot)');
      setSigned(commit, true);
      continue
    }
    if (email.endsWith('@canonical.com')) {
      console.log('- ' + username + ' ✓ (@canonical.com account)');
      setSigned(commit, true);
      continue
    }
    if (email.endsWith('@mozilla.com')) {
      console.log('- ' + username + ' ✓ (@mozilla.com account)');
      setSigned(commit, true);
      continue
    }
    if (accept_existing_contributors && contributors_list.includes(username)) {
      console.log('- ' + username + ' ✓ (already a contributor)');
      setSigned(commit, true);
      continue
    }

    await octokit.request('GET /orgs/{org}/members/{username}', {
      org: 'CanonicalContributorAgreement',
      username: username
    }).then((result) => {
      if (result.status == 204) {
        console.log('- ' + username + ' ✓ (has signed the CLA)');
        setSigned(commit, true);
      }
      else {
        console.log('- ' + username + ' ✕ (has not signed the CLA)');
        setSigned(commit, false);
      }
    }).catch((error) => {
      console.log('- ' + username + ' ✕ (has not signed the CLA)');
      setSigned(commit, false);
    });
  }

  console.log();

  // Check Launchpad
  console.log('Checking the following users on Launchpad:');
  for (const i in commits.data) {
    const commit = commits.data[i];
    if (!isSigned(commit)) {
      const email = getEmail(commit);

      await exec.exec('python3', [path.join(__dirname, 'lp_cla_check.py'), email], options = {
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
          setSigned(commit, true);
        }).catch((error) => {
          setSigned(commit, false);
        });
    }
  }

  console.log();

  // Determine Result
  passed = true
  var non_signers = []
  for (const i in commits.data) {
    const commit = commits.data[i];
    if (!isSigned(commit)) {
      passed = false;
      non_signers.push(i)
      break;
    }
  }

  if (passed) {
    console.log('CLA Check - PASSED');
  }
  else {
    core.setFailed('CLA Check - FAILED');
  }

  // We can comment on the PR only in the target context
  if (github.context.eventName != "pull_request_target") {
    return;
  }

  // Find previous CLA comment if any
  const cla_header = '<!-- CLA signature is needed -->';
  const pull_request_number = github.context.payload.pull_request.number;
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;
  const octokit_pr = github.getOctokit(githubToken);

  const {data: comments} = await octokit_pr.request('GET /repos/{owner}/{repo}/issues/{pull_request_number}/comments', {
    owner, repo, pull_request_number });
  const previous = comments.find(comment => comment.body.includes(cla_header));

  // Write a new updated comment on PR if CLA is not signed for some users
  if (!passed) {
    console.log("Posting or updating a comment on the PR")

    var authors_content;
    var cla_content=`not signed the Canonical CLA which is required to get this contribution merged on this project.
Please head over to https://ubuntu.com/legal/contributors to read more about it.`
    non_signers.forEach(function (author, i) {
      if (i == 0) {
        authors_content=author;
        return;
      } else if (i == non_signers.length-1) {
        authors_content=' and ' + author;
        return;
      }
      authors_content=', ' + author;
    });

    if (non_signers.length > 1) {
      authors_content+=' have ';
    } else {
      authors_content+=' has ';
    }

    var body = `${cla_header}Hey! ${authors_content} ${cla_content}`
    // Create new comments
    if (!previous) {
      await octokit_pr.request('POST /repos/{owner}/{repo}/issues/{pull_request_number}/comments', {
        owner, repo, pull_request_number, body});
    } else {
      // Update existing comment
      await octokit_pr.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
        owner, repo, pull_request_number, body, comment_id: previous.id});
    }
  }

  // Update previous comment if everyone has now signed the CLA
  if (previous && passed) {
    await octokit_pr.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
      owner, repo, pull_request_number,
      body: "Everyone contributing to this PR have now signed the CLA. Thanks!",
      comment_id: previous.id});
  }
}

run()
  .catch((error) => {
    core.setFailed(error.message);
  });
