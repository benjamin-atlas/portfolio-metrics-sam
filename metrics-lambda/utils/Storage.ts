import Logger from './Logger';
import * as AWS from 'aws-sdk';

class Storage {
    private static readonly DATASTORE_FILE: string = 'datastore.json';
    private static values: any;
    private static isLoaded: boolean;
    private static dynamoDB: AWS.DynamoDB.DocumentClient;

    public static async load(): Promise<void> {
        Logger.appendDebugLog('Initializing dynamoDB client.');

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
    }

    public static async get(key: string): Promise<any> {
        if (!this.isLoaded) {
            throw new Error('Service is not loaded. Cannot fetch values from storage.');
        }

        return this.values[key];
    }

    public static async store(key: string, value: any): Promise<void> {
        if (!this.isLoaded) {
            throw new Error('Service is not loaded. Cannot store values to storage.');
        }

        this.values[key] = value;
    }

    public static async synchronize() {
        if (!this.isLoaded) {
            throw new Error('Service is not loaded. Cannot synchronize values to gh-metrics-store.');
        }

        try {
            Logger.appendDebugLog('Storing values to gh-metrics-store.');
            await this.dynamoDB
                .put({
                    TableName: 'gh-metrics-store',
                    Item: this.values,
                })
                .promise();
        } catch (error: any) {
            Logger.appendError(`Error storing current value set to gh-metrics-store. Error: ${error}`);
        }
    }
}

export default Storage;
