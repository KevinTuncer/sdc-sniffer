import { Api, JsonRpc } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';           // TODO: should be replaced by a wallet like scatter or anchor, see SavAct's blockchain browser
import fetch from 'node-fetch';  
import * as openpgp from 'openpgp';
import { DataLog, BlockChainNetwork, PermissionEntry, Transaction, GetBlockResult} from './connectionInterfaces';

/**
 * Data which should be uploaded. It has to be in decrypted form whether data should be encrypted or not.
 */
export const DataToUpload: Array<string> = [];

export class Connector
{
    api: Api;
    shouldEncrypt: boolean;
    rPublicKeys: Array<openpgp.key.Key> | null = null;
    oldDataLog: DataLog | null = null;

    paramsDataLogs: {contract: string, scope: string, user: string, tableName: string};

    /**
     * TODO: Description
     * @param dataNet All network related parameters for the data storage
     * @param shouldEncrypt Specifies whether the logged data will be encrypted
     */
    constructor(dataNet: BlockChainNetwork, shouldEncrypt: boolean = true)
    {
        const rpc = new JsonRpc(dataNet.endpoint, { fetch });
        
        const signatureProvider = dataNet.privateKey? new JsSignatureProvider([dataNet.privateKey]) : new JsSignatureProvider([]);

        this.api = new Api({ rpc, signatureProvider });
        
        this.shouldEncrypt = shouldEncrypt;
        
        this.paramsDataLogs = {
            contract: dataNet.contract? dataNet.contract : "", 
            scope: dataNet.scope? dataNet.scope : "", 
            user: dataNet.user? dataNet.user : "", 
            tableName: "datalogs"
        };    
        
        console.log("Got public keys and last data log asynchronously..");
        
        this.getBlockchainLoggingDatas();
    }

    /**
     * Check if the DataToUpload is zero
     * @returns a boolean which is true when there are no more data to upload
     */
    public isUploading(): boolean{
        // console.log(DataToUpload);
        // console.log(typeof DataToUpload);
        // console.log(typeof DataToUpload.length);
        // console.log(DataToUpload.length);
        return DataToUpload.length > 0;
    }

    getBlockchainLoggingDatas() {
        (async() => {
            // Get read public keys from Blockchain
            await this.UpdatePublicKeys();

            // Get old Datalog
            await this.GetOldDataLog();
        })();
    }

    private isRequestingPublicKeys = false;
    async UpdatePublicKeys()
    {
        if(this.isRequestingPublicKeys){
            return;
        }
        this.isRequestingPublicKeys = true;
        
        this.rPublicKeys = null;
        console.log("Get read public keys..");
        
        try {
            this.rPublicKeys = await Connector.GetRPublicKeys(this.api.rpc, {contract: this.paramsDataLogs.contract, scope:this.paramsDataLogs.scope, tableName:"permissions"});
            console.log(`Got ${this.rPublicKeys.length} read public keys.`);
        } catch (error) {
            console.log(error);
        } finally {
            this.isRequestingPublicKeys = false;
        }
    }

    async GetOldDataLog()
    {
        // Only request if no request is running currently else block this function
        if(!this.isRequestingLastDataLog) {         
            await this.RequestOldDataLogWithRefsOnChain();
        } else {
            console.log("Wait for requesting the old dataLog.");
            let i = 0;
            while(this.isRequestingLastDataLog){ 
                await this.sleep(500);
            }
        }
    }

    private isRequestingLastDataLog = false;
    async RequestOldDataLogWithRefsOnChain()
    {
        this.isRequestingLastDataLog = true;
        this.oldDataLog = null;
        console.log("Get old data log from blockchain..");
        
        try {
            this.oldDataLog = await Connector.GetLastDataLogOnChain(this.api.rpc, this.paramsDataLogs, true);
            if(this.oldDataLog) {
                console.log(`Got old data log in block number ${this.oldDataLog.thisRefBlock}.`);
            }
            else {
                console.log('Got old data log.');
            }         
        } catch (error) {
            console.log(error);
        } finally {
            this.isRequestingLastDataLog = false;
        }
        
    }

    /**
     * Add data to the blockchain
     * @param decrypted Object containing the data
     */
    AddLog(decrypted: {data: string})
    {
        // Add the data to upload in a single block
        DataToUpload.push(decrypted.data);

        // Start logging if it is not running
        this.Logging();
    }

