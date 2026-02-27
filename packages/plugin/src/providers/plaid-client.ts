import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

export function getPlaidClient(): PlaidApi {
  const clientId = process.env['PLAID_CLIENT_ID'];
  const secret = process.env['PLAID_SECRET'];

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

  const config = new Configuration({
    basePath: PlaidEnvironments['production'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });

  return new PlaidApi(config);
}
