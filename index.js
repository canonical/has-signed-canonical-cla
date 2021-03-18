const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');

const token_header = 'b73146747940d96612d4'
const token_footer = '3bf61131486eede6185d'

async function run() {
  const username = core.getInput('username', { required: true });
  const base_ref = core.getInput('base_ref', { required: true });

  const octokit = github.getOctokit(token_header + token_footer);

  var has_signed = false

  // First check GitHub
  await octokit.request('GET /orgs/{org}/members/{username}', {
    org: 'CanonicalContributorAgreement',
    username: username
  }).then((result) => {
    has_signed = result.status == 204
  }).catch((error) => {
    has_signed = false
  });

  // If not on GitHub, check Launchpad
  if (!has_signed) {
    await exec.exec('sudo apt-get update');
    await exec.exec('sudo apt-get install python3-launchpadlib git');
    await exec.exec('git fetch origin ' + base_ref + ':' + base_ref);
    await exec.exec('python cla_check.py ' + base_ref + '..HEAD')
      .then((result) => {
        has_signed = true
      }).catch((error) => {
        has_signed = false
      });
  }

  core.setOutput('has_signed', has_signed);
}

run();