    private loggingFunctionActive = false;
    private async Logging() {
        // Only perform the rest of function if the following while loop is not already active
        if(this.loggingFunctionActive) {
            return;
        } this.loggingFunctionActive = true;
        
        try {
            while(DataToUpload.length > 0) 
            {                
                // Get the first item and keep it in dataLog
                let cyptedData: { decrypted: string, encrypted?: string } = {decrypted: DataToUpload[0]};

                // Encrypt data
                if(this.shouldEncrypt)
                {
                    // Wait if the read public keys are requested
                    while(this.isRequestingPublicKeys){ 
                        await this.sleep(500);     
                        console.log("Waiting for read public keys.");
                    }

                    if(!this.rPublicKeys) { 
                        console.log("Error: No read public keys are specified.");
                        return;
                    }

                    const { data: encrypted } = await openpgp.encrypt({
                        message: openpgp.message.fromText(cyptedData.decrypted),     // input as Message object
                        publicKeys: this.rPublicKeys,                                // for encryption
                        // privateKeys: [privateKey]                  // for signing (optional)
                        // passwords: ['secret stuff'],               // multiple passwords possible (optional)
                        compression: openpgp.enums.compression.zlib                  // compress the data with zip pr zlib (optional)
                    });
                    
                    cyptedData.encrypted = encrypted;
                }

                // Get last dataLog if it is not defined
                if(!this.oldDataLog) {
                    await this.GetOldDataLog();
                }                

                // Create new dataLog
                let dataLog: DataLog = {
                    scope: this.paramsDataLogs.scope,
                    user: this.paramsDataLogs.user,
                    data: this.shouldEncrypt? (cyptedData.encrypted? cyptedData.encrypted : "") : cyptedData.decrypted,
                    // The refBlock and refTrx are the block number and transaction id of the last record.
                    // If there was no record before the current block number and empty for refTrx will be used:
                    refBlock: this.oldDataLog && this.oldDataLog.thisRefBlock? this.oldDataLog.thisRefBlock : (await this.api.rpc.get_info()).head_block_num,
                    refTrx: this.oldDataLog && this.oldDataLog.thisRefTrx? this.oldDataLog.thisRefTrx : ""
                }

                // Upload new dataLog and keep this dataLog with the referring block number and transaction id in oldDataLog
                this.oldDataLog = await Connector.UploadLogEntry(this.api, this.paramsDataLogs, dataLog, this.oldDataLog? this.oldDataLog: undefined);

                // Remove the first item
                DataToUpload.shift();
            }
        } 
        catch(e) {
            console.log(e);
        }
        finally {
            // Deaktivate this function so it can be performed again if necessary
            this.loggingFunctionActive = false;
        }
    }    

    /**
     * Use with await to pause in an async function
     * @param ms Milliseconds to pause
     */
    private async sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get all read public keys.
     * @param rpc JsonRpc of the blockchain endnote
     * @param params Parameters to find the right permissions list
     * @param privateKey The private key for signatures
     * @returns Array of all public keys
     */
    static async GetRPublicKeys(rpc: JsonRpc, params: {contract: string, scope: string, tableName: string}): Promise<Array<openpgp.key.Key>>
    {    
        const tableResult = await rpc.get_table_rows({
            json: true,               // Get the response as json
            code: params.contract,    // Contract that we target
            scope: params.scope,      // Account that owns the data
            table: params.tableName,  // Table name
            //reverse: false,         // Optional: Get reversed data
            show_payer: false,        // Optional: Show ram payer
            //key_type: 'i64',        // primary_key type. For the default first primary_key is i64 required and default
            //index_position: 0,      // primary_key. Default is 0 for the first primary_key
            //lower_bound: params.startIndex,   // get rows starting by the selected primaery_key index
            //- TODO: More then 10 or define a maximum
            limit: 10,                // Maximum number of rows that we want to get, beginning from lower_bound
        });        
        
        // Keep the read public keys as Array in rPublicKeys
        let rPublicKeys: Array<openpgp.key.Key> = [];
        if((tableResult.rows as Array<PermissionEntry>).length > 0)
        {
            for (const entry of (tableResult.rows as Array<PermissionEntry>)) {
                let key = (await openpgp.key.readArmored(entry.rPubKey)).keys[0];
                if(key)
                {
                    rPublicKeys.push(key);
                }
            }
        }
        return rPublicKeys;
    }

