const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const path = require('path');

const githubToken = core.getInput('github-token', {required: true})
const exemptedBots = core.getInput('exempted-bots', {required: true}).split(',').map(input => input.trim());
const implicitLicenses = core.getInput('implicit-approval-from-licenses', {required: true}).split(',').map(input => input.trim());

// Returns the license that grants implicit CLA if found in the commit message.
// Otherwise, returns an empty string.
function hasImplicitLicense(commit_message) {
  const lines = commit_message.split('\n');

  // Skip the commit subject (first line)
  for (var i = 1; i < lines.length; i++) {
      // Remove any trailing `\r` char
      const line = lines[i].replace(/\r$/,'');
      const license = line.match(/^License: ?(.+)$/);
      if (license && implicitLicenses.includes(license[1])) {
          return license[1];
      }
  }
  return '';
}

async function run() {
  // Install dependencies
  core.startGroup('Installing python3-launchpadlib')
  await exec.exec('sudo apt-get update');
  await exec.exec('sudo apt-get install python3-launchpadlib');
  core.endGroup()

  console.log();

  // Get existing contributors
  const ghRepo = github.getOctokit(githubToken);
  const accept_existing_contributors = (core.getInput('accept-existing-contributors') == "true");

  if (accept_existing_contributors) {
    const contributors_url = github.context.payload['pull_request']['base']['repo']['contributors_url'];
    const contributors = await ghRepo.request('GET ' + contributors_url);

    var contributors_list = []
    for (const i in contributors.data) {
      contributors_list.push(contributors.data[i]['login']);
    }
  }

  // Get commit authors
  const commits_url = github.context.payload['pull_request']['commits_url'];
  const commits = await ghRepo.request('GET ' + commits_url);

  var commit_authors = []
  for (const i in commits.data) {
    // Check if the commit message contains a license header that matches
    // one of the licenses granting implicit CLA approval
    if (commits.data[i]['commit']['message']) {
      const goodLicense = hasImplicitLicense(commits.data[i]['commit']['message']);
      if (goodLicense) {
        console.log('- commit ' + commits.data[i]['sha'] + ' ✓ (' + goodLicense + ' license)');
        continue;
      }
    }

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
    if (username.endsWith('[bot]') && exemptedBots.includes(username.slice(0, -5))) {
      console.log('- ' + username + ' ✓ (Bot exempted from CLA)');
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
    if (email.endsWith('@ocadogroup.com') || email.endsWith('@ocado.com')) {
      console.log('- ' + username + ' ✓ (@ocado{,group}.com account)');
      commit_authors[i]['signed'] = true;
      continue
    }
    if (accept_existing_contributors && contributors_list.includes(username)) {
      console.log('- ' + username + ' ✓ (already a contributor)');
      commit_authors[i]['signed'] = true;
      continue
    }

    const axios = require('axios');
    // remove agent when nginx will be fixed and will provide CA certs
    const agent = new https.Agent({
      rejectUnauthorized: false // Ignore certificate verification
    });

    try {
      console.log('Check in the signed list service');
      const response = await axios.get(
        'https://cla-checker.canonical.com/check_user/' + username,
        { httpsAgent: agent }
      );
      if (response.status === 200) {
        console.log('- ' + username + ' ✓ (has signed the CLA)');
        commit_authors[i]['signed'] = true;
      } else {
        console.log('- ' + username + ' ✕ (has not signed the CLA)');
      }
    } catch (error) {
      console.error('Error occurred while checking user:', error.message);
    }
  }

  console.log();

  // Check Launchpad
  for (const i in commit_authors) {
    if (commit_authors[i]['signed'] == false) {
      console.log('Checking the following user on Launchpad:');
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
  var non_signers = []
  for (const i in commit_authors) {
    if (commit_authors[i]['signed'] == false) {
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

  const {data: comments} = await ghRepo.request('GET /repos/{owner}/{repo}/issues/{pull_request_number}/comments', {
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
