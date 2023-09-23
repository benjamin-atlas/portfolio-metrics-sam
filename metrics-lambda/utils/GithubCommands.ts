import axios, { AxiosHeaders, AxiosResponse } from 'axios';
import GithubMetrics from '../types/GithubMetrics';
import Logger from './Logger';
import Storage from './Storage';

const getGHUserMetrics = async (username: string, token: string): Promise<GithubMetrics> => {
    const headers: any = {
        Authorization: `Bearer ${token}`,
    };

    const metrics: GithubMetrics = new GithubMetrics();

    try {
        Logger.appendDebugLog(`Fetching user [${username}] repos.`);
        const userRepositoriesResponse = await axios.get(`https://api.github.com/user/repos?per_page=100`, {
            headers,
        });

        const userRepositories = userRepositoriesResponse.data;

        [metrics.commits, metrics.mergedPRs, metrics.linesOfCodeWritten, metrics.repositoriesContributed] =
            await Promise.all([
                getCommitsForUser(username, userRepositories, headers),
                getPRsMergedForUser(username, userRepositories, headers),
                getLinesOfCodeWrittenForUser(username, userRepositories, headers),
                getRepositoriesContributedForUser(userRepositories),
            ]);
    } catch (error) {
        Logger.appendError(`Error getting github metrics: ${error}`);
    }

    return metrics;
};

async function getCommitsForUser(username: string, repositories: any[], headers: AxiosHeaders): Promise<number> {
    let totalCommits: number = 0;

    for (const repo of repositories) {
        let commitsResponse: AxiosResponse<any, any>;
        let numberOfCommitsOnPage: number = 0;
        let pageNumber: number = 0;

        try {
            let lastQueriedPageNumber: number = await Storage.get(`${username}_${repo.name}_last_commit_page`);
            if (lastQueriedPageNumber) {
                pageNumber = lastQueriedPageNumber - 1; // Subtract 1 to requery that page again as the amount may have changed.
            }
        } catch (error) {
            Logger.appendError(
                `Unable to retrieve last queried commit page for user [${username}], repo [${repo.name}]: ${error}`,
            );
        }

        do {
            try {
                pageNumber++;
                numberOfCommitsOnPage = 0;

                Logger.appendDebugLog(`Fetching commits for repo [${repo.name}], page [${pageNumber}].`);

                commitsResponse = await axios.get(
                    `${repo.url}/commits?author=${username}&per_page=100&page=${pageNumber}`,
                    {
                        headers,
                    },
                );
                numberOfCommitsOnPage = commitsResponse.data.length;
            } catch (error) {
                // TODO: I don't love how this behaves on error with the page number logic (what if it errors over and over?), but don't have the time to fix it right now.
                Logger.appendError(
                    `Error getting commit count for page [${repo.url}/commits?author=${username}&per_page=100&page=${pageNumber}]:  ${error}`,
                );
            }
        } while (numberOfCommitsOnPage === 100);

        const commitCount = 100 * (pageNumber - 1) + numberOfCommitsOnPage;
        totalCommits += commitCount;

        try {
            Storage.store(`${username}_${repo.name}_last_commit_page`, pageNumber);
        } catch (error) {
            Logger.appendError(
                `Error storing last queried commit page for user [${username}], repo [${repo.name}]:  ${error}`,
            );
        }
    }

    return totalCommits;
}

