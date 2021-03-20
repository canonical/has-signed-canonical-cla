const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');

const token_header = 'b73146747940d96612d4'
const token_footer = '3bf61131486eede6185d'

async function run() {
  // Install dependencies
  await exec.exec('sudo apt-get update')
    .catch((error) => {
      core.setFailed(error.message);
    });
  await exec.exec('sudo apt-get install python3-launchpadlib')
    .catch((error) => {
      core.setFailed(error.message);
    });
  await exec.exec('wget https://raw.githubusercontent.com/canonical/has-signed-canonical-cla/main/lp_cla_check.py')
    .catch((error) => {
      core.setFailed(error.message);
    });

  // Get commit authors
  const octokit = github.getOctokit(token_header + token_footer);

  const commits_url = github.context.payload['pull_request']['commits_url'];
  const commits = await octokit.request('GET ' + commits_url);

  var commit_authors = []
  for (const i in commits.data) {
    const username = commits.data[i]['author']['login'];
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

    await octokit.request('GET /orgs/{org}/members/{username}', {
      org: 'CanonicalContributorAgreement',
      username: username
    }).then((result) => {
      if (result.status == 204) {
        console.log('- ' + email + ' ✓ (has signed the CLA)');
        commit_authors[i]['signed'] = true;
      }
      else {
        console.log('- ' + email + ' ✕ (was not found on GitHub)');
        commit_authors[i]['signed'] = false;
      }
    }).catch((error) => {
      console.log('- ' + email + ' ✕ (was not found on GitHub)');
      commit_authors[i]['signed'] = false
    });
  }

  console.log();

  // Check Launchpad
  console.log('Checking the following users on Launchpad:');
  for (const i in commit_authors) {
    if (commit_authors[i]['signed'] == false) {
      const email = commit_authors[i]['email'];

      await exec.exec('python', ['lp_cla_check.py', email], options = {
        silent: true,
        listeners: {
          stdout: (data) => {
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
  for (const i in commit_authors) {
    if (commit_authors[i]['signed'] == false) {
      passed = false;
      break;
    }
  }

  if (!passed) {
    core.setFailed('CLA Check - FAILED');
  }
  else {
    console.log('CLA Check - PASSED');
  }
}

run();
