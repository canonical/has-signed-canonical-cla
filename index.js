const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');

const token_header = 'b73146747940d96612d4'
const token_footer = '3bf61131486eede6185d'

async function run() {
  const octokit = github.getOctokit(token_header + token_footer);

  var has_signed = false

  // First check GitHub
  const commits_url = github.context.payload['pull_request']['commits_url'];
  const commits = await octokit.request('GET ' + commits_url);

  for (const i in commits.data) {
    const username = commits.data[i]['author']['login'];

    await octokit.request('GET /orgs/{org}/members/{username}', {
      org: 'CanonicalContributorAgreement',
      username: username
    }).then((result) => {
      has_signed = result.status == 204
    }).catch((error) => {
      has_signed = false
    });

    if (!has_signed) {
      break;
    }
  }

  // If not on GitHub, check Launchpad
  if (!has_signed) {
    // Install dependencies
    await exec.exec('sudo apt-get update')
      .catch((error) => {
        core.setFailed(error.message);
      });
    await exec.exec('sudo apt-get install python3-launchpadlib git')
      .catch((error) => {
        core.setFailed(error.message);
      });

    // Check out the head branch
    const head_ref = github.context.payload['pull_request']['head']['ref']
    const head_url = github.context.payload['pull_request']['head']['repo']['clone_url']

    await exec.exec('git clone --single-branch --branch ' + head_ref + ' ' + head_url + ' repo')
      .catch((error) => {
        core.setFailed(error.message);
      });

    // Perform CLA check
    const commit_count = github.context.payload['pull_request']['commits'];

    await exec.exec('wget https://raw.githubusercontent.com/canonical/has-signed-canonical-cla/main/cla_check.py')
      .catch((error) => {
        core.setFailed(error.message);
      });
    await exec.exec('python cla_check.py repo HEAD~' + commit_count + '..HEAD')
      .catch((error) => {
        core.setFailed(error.message);
      });
  }
}

run();
