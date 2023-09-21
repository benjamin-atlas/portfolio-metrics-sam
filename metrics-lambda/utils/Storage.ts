import Logger from './Logger';
import * as AWS from 'aws-sdk';

class Storage {
    private static readonly DATASTORE_FILE: string = 'datastore.json';
    private static values: any;
    private static isLoaded: boolean;
    private static dynamoDB: AWS.DynamoDB.DocumentClient;

    public static async load(): Promise<boolean> {
        try {
            Logger.appendDebugLog('Initializing dynamoDB client.');
            AWS.config.update({
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                region: process.env.AWS_DEFAULT_REGION,
            });

            this.dynamoDB = new AWS.DynamoDB.DocumentClient();

            Logger.appendDebugLog('Fetching store_id [0] from gh-metrics-store.');
            this.values = (
                await this.dynamoDB
                    .get({
                        TableName: 'gh-metrics-store',
                        Key: {
                            store_id: 0,
                        },
                    })
                    .promise()
            )?.Item;

            if (!this.values || Object.keys(this.values).length === 0) {
                this.values = { store_id: 0 };
                Logger.appendDebugLog(
                    `Nothing to fetch from gh-metrics-store. Creating value [${JSON.stringify(this.values)}].`,
                );
                await this.dynamoDB
                    .put({
                        TableName: 'gh-metrics-store',
                        Item: this.values,
                    })
                    .promise();
            }

            this.isLoaded = true;
            return true;
        } catch (error: any) {
            Logger.appendError(`Error loading from storage. Error: ${error}`);
            return false;
        }
    }

    public static async get(key: string): Promise<any> {
        if (!this.isLoaded) {
            const success: boolean = await this.load();

            if (!success) {
                Logger.appendError(`Unable to load to fetch value [${key}] from storage.`);
            }
        }

        return this.values[key];
    }

    public static async store(key: string, value: any): Promise<void> {
        if (!this.isLoaded) {
            const success: boolean = await this.load();

            if (!success) {
                Logger.appendError(`Unable to load to store key/value [${key}]: [${value}] in storage.`);
            }
        }

        try {
            this.values[key] = value;
            Logger.appendDebugLog('Storing values to gh-metrics-store.');
            await this.dynamoDB
                .put({
                    TableName: 'gh-metrics-store',
                    Item: this.values,
                })
                .promise();
        } catch (error: any) {
            Logger.appendError(`Error storing key/value [${key}]: [${value}]. Error: ${error}`);
        }
    }
}

export default Storage;
