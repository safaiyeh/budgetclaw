import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';
import type { Database } from '../db/index.js';
import { setCredential } from '../credentials/keychain.js';

function getPlaidClient(): PlaidApi {
  const clientId = process.env['PLAID_CLIENT_ID'];
  const secret = process.env['PLAID_SECRET'];
  const envName = (process.env['PLAID_ENV'] ?? 'sandbox') as keyof typeof PlaidEnvironments;

  if (!clientId) {
    throw new Error(
      'Missing env var: PLAID_CLIENT_ID\n' +
      'Get your credentials at https://dashboard.plaid.com',
    );
  }
  if (!secret) {
    throw new Error(
      'Missing env var: PLAID_SECRET\n' +
      'Get your credentials at https://dashboard.plaid.com',
    );
  }

  const baseURL = PlaidEnvironments[envName];
  if (!baseURL) {
    throw new Error(
      `Invalid PLAID_ENV "${envName}". Valid values: ${Object.keys(PlaidEnvironments).join(', ')}`,
    );
  }

  const config = new Configuration({
    basePath: baseURL,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });

  return new PlaidApi(config);
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;

  if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      console.error(`Could not open browser automatically. Please open: ${url}`);
    }
  });
}

function buildLinkHtml(linkToken: string, isCallback: boolean): string {
  const receivedRedirectUri = isCallback
    ? `receivedRedirectUri: window.location.href,`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BudgetClaw — Connect Bank Account</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; justify-content: center;
           align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; border-radius: 12px; padding: 40px; text-align: center;
            box-shadow: 0 2px 16px rgba(0,0,0,0.1); max-width: 400px; }
    h2 { margin: 0 0 8px; color: #1a1a1a; }
    p { color: #666; margin: 0 0 24px; }
    .status { color: #888; font-size: 14px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>BudgetClaw</h2>
    <p>Connecting your bank account via Plaid...</p>
    <div class="status" id="status">Opening Plaid Link...</div>
  </div>
  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <script>
    const handler = Plaid.create({
      token: ${JSON.stringify(linkToken)},
      ${receivedRedirectUri}
      onSuccess: function(publicToken, metadata) {
        document.getElementById('status').textContent = 'Exchanging token...';
        fetch('/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token: publicToken }),
        }).then(function() {
          document.getElementById('status').textContent =
            'Success! You can close this window and return to the terminal.';
        }).catch(function(err) {
          document.getElementById('status').textContent = 'Error: ' + err.message;
        });
      },
      onExit: function(err, metadata) {
        if (err) {
          document.getElementById('status').textContent = 'Error: ' + (err.display_message || err.error_message || 'Unknown error');
        } else {
          document.getElementById('status').textContent = 'Cancelled. You can close this window.';
        }
      },
    });
    handler.open();
  </script>
</body>
</html>`;
}

export interface LinkPlaidInput {
  institution_name?: string;
}

export interface LinkPlaidResult {
  connection_id: string;
  institution_name: string;
  accounts_found: number;
}

export async function linkPlaid(db: Database, input: LinkPlaidInput): Promise<LinkPlaidResult> {
  const client = getPlaidClient();
  const port = parseInt(process.env['PLAID_LINK_PORT'] ?? '8181', 10);
  const redirectUri = `http://localhost:${port}/callback`;

  // 1. Create link token
  const linkTokenResponse = await client.linkTokenCreate({
    user: { client_user_id: 'budgetclaw-user' },
    client_name: 'BudgetClaw',
    products: [Products.Transactions, Products.Investments],
    country_codes: [CountryCode.Us],
    language: 'en',
    redirect_uri: redirectUri,
  });

  const linkToken = linkTokenResponse.data.link_token;

  // 2. Start local HTTP server and wait for public_token
  const publicToken = await new Promise<string>((resolve, reject) => {
    const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Plaid Link timed out after 10 minutes. Run budgetclaw_plaid_link again.'));
    }, TIMEOUT_MS);

    const server = createServer((req, res) => {
      const url = req.url ?? '/';

      // Serve the Plaid Link page
      if (req.method === 'GET' && (url === '/' || url.startsWith('/callback'))) {
        const isCallback = url.startsWith('/callback');
        const html = buildLinkHtml(linkToken, isCallback);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }

      // Receive public_token from onSuccess
      if (req.method === 'POST' && url === '/exchange') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const { public_token } = JSON.parse(body) as { public_token: string };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            clearTimeout(timeout);
            server.close();
            resolve(public_token);
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid request body' }));
            clearTimeout(timeout);
            server.close();
            reject(e);
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}/`;
      console.log(`\nOpening Plaid Link at ${url}`);
      console.log('Sign in to your bank, then return to this terminal.\n');
      openBrowser(url);
    });

    server.on('error', (e) => {
      clearTimeout(timeout);
      reject(new Error(`Could not start local server on port ${port}: ${(e as NodeJS.ErrnoException).message}`));
    });
  });

  // 3. Exchange public token for access token
  const exchangeResponse = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });

  const accessToken = exchangeResponse.data.access_token;
  const itemId = exchangeResponse.data.item_id;

  // 4. Fetch accounts to get institution info
  const accountsResponse = await client.accountsGet({ access_token: accessToken });
  const institutionId = accountsResponse.data.item.institution_id ?? null;
  const institutionName =
    input.institution_name ??
    (institutionId ? institutionId : 'Unknown Institution');

  // Try to get the institution name from Plaid if we have an institution_id
  let resolvedInstitutionName = institutionName;
  if (institutionId) {
    try {
      const instResponse = await client.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      resolvedInstitutionName = instResponse.data.institution.name;
    } catch {
      // Non-fatal — use what we have
    }
  }

  const accountCount = accountsResponse.data.accounts.length;

  // 5. Store access token in OS keychain
  const connectionId = crypto.randomUUID();
  const keychainKey = `plaid-${connectionId}`;
  await setCredential(keychainKey, accessToken);

  // 6. Insert provider_connections row
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO provider_connections
      (id, provider, institution_id, institution_name, item_id, keychain_key, cursor, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(connectionId, 'plaid', institutionId, resolvedInstitutionName, itemId, keychainKey, now, now);

  return {
    connection_id: connectionId,
    institution_name: resolvedInstitutionName,
    accounts_found: accountCount,
  };
}
