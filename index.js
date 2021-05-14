const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const path = require('path');

const token_header = 'b73146747940d96612d4'
const token_footer = '3bf61131486eede6185d'
const githubToken = core.getInput('GITHUB_TOKEN', {required: true})

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

  var commit_authors = []
  for (const i in commits.data) {
    var username;
    if (commits.data[i]['author']) {
      username = commits.data[i]['author']['login'];
    }
    const email = commits.data[i]['commit']['author']['email'];
    commit_authors[username] = {
      'username': username,
      'email': email,
      'signed': false
    };
  }

  // Check GitHub
  console.log('Checking the following users on GitHub:');
  for (const i in commit_authors) {
    const username = commit_authors[i]['username'];
    const email = commit_authors[i]['email'];

    if (!username) {
      continue;
    }
    if (username == 'dependabot[bot]') {
      console.log('- ' + username + ' ✓ (GitHub Dependabot)');
      commit_authors[i]['signed'] = true;
      continue
    }
    if (email.endsWith('@canonical.com')) {
      console.log('- ' + username + ' ✓ (@canonical.com account)');
      commit_authors[i]['signed'] = true;
      continue
    }
    if (email.endsWith('@mozilla.com')) {
      console.log('- ' + username + ' ✓ (@mozilla.com account)');
      commit_authors[i]['signed'] = true;
      continue
    }
    if (accept_existing_contributors && contributors_list.includes(username)) {
      console.log('- ' + username + ' ✓ (already a contributor)');
      commit_authors[i]['signed'] = true;
      continue
    }

    await octokit.request('GET /orgs/{org}/members/{username}', {
      org: 'CanonicalContributorAgreement',
      username: username
    }).then((result) => {
      if (result.status == 204) {
        console.log('- ' + username + ' ✓ (has signed the CLA)');
        commit_authors[i]['signed'] = true;
      }
      else {
        console.log('- ' + username + ' ✕ (has not signed the CLA)');
        commit_authors[i]['signed'] = false;
      }
    }).catch((error) => {
      console.log('- ' + username + ' ✕ (has not signed the CLA)');
      commit_authors[i]['signed'] = false
    });
  }

  console.log();

  // Check Launchpad
  console.log('Checking the following users on Launchpad:');
  for (const i in commit_authors) {
    if (commit_authors[i]['signed'] == false) {
      const email = commit_authors[i]['email'];

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
          commit_authors[i]['signed'] = true;
        }).catch((error) => {
          commit_authors[i]['signed'] = false;
        });
    }
  }

  console.log();

  // Determine Result
  passed = true
  var none_signers = []
  for (const i in commit_authors) {
    if (commit_authors[i]['signed'] == false) {
      passed = false;
      none_signers.push(i)
      break;
    }
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
    var authors_content;
    var cla_content=`not signed Canonical CLA which is required to get the contribution merged on this project.
Please head over to https://ubuntu.com/legal/contributors to read more about it.`
    none_signers.forEach(function (author, i) {
      if (i == 0) {
        authors_content=author;
        return;
      } else if (i == none_signers.length-1) {
        authors_content=' and ' + author;
        return;
      }
      authors_content=', ' + author;
    });

    if (none_signers.length > 1) {
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

  if (passed) {
    console.log('CLA Check - PASSED');
  }
  else {
    core.setFailed('CLA Check - FAILED');
  }
}

run()
  .catch((error) => {
    core.setFailed(error.message);
  });
