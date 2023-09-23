import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import GithubMetrics from './types/GithubMetrics';
import Storage from './utils/Storage';
import { getGHUserMetrics } from './utils/GithubCommands';
import Logger from './utils/Logger';

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        Logger.appendDebugLog('Lambda invoked');

        try {
            await Storage.load();
        } catch (error) {
            throw new Error('Could not initialize gh-metrics-store connection.');
        }

        const GH_API_KEY_1: string = process.env.GH_API_KEY_1 as string;
        const GH_USERNAME_1: string = process.env.GH_USERNAME_1 as string;
        const GH_API_KEY_2: string = process.env.GH_API_KEY_2 as string;
        const GH_USERNAME_2: string = process.env.GH_USERNAME_2 as string;

        const job1Results: GithubMetrics = await getGHUserMetrics(GH_USERNAME_1, GH_API_KEY_1);
        const job2Results: GithubMetrics = await getGHUserMetrics(GH_USERNAME_2, GH_API_KEY_2);

        const aggregateMetrics: GithubMetrics = {
            commits: job1Results.commits + job2Results.commits,
            mergedPRs: job1Results.mergedPRs + job2Results.mergedPRs,
            linesOfCodeWritten: job1Results.linesOfCodeWritten + job2Results.linesOfCodeWritten,
            repositoriesContributed: job1Results.repositoriesContributed + job2Results.repositoriesContributed,
        };

        Storage.store('metrics', aggregateMetrics);

        try {
            await Storage.synchronize();
        } catch (error) {
            throw new Error(`Unable to synchronize values to gh-metrics-store. Error: ${error}`);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: aggregateMetrics,
            }),
        };
    } catch (err: any) {
        Logger.appendError(err);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: `An error has occured: ${err}`,
            }),
        };
    }
};
