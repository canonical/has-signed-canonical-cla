const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const githubToken = core.getInput('github-token', {required: true})

/**
 * A mapping of repositories to their respective licenses.
 * The keys are the full name of the repository (<org>/<repo name>).
 * The values are an array of licenses that are considered to grant implicit CLA approval.
 *  
 * @constant {Object.<string, string[]>} licenseMap
 */
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
 * Checks if the commit message contains a license declaration based on `licenseMap`.
 *
 * @param {string} commit_message - The commit message to check.
 * @param {string} repoName - The full name of the repository (<org>/<repo name>) to validate against `licenseMap`.
 * @returns {string} - The license found in the commit message, or an empty string if none is found.
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


/**
 * Processes a list of commit authors to determine which don't require CLA service validation.
 * The following authors are exempt from CLA validation:
 * - Bot accounts (username ends with '[bot]')
 * - Canonical employees (email ends with '@canonical.com')
 * 
 * All other authors require CLA validation.
 * 
 * @param {Object} commitAuthors - An object where keys are author emails and values are author details.
 */
function processCLAExceptions(commitAuthors) {
  for (const email in commitAuthors) {
    const author = commitAuthors[email];
    const username = author.username;

    if (!username) {
      continue;
    }
    if (username.endsWith('[bot]')) {
      console.log(`- ${username} ✓ (Bot exempted from CLA)`);
      author.signed = true;
      continue;
    }
    if (email.endsWith('@canonical.com')) {
      console.log(`- ${username} ✓ (@canonical.com account)`);
      author.signed = true;
      continue;
    }
  }
}

/**
 * Validates and prints the CLA status of commit authors.
 * If all authors have signed the CLA, the function will print a success message.
 * If any authors have not signed the CLA, the function will print a failure message and fail the action.
 *
 * @param {Object} commitAuthors - An object where keys are author emails and values are author details.
 * @param {Object} claStatus - The CLA status response from the CLA service.
 * @returns {boolean} - Returns `true` if all authors have signed the CLA, otherwise `false`.
 */
function reportCLAStatus(commitAuthors, claStatus) {
  let passed = true;
  for (const email in commitAuthors) {
    const author = commitAuthors[email];
    const username = author.username;

    if (!author.signed) {
      if (claStatus.emails[email] || claStatus.github_usernames[username]) {
        console.log(`- ${username} ✓ (CLA signed)`);
        author.signed = true;
      } else {
        console.log(`- ${username} (${email}) ✗ (CLA not signed)`);
        passed = false;
      }
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

/**
 * Checks the Canonical CLA service for the given commit authors.
 *
 * @param {Object} commitAuthors - An object where the keys are email addresses and the values are author objects.
 * @returns {Promise<Object|null>} The response data from the CLA service if successful, otherwise null.
 * @throws Will log an error message and set the GitHub action to failed if an error occurs.
 */
async function checkCLAService(commitAuthors) {
  try {
    console.log('Check in the CLA service');
    const emails = [];
    const githubUsernames = [];

    for (const email in commitAuthors) {
      const author = commitAuthors[email];
      if (!author.signed) {
        emails.push(email);
        githubUsernames.push(author.username);
      }
    }

    // Note, the CLA service also implicitly validates emails against corporate CLA. 
    // If a corporate has signed the CLA with domain `@example.com`, 
    // then all emails with that domain are considered signed.
    const response = await axios.get(
      `https://cla.canonical.com/cla/check?emails=${encodeURIComponent(emails.join(','))}` +
      `&github_usernames=${encodeURIComponent(githubUsernames.join(','))}`
    );
    return response.data;
  } catch (error) {
    console.error('Error occurred while checking CLA service:', error.message);
    core.setFailed('CLA Check - FAILED');
    return null;
  }
}

/**
 * Runs the main process to check if all commit authors have signed the CLA.
 * 
 * This function performs the following steps:
 * 1. Retrieves the list of commits from the pull request.
 * 2. Checks if each commit message contains a license header that grants implicit CLA approval.
 * 3. Collects the email addresses and usernames of commit authors.
 * 4. Processes CLA exceptions for commit authors e.g. bots and Canonical employees.
 * 5. Checks the CLA status of commit authors using CLA web service.
 * 6. Reports the CLA status for each commit author.
 * 
 * @async
 * @function run
 * @returns {Promise<void>} Resolves when the process is complete.
 */
async function run() {
  const ghRepo = github.getOctokit(githubToken);

  const {owner, repo} = github.context.repo;
  const payload = github.context.payload;

  // Determine PRs to examine. Support:
  //  - pull_request event (payload.pull_request)
  //  - merge_group (payload.merge_group.head_sha) -> map commit -> PRs
  //  - check_suite (payload.check_suite.pull_requests)
  let prs = [];

  if (payload && payload.pull_request) {
    prs = [payload.pull_request];
  } else if (payload && payload.merge_group && payload.merge_group.head_sha) {
    const headSha = payload.merge_group.head_sha;
    console.log(
        `merge_group event detected, attempting to discover PRs for commit ${
            headSha}`);
    const resp = await ghRepo.rest.repos.listPullRequestsAssociatedWithCommit(
        {owner, repo, commit_sha: headSha});
    prs = resp && resp.data ? resp.data : [];
  } else if (
      payload && payload.check_suite &&
      Array.isArray(payload.check_suite.pull_requests) &&
      payload.check_suite.pull_requests.length > 0) {
    prs = payload.check_suite.pull_requests;
  }

  if (!prs || prs.length === 0) {
    core.setFailed(
        'No pull request information could be discovered in the event payload.');
    return;
  }

  const repoFullName = payload && payload.repository ?
      payload.repository.full_name :
      `${owner}/${repo}`;
  const repoInLicenseMap = repoFullName in licenseMap;
  var commitAuthors = {};
  var nCommits = 0;

  // For every PR discovered, list its commits and collect authors.
  for (const pr of prs) {
    const prNumber = pr.number || (pr.pull_request && pr.pull_request.number);
    if (!prNumber) {
      console.log('Skipping an entry without a pull request number');
      continue;
    }

    console.log(`Collecting commits for PR #${prNumber}`);
    const commits = await ghRepo.paginate(
        ghRepo.rest.pulls.listCommits,
        {owner, repo, pull_number: prNumber, per_page: 100});

    nCommits += commits.length;

    for (const commitObj of commits) {
      // Check if the commit message contains a license header that matches
      // one of the licenses granting implicit CLA approval
      if (commitObj && commitObj.commit && commitObj.commit.message &&
          repoInLicenseMap) {
        const goodLicense =
            hasImplicitLicense(commitObj.commit.message, repoFullName);
        if (goodLicense) {
          console.log(`- commit ${commitObj.sha} ✓ (${goodLicense} license)`);
          continue;
        }
      }

      const email = commitObj && commitObj.commit && commitObj.commit.author &&
          commitObj.commit.author.email;
      if (!email) {
        core.setFailed(`Commit ${commitObj.sha} has no author email.`);
        return;
      }

      const username = (commitObj.author && commitObj.author.login) ?
          commitObj.author.login :
          null;
      commitAuthors[email] =
          commitAuthors[email] || {username: username, signed: false};
    }
  }

  console.log(`Discovered ${nCommits} commits.`);

  processCLAExceptions(commitAuthors);
  const claStatus = await checkCLAService(commitAuthors);
  if (claStatus === null) {
    return;
  }

  reportCLAStatus(commitAuthors, claStatus);
}

run()
  .catch((error) => {
    core.setFailed(error.message);
  });
