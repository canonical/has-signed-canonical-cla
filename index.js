const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const githubToken = process.env.GITHUB_TOKEN;

// the map provides the list of repos that have implicit approvals from
// the license header in commit message and related license map
const licenseMap = {
    'canonical/lxd': [
        'Apache-2.0'
    ],
    'canonical/lxd-ci': [
        'Apache-2.0'
    ],
    'canonical/lxd-imagebuilder': [
        'Apache-2.0'
    ],
}


/**
 * Returns the license from `licenseMap` that grants implicit CLA if found in the commit message.
 */
function hasImplicitLicense(commit_message, repoName) {
  const lines = commit_message.split('\n');

  // Skip the commit subject (first line)
  for (var i = 1; i < lines.length; i++) {
      // Remove any trailing `\r` char
      const line = lines[i].replace(/\r$/,'');
      // Accept both American and British spellings (`License` and `Licence`)
      const license = line.match(/^Licen[cs]e: ?(.+)$/);
      if (license && licenseMap[repoName].includes(license[1])) {
          return license[1];
      }
  }
  return '';
}

async function run() {
  const ghRepo = github.getOctokit(githubToken);

  const commits_url = github.context.payload.pull_request.commits_url;
  const commits = await ghRepo.request('GET ' + commits_url);

  const repoFullName = github.context.payload.repository.full_name;
  const repoInLicenseMap = repoFullName in licenseMap;
  var commit_authors = []
  for (const i in commits.data) {
    // Check if the commit message contains a license header that matches
    // one of the licenses granting implicit CLA approval
    if (commits.data[i]['commit']['message']) {
      if (repoInLicenseMap) {
        const goodLicense = hasImplicitLicense(commits.data[i]['commit']['message'], repoFullName);
        if (goodLicense) {
          console.log('- commit ' + commits.data[i]['sha'] + ' ✓ (' + goodLicense + ' license)');
          continue;
        }
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
    if (username.endsWith('[bot]')) {
      console.log('- ' + username + ' ✓ (Bot exempted from CLA)');
      commit_authors[i]['signed'] = true;
      continue
    }
    if (email.endsWith('@canonical.com')) {
      console.log('- ' + username + ' ✓ (@canonical.com account)');
      commit_authors[i]['signed'] = true;
      continue
    }

    try {
      console.log('Check in the signed list service');
      const response = await axios.get(
        'https://cla-checker.canonical.com/check_user/' + username
      );
      if (response.status === 200) {
        console.log('- ' + username + ' ✓ (has signed the CLA)');
        commit_authors[i]['signed'] = true;
      }
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log('- ' + username + ' ✕ (has not signed the CLA)');
      } else {
        console.error('Error occurred while checking user:', error.message);
      }
    }
  }

  // Determine Result
  passed = true
  for (const i in commit_authors) {
    if (commit_authors[i]['signed'] == false) {
      passed = false;
      break;
    }
  }

  if (passed) {
    console.log('CLA Check - PASSED');
  }
  else {
    console.log(
      'Some commit authors have not signed the Canonical CLA which is ' +
      'required to get this contribution merged on this project.\n' +
      'Please head over to https://ubuntu.com/legal/contributors to read more about it.'
    );
    core.setFailed('CLA Check - FAILED');
  }
}

run()
  .catch((error) => {
    core.setFailed(error.message);
  });
