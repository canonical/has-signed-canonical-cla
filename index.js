const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');

const token_header = 'b73146747940d96612d4'
const token_footer = '3bf61131486eede6185d'

async function run() {
  const username = github.context.payload['pull_request']['head']['user']['login']

  const octokit = github.getOctokit(token_header + token_footer);

  var has_signed = false

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

    await exec.exec('wget https://raw.githubusercontent.com/canonical/has-signed-canonical-cla/main/cla_check.py');
    await exec.exec('python cla_check.py repo ' + base_sha + '..' + head_sha)
      .then((result) => {
        has_signed = true
      }).catch((error) => {
        core.setFailed(error.message);
      });
  }

  if (!has_signed) {
    core.setFailed(username + ' has not signed the CLA');
  }
}

run();