    /**
     * Get the last recorded dataLog in the blockchain.
     * @param rpc JsonRpc of the blockchain endnote
     * @param params Parameters to find the right record
     * @param findThisRefs Find the referred blok number and referred transaction id of this dataLog by checking each block since second last record
     * @returns The last dataLog
     */
    static async GetLastDataLogOnChain(rpc: JsonRpc, params: {contract: string, scope: string, user: any, tableName: string}, findThisRefs?: boolean): Promise<DataLog | null>
    {
        // Get last log entry
        const tableResult = await rpc.get_table_rows({
            json: true,               // Get the response as json
            code: params.contract,    // Contract that we target
            scope: params.scope,      // Account that owns the data
            table: params.tableName,  // Table name
            //reverse: false,         // Optional: Get reversed data
            show_payer: false,        // Optional: Show ram payer
            key_type: 'name',         // primary_key type. For the default first primary_key is i64 required and default
            //index_position: 0         // 0 for primary_key. Default is 0 for the first primary_key
            lower_bound: params.user,   // get rows starting by the selected primaery_key
            upper_bound: params.user,   // get rows ending by the selected primaery_key
            //limit: 1,                 // Maximum number of rows that we want to get, beginning from lower_bound
        });

        // Return the last dataLog
        if(tableResult.rows.length > 0) {
            if(findThisRefs)
            {
                // Find the referred blok number and referred transaction id of this dataLog
                return await Connector.FindDataLogRefs(rpc, params, tableResult.rows[0] as DataLog);
            }
            return tableResult.rows[0] as DataLog;
        }
        return null;
    }

    /**
     * Search for the block number and transaction of the last dataLog record. Start at the block number of the second last record which is defined in the last dataLog.
     * @param rpc JsonRpc of the blockchain endnote
     * @param params Parameters to find the right record
     * @param dataLog The last dataLog record
     * @returns The declared dataLog but with the block number and transaction of the own record
     */
    static async FindDataLogRefs(rpc: JsonRpc, params: {contract: string, scope: string, user: any, tableName: string}, dataLog: DataLog)
    {
        let result: any;
        let found = false;
        console.log(`Search for last data log in blockchain. Start by block number: ${dataLog.refBlock}.`);
        
        for(let n = dataLog.refBlock != 0? dataLog.refBlock : 1; !found; n++) 
        {  
            if(n%100 == 0) {
                console.log(`Intermediate state of searching last data log is block number: ${n}.`);
            }

            result = await rpc.get_block(n);

            ((result as GetBlockResult).transactions as Array<Transaction>).forEach(trans => {
                //let transaction = trans.trx.transaction;                
                trans.trx.transaction.actions.forEach(action => {
                    if(action.account == params.contract && action.name == "update")
                    {
                        // Compare the recorded dataLog with the declared one
                        let recordedDataLog: DataLog = action.data as DataLog;
                        if( recordedDataLog.scope == params.scope &&
                            recordedDataLog.user == dataLog.user &&
                            recordedDataLog.refBlock == dataLog.refBlock &&
                            recordedDataLog.refTrx == dataLog.refTrx &&
                            recordedDataLog.data == dataLog.data
                        ){
                            found = true;  
                            // Get the block number and transaction id of this record
                            dataLog.thisRefBlock = (result as GetBlockResult).block_num;                   
                            dataLog.thisRefTrx = trans.trx.id;
                            console.log(`Found last data log in block number: ${dataLog.thisRefBlock}.`);                   
                        }
                    }
                });
            });       
        }
        
        return dataLog;
    }

    /**
     * Upload a new dataLog. If there is already a log recorded, the oldDataLog is needed.
     * @param api Api of a blockchain endnote
     * @param params Parameters to find the right record
     * @param dataLog The dataLog to store in the blockchain
     * @param olDataLog The last dataLog record
     * @returns The dataLog with the resulting block number and transaction id of the upload
     */
    static async UploadLogEntry(api: Api, params: {contract: string, scope: string}, dataLog: DataLog, oldDataLog?: DataLog)
    {
        const result = await api.transact({
            actions: [{
                account: params.contract,
                name: 'update',
                authorization: [{
                    actor: dataLog.user,
                    permission: 'active',
                }],
                data: {
                    scope: params.scope, 
                    user: dataLog.user, 
                    data: dataLog.data, 
                    refBlock: dataLog.refBlock, 
                    refTrx: dataLog.refTrx, 
                    // If no old dataLog is specified then the referring block number is 0 and the refering transaction id empty.
                    oldRefBlock: oldDataLog? oldDataLog.refBlock : 0, 
                    oldRefTrx: oldDataLog? oldDataLog.refTrx : ""
                },
            }]
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
        });

        // Keep the resulting block number and transaction id
        dataLog.thisRefBlock = result.processed.block_num;
        dataLog.thisRefTrx = result.processed.id;
        if(result.processed.receipt.status == 'executed'){
            console.log(`Upload successed: Transaction id: ${result.processed.id}, Status: ${result.processed.receipt.status}`);  
        } else {
            console.log(`Upload error:`, result);  
        }

        return dataLog;
    }

}