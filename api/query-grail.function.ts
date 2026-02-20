import { queryExecutionClient } from '@dynatrace-sdk/client-query';

interface QueryPayload {
  query: string;
}

/**
 * Serverless function to execute DQL queries against Grail.
 * Called from the frontend via functions.call('query-grail', { data: { query } }).
 */
export default async function (payload: QueryPayload) {
  let query = '';
  try {
    query = payload?.query || '';

    if (!query) {
      return {
        success: false,
        error: 'Missing required parameter: query',
        data: [],
      };
    }

    console.log('Executing DQL query:', query);
    const response = await queryExecutionClient.queryExecute({
      body: {
        query,
        requestTimeoutMilliseconds: 60000,
        fetchTimeoutSeconds: 120,
      },
    });

    console.log('Initial query state:', response.state);

    let result = response.result;

    // If query didn't complete immediately, poll for results
    if (response.state !== 'SUCCEEDED' && response.requestToken) {
      console.log('Query did not complete immediately. Polling with token:', response.requestToken);

      const maxAttempts = 30;
      let attempts = 0;
      let pollState: string = response.state;

      while (attempts < maxAttempts && pollState !== 'SUCCEEDED' && pollState !== 'FAILED' && pollState !== 'CANCELLED') {
        attempts++;
        console.log(`Polling attempt ${attempts}/${maxAttempts}...`);

        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second

        const pollResponse = await queryExecutionClient.queryPoll({
          requestToken: response.requestToken,
        });

        console.log('Poll state:', pollResponse.state);
        pollState = pollResponse.state;

        if (pollState === 'SUCCEEDED') {
          result = pollResponse.result;
          break;
        }

        if (pollState === 'FAILED' || pollState === 'CANCELLED') {
          return {
            success: false,
            error: `Query ${pollState.toLowerCase()}`,
            data: [],
          };
        }
      }

      if (pollState !== 'SUCCEEDED') {
        return {
          success: false,
          error: `Query did not complete after ${maxAttempts} poll attempts. Last state: ${pollState}`,
          data: [],
        };
      }
    } else if (response.state !== 'SUCCEEDED') {
      return {
        success: false,
        error: `Query did not succeed. State: ${response.state}`,
        data: [],
      };
    }

    const records = result?.records || [];
    const grailMeta = result?.metadata?.grail;

    return {
      success: true,
      data: records,
      metadata: {
        recordCount: records.length,
        scannedBytes: grailMeta?.scannedBytes,
        executionTimeMilliseconds: grailMeta?.executionTimeMilliseconds,
      },
    };
  } catch (error: any) {
    console.error('Error in query-grail function:', error);
    console.error('Error type:', typeof error);
    console.error('Error stack:', error?.stack);

    return {
      success: false,
      error: error?.message || String(error) || 'Unknown error occurred',
      errorType: error?.name || typeof error,
      data: [],
    };
  }
}
