import { queryExecutionClient } from '@dynatrace-sdk/client-query';

interface QueryPayload {
  query: string;
}

/**
 * Serverless function to execute DQL queries against Grail.
 * Called from the frontend via functions.call('query-grail', { data: { query } }).
 */
export default async function (payload: QueryPayload) {
  const { query } = payload || {};

  if (!query) {
    return {
      success: false,
      error: 'Missing required parameter: query',
      data: [],
    };
  }

  try {
    const response = await queryExecutionClient.queryExecute({
      body: {
        query,
        requestTimeoutMilliseconds: 60000,
        fetchTimeoutSeconds: 120,
      },
    });

    // Handle async query (not finished within timeout)
    if (response.state !== 'SUCCEEDED') {
      return {
        success: false,
        error: `Query did not complete in time. State: ${response.state}`,
        data: [],
      };
    }

    const records = response.result?.records || [];
    const grailMeta = response.result?.metadata?.grail;

    return {
      success: true,
      data: records,
      metadata: {
        recordCount: records.length,
        scannedBytes: grailMeta?.scannedBytes,
        executionTimeMilliseconds: grailMeta?.executionTimeMilliseconds,
      },
    };
  } catch (error) {
    console.error('Error querying Grail:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      data: [],
    };
  }
}