async function getPRsMergedForUser(username: string, repositories: any[], headers: AxiosHeaders): Promise<number> {
    let totalPrs: number = 0;

    for (const repo of repositories) {
        let pullsResponse: AxiosResponse<any, any> | null = null;
        let numberOfRelevantPRsOnPage: number = 0;
        let pageNumber: number = 0;
        let prsPerRepo: number = 0;

        try {
            const lastPrPage: number = await Storage.get(`${username}_${repo.name}_last_pr_page`);
            const lastPrCount: number = await Storage.get(`${username}_${repo.name}_last_pr_count`);
            const lastPrPageCount: number = await Storage.get(`${username}_${repo.name}_last_pr_page_count`);

            if (lastPrPage && lastPrCount && lastPrCount) {
                pageNumber = lastPrPage - 1; // Subtract 1 to requery that page again as the amount may have changed.
                prsPerRepo = lastPrCount - lastPrPageCount; // subtract the amount of the last queried page.
            }
        } catch (error) {
            Logger.appendError(
                `Unable to retrieve last queried pr info for user [${username}], repo [${repo.name}] ${error}`,
            );
        }

        do {
            try {
                pageNumber++;
                numberOfRelevantPRsOnPage = 0;

                Logger.appendDebugLog(`Fetching pulls for repo [${repo.name}], page [${pageNumber}].`);

                pullsResponse = await axios.get(
                    `${repo.url}/pulls?author=${username}&state=all&per_page=100&page=${pageNumber}`,
                    {
                        headers,
                    },
                );
                numberOfRelevantPRsOnPage = pullsResponse?.data.reduce(
                    (numPrs: number, pr: any) =>
                        pr.user.login === username ||
                        pr.assignees.some((assignee: any) => assignee.login === username) ||
                        pr.requested_reviewers.some((reviewer: any) => reviewer.login === username)
                            ? numPrs + 1
                            : numPrs,
                    0,
                );

                prsPerRepo += numberOfRelevantPRsOnPage;
            } catch (error) {
                // TODO: I don't love how this behaves on error with the page number logic (what if it errors over and over?), but don't have the time to fix it right now.
                Logger.appendError(
                    `Error getting PR count for page [${repo.url}/pulls?author=${username}&state=all&per_page=100&page=${pageNumber}]:  ${error}`,
                );
            }
        } while (pullsResponse?.data.length === 100);

        totalPrs += prsPerRepo;

        try {
            Storage.store(`${username}_${repo.name}_last_pr_page`, pageNumber);
            Storage.store(`${username}_${repo.name}_last_pr_count`, prsPerRepo);
            Storage.store(`${username}_${repo.name}_last_pr_page_count`, numberOfRelevantPRsOnPage);
        } catch (error) {
            Logger.appendError(
                `Error storing last queried pr info for user [${username}], repo [${repo.name}]:  ${error}`,
            );
        }
    }

    return totalPrs;
}

async function getLinesOfCodeWrittenForUser(
    username: string,
    repositories: any[],
    headers: AxiosHeaders,
): Promise<number> {
    let totalLinesOfCodeWritten: number = 0;

    for (const repo of repositories) {
        try {
            Logger.appendDebugLog(`Fetching contribution stats for repo [${repo.name}].`);
            let response: AxiosResponse = await axios.get(
                `https://api.github.com/repos/${repo.owner.login}/${repo.name}/stats/contributors`,
                {
                    headers,
                },
            );

            if (response.status === 202) {
                // Repeatedly query again until either 200 or something besides the repeat status code.
                try {
                    await new Promise<void>((repeatQueryResolver, repeatQueryRejector) => {
                        const intervalID: NodeJS.Timeout = setInterval(async () => {
                            response = await axios.get(
                                `https://api.github.com/repos/${repo.owner.login}/${repo.name}/stats/contributors`,
                                {
                                    headers,
                                },
                            );

                            if (response.status === 200) {
                                repeatQueryResolver();
                                clearInterval(intervalID);
                            } else if (response.status !== 202) {
                                repeatQueryRejector();
                                clearInterval(intervalID);
                            }
                        }, 5000);
                    });
                } catch (error) {
                    Logger.appendError(
                        `Unable to re-ping contributions status for [${repo.name}. Aborting. Error: ${error}`,
                    );
                }
            }

            if (response.status === 200) {
                const contributorsData = response.data;

                if (contributorsData && contributorsData.find) {
                    const userContributions = contributorsData.find(
                        (contributor: any) => contributor.author.login === username,
                    )?.weeks;

                    if (userContributions) {
                        const userLinesOfCodeForRepo: number = userContributions.reduce(
                            (total: number, week: any) => total + week.a - week.d,
                            0,
                        );
                        totalLinesOfCodeWritten += userLinesOfCodeForRepo;
                    }
                }
            } else {
                Logger.appendError(
                    `Error getting lines written count for page [https://api.github.com/repos/${repo.owner.login}/${repo.name}/stats/contributors]. HTTP Response Code [${response.status}]`,
                );
            }
        } catch (error) {
            Logger.appendError(
                `Error getting lines written count for page [https://api.github.com/repos/${repo.owner.login}/${repo.name}/stats/contributors]: ${error}`,
            );
        }
    }
    return totalLinesOfCodeWritten;
}

async function getRepositoriesContributedForUser(repositories: any[]): Promise<number> {
    return repositories.length ?? 0;
}

export { getGHUserMetrics };
