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

    var display_name = username;
    if (!username) {
      display_name = email;
    }

    // Checks that only require the email address to match/be accepted

    // Note we specifically support allowing commits where the email addresses 
    // are allowed, but there is not an associated GiHub account/username for 
    // the allowed email. This is to enable a Canonical/Mozilla/Ocado/etc.
    // employee to submit a PR with commits that have an allowed email, but 
    // submitted the PR with a GiHub account that is not also configured to be
    // associated with that email - we still allow the commit since the email
    // for the git commit is the source of truth and not the GiHub username.
    if (email.endsWith('@canonical.com')) {
      console.log('- ' + display_name + ' ✓ (@canonical.com account)');
      commit_authors[i]['signed'] = true;
      continue
    }
    if (email.endsWith('@mozilla.com')) {
      console.log('- ' + display_name + ' ✓ (@mozilla.com account)');
      commit_authors[i]['signed'] = true;
      continue
    }
    if (email.endsWith('@ocadogroup.com') || email.endsWith('@ocado.com')) {
      console.log('- ' + display_name + ' ✓ (@ocado{,group}.com account)');
      commit_authors[i]['signed'] = true;
      continue
    }
    if (accept_existing_contributors && contributors_list.includes(username)) {
      console.log('- ' + display_name + ' ✓ (already a contributor)');
      commit_authors[i]['signed'] = true;
      continue
    }

    // Checks that require the commit to be associated with a GiHub username
    if (!username) {
      continue;
    }

    if (username == 'dependabot[bot]') {
      console.log('- ' + display_name + ' ✓ (GitHub Dependabot)');
      commit_authors[i]['signed'] = true;
      continue
    }

    await octokit.request('GET /orgs/{org}/members/{username}', {
      org: 'CanonicalContributorAgreement',
      username: username
    }).then((result) => {
      if (result.status == 204) {
        console.log('- ' + display_name + ' ✓ (has signed the CLA)');
        commit_authors[i]['signed'] = true;
      }
      else {
        console.log('- ' + display_name + ' ✕ (has not signed the CLA)');
        commit_authors[i]['signed'] = false;
      }
    }).catch((error) => {
      console.log('- ' + display_name + ' ✕ (issue checking CLA status [' + error + '])');
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
