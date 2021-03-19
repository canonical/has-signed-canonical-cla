const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');

const token_header = 'b73146747940d96612d4'
const token_footer = '3bf61131486eede6185d'

async function run() {
  const username = core.getInput('username', { required: true });

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
    // Install dependencies
    await exec.exec('sudo apt-get update');
    await exec.exec('sudo apt-get install python3-launchpadlib git');

    // Check out the head branch
    const head_ref = github.context.payload['pull_request']['head']['ref']
    const head_url = github.context.payload['pull_request']['head']['repo']['clone_url']

    await exec.exec('git clone --single-branch --branch ' + head_ref + ' ' + head_url + ' repo');
    await exec.exec('git -C repo config user.email "test@test.com"');
    await exec.exec('git -C repo config user.name "Test"');

    // Rebase on the base branch
    const base_ref = github.context.payload['pull_request']['base']['ref']
    const base_url = github.context.payload['pull_request']['base']['repo']['clone_url']

    await exec.exec('git -C repo remote add base ' + base_url);
    await exec.exec('git -C repo pull -r base ' + base_ref);

    // Perform CLA check
    const base_sha = github.context.payload['pull_request']['base']['sha']
    const head_sha = github.context.payload['pull_request']['head']['sha']

    await exec.exec('python ./repo/cla_check.py ' + base_sha + '..' + head_sha)
      .then((result) => {
        has_signed = true
      }).catch((error) => {
        has_signed = false
      });
  }

  core.setOutput('has_signed', has_signed);
}

run();
