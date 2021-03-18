const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');

async function run() {
  const username = core.getInput('username', { required: true });
  const token = core.getInput('token', { required: true });
  const base_ref = core.getInput('base_ref', { required: true });

  const octokit = github.getOctokit(token);

  const { data: orgs } = await octokit.orgs.listForUser({ username, per_page: 100 });

  await octokit.request('GET /orgs/{org}/members/{username}', {
    org: 'CanonicalContributorAgreement',
    username: username
  }).then((result) => {
    core.setOutput('has_signed', result.status == 204);
  }).catch((error) => {
    core.setOutput('has_signed', false);
  });

  await exec.exec('python cla_check.py ' + base_ref + '..HEAD');
}

run();
