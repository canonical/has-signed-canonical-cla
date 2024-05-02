const API_ENDPOINT = 'https://api.launchpad.net/devel';
const MEMBERSHIP_QUERY_LINK = `${API_ENDPOINT}/~contributor-agreement-canonical/+member`;

export async function lp_email_check(email: string): Promise<boolean> {
    const url = new URL(`${API_ENDPOINT}/people?ws.op=getByEmail`);
    url.searchParams.append('email', email);
    const lp_account = await fetch(url);
    if (!lp_account.ok) {
        console.log(`- ${email} ✕ (has no Launchpad account)`);
        return false;
    }
    const json = (await lp_account.json()) as { name: string };
    const membership_query_url = new URL(`${MEMBERSHIP_QUERY_LINK}/${encodeURIComponent(json.name)}`);
    console.log(membership_query_url);
    const membership_query = await fetch(membership_query_url);
    if (membership_query.ok) {
        console.log(`- ${email} ✓ (has signed the CLA)`);
        return true;
    }
    console.log(`- ${email} ✕ (has not signed the CLA)`);
    return false;
}
